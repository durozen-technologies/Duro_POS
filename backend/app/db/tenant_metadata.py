"""Tenant-only SQLAlchemy metadata (excludes platform control-plane tables)."""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import Enum as SAEnum
from sqlalchemy import inspect, text
from sqlalchemy.dialects.postgresql import ENUM as PG_ENUM
from sqlalchemy.engine import Connection

# Tables never created inside a tenant schema (tenant DDL skips these).
PLATFORM_TABLES = frozenset(
    {
        "organizations",
        "permissions",
        "user_auth_index",
        "global_image_template_categories",
        "global_image_templates",
    }
)

# Tables allowed in public after schema-per-tenant cutover (super-admin control plane).
PUBLIC_SCHEMA_TABLES = PLATFORM_TABLES | frozenset(
    {
        "users",
        "audit_logs",
        "alembic_version",
    }
)

_SHARED_PUBLIC_TABLES = frozenset({"users", "audit_logs"})


def tenant_table_names() -> tuple[str, ...]:
    from app import models as _models  # noqa: F401
    from app.db.database import Base

    return tuple(
        table.name for table in Base.metadata.sorted_tables if table.name not in PLATFORM_TABLES
    )


def public_tenant_tables_to_drop() -> tuple[str, ...]:
    """Pure-tenant table shells to DROP from public after row purge."""
    return tuple(name for name in tenant_table_names() if name not in _SHARED_PUBLIC_TABLES)


def list_public_tables(connection: Connection) -> set[str]:
    return set(inspect(connection).get_table_names(schema="public"))


def drop_public_tenant_table_shells(connection: Connection) -> int:
    """DROP pure-tenant tables from public (rows must already be purged)."""
    dropped = 0
    for table_name in public_tenant_tables_to_drop():
        if not inspect(connection).has_table(table_name, schema="public"):
            continue
        connection.execute(text(f'DROP TABLE IF EXISTS public."{table_name}" CASCADE'))
        dropped += 1
    return dropped


def verify_public_schema_clean(connection: Connection) -> None:
    """Raise if public schema violates the super-admin control-plane contract."""
    actual = list_public_tables(connection)
    extra = sorted(actual - PUBLIC_SCHEMA_TABLES)
    if extra:
        raise RuntimeError(f"public schema has {len(extra)} non-platform table(s): {extra}")

    null_schemas = connection.execute(
        text("SELECT COUNT(*) FROM organizations WHERE schema_name IS NULL")
    ).scalar_one()
    if null_schemas:
        raise RuntimeError(f"{null_schemas} organization(s) have schema_name IS NULL")

    tenant_users = connection.execute(
        text("SELECT COUNT(*) FROM public.users WHERE organization_id IS NOT NULL")
    ).scalar_one()
    if tenant_users:
        raise RuntimeError(f"public.users has {tenant_users} tenant row(s)")

    for table in public_tenant_tables_to_drop():
        if table not in actual:
            continue
        count = connection.execute(text(f"SELECT COUNT(*) FROM public.{table}")).scalar_one()
        if count:
            raise RuntimeError(f"public.{table} has {count} row(s) after cutover")


def _safe_schema_name(schema_name: str) -> str:
    from app.db.tenant_schema import assert_safe_schema_name

    return assert_safe_schema_name(schema_name)


@contextmanager
def _reuse_public_pg_enums(connection: Connection) -> Iterator[None]:
    """Point tenant DDL at shared public enum types (avoid per-schema CREATE TYPE)."""
    if connection.dialect.name != "postgresql":
        yield
        return

    from app.db.database import Base

    saved: list[tuple[PG_ENUM, bool, str | None]] = []
    seen_impl_ids: set[int] = set()

    for table in Base.metadata.sorted_tables:
        for column in table.columns:
            column_type = column.type
            if isinstance(column_type, SAEnum):
                pg_enum = column_type.dialect_impl(connection.dialect)
            elif isinstance(column_type, PG_ENUM):
                pg_enum = column_type
            else:
                continue

            if not isinstance(pg_enum, PG_ENUM) or not pg_enum.name:
                continue
            impl_id = id(pg_enum)
            if impl_id in seen_impl_ids:
                continue
            seen_impl_ids.add(impl_id)
            saved.append((pg_enum, pg_enum.create_type, pg_enum.schema))
            pg_enum.create_type = False
            pg_enum.schema = "public"

    try:
        yield
    finally:
        for pg_enum, create_type, schema in saved:
            pg_enum.create_type = create_type
            pg_enum.schema = schema


def count_tenant_schema_tables(connection: Connection, schema_name: str) -> int:
    safe = _safe_schema_name(schema_name)
    inspector = inspect(connection)
    names = set(inspector.get_table_names(schema=safe))
    expected = set(tenant_table_names())
    return len(names & expected)


def verify_tenant_schema_ddl(connection: Connection, schema_name: str) -> None:
    safe = _safe_schema_name(schema_name)
    inspector = inspect(connection)
    actual = set(inspector.get_table_names(schema=safe))
    expected = set(tenant_table_names())
    missing = sorted(expected - actual)
    if missing:
        raise RuntimeError(f"Tenant schema {safe!r} is missing {len(missing)} table(s): {missing}")


def _ensure_public_receipt_status_enum(connection: Connection) -> None:
    if connection.dialect.name != "postgresql":
        return
    exists = connection.execute(
        text(
            "SELECT 1 FROM pg_type t "
            "JOIN pg_namespace n ON n.oid = t.typnamespace "
            "WHERE n.nspname = 'public' AND t.typname = 'receiptstatus'"
        )
    ).scalar_one_or_none()
    if exists is not None:
        return
    # Always create in public — search_path is often tenant-first during repair.
    connection.execute(
        text(
            """
            DO $$
            BEGIN
                CREATE TYPE public.receiptstatus AS ENUM ('pending', 'printed', 'failed');
            EXCEPTION
                WHEN duplicate_object THEN NULL;
            END
            $$;
            """
        )
    )


def _ensure_receipt_status_uses_public_enum(connection: Connection, schema_name: str) -> None:
    """Point receipts.receipt_status at public.receiptstatus (not a tenant-local twin)."""
    if connection.dialect.name != "postgresql":
        return
    safe = schema_name  # already validated by callers
    row = connection.execute(
        text(
            """
            SELECT n.nspname AS type_schema, t.typname AS type_name
            FROM pg_attribute a
            JOIN pg_class c ON a.attrelid = c.oid
            JOIN pg_namespace ns ON c.relnamespace = ns.oid
            JOIN pg_type t ON a.atttypid = t.oid
            JOIN pg_namespace n ON t.typnamespace = n.oid
            WHERE ns.nspname = :schema
              AND c.relname = 'receipts'
              AND a.attname = 'receipt_status'
              AND a.attnum > 0
              AND NOT a.attisdropped
            """
        ),
        {"schema": safe},
    ).mappings().first()
    if row is None:
        return
    if row["type_schema"] == "public" and row["type_name"] == "receiptstatus":
        return
    _ensure_public_receipt_status_enum(connection)
    # Postgres refuses ALTER ... TYPE when the existing DEFAULT expression cannot
    # cast automatically to the new enum (e.g. varchar default → receiptstatus).
    connection.execute(
        text(
            f'''
            ALTER TABLE "{safe}".receipts
            ALTER COLUMN receipt_status DROP DEFAULT
            '''
        )
    )
    connection.execute(
        text(
            f'''
            ALTER TABLE "{safe}".receipts
            ALTER COLUMN receipt_status
            TYPE public.receiptstatus
            USING receipt_status::text::public.receiptstatus
            '''
        )
    )
    # Match ORM server_default (Receipt.receipt_status → pending).
    connection.execute(
        text(
            f'''
            ALTER TABLE "{safe}".receipts
            ALTER COLUMN receipt_status
            SET DEFAULT 'pending'::public.receiptstatus
            '''
        )
    )


def _ensure_public_billstatus_cancelled_enum(connection: Connection) -> None:
    if connection.dialect.name != "postgresql":
        return
    exists = connection.execute(
        text(
            """
            SELECT 1
            FROM pg_enum e
            JOIN pg_type t ON e.enumtypid = t.oid
            JOIN pg_namespace n ON t.typnamespace = n.oid
            WHERE n.nspname = 'public'
              AND t.typname = 'billstatus'
              AND e.enumlabel = 'CANCELLED'
            """
        )
    ).scalar_one_or_none()
    if exists is not None:
        return
    bind = connection.engine
    with bind.connect().execution_options(isolation_level="AUTOCOMMIT") as autocommit_conn:
        autocommit_conn.execute(
            text("ALTER TYPE billstatus ADD VALUE IF NOT EXISTS 'CANCELLED'")
        )


def _ensure_public_retailer_sale_status_cancelled_enum(connection: Connection) -> None:
    if connection.dialect.name != "postgresql":
        return
    exists = connection.execute(
        text(
            """
            SELECT 1
            FROM pg_enum e
            JOIN pg_type t ON e.enumtypid = t.oid
            JOIN pg_namespace n ON t.typnamespace = n.oid
            WHERE n.nspname = 'public'
              AND t.typname = 'retailersalestatus'
              AND e.enumlabel = 'cancelled'
            """
        )
    ).scalar_one_or_none()
    if exists is not None:
        return
    bind = connection.engine
    with bind.connect().execution_options(isolation_level="AUTOCOMMIT") as autocommit_conn:
        autocommit_conn.execute(
            text("ALTER TYPE retailersalestatus ADD VALUE IF NOT EXISTS 'cancelled'")
        )


def _ensure_public_retailer_inventory_purchase_status_enum(connection: Connection) -> None:
    if connection.dialect.name != "postgresql":
        return
    exists = connection.execute(
        text(
            "SELECT 1 FROM pg_type t "
            "JOIN pg_namespace n ON n.oid = t.typnamespace "
            "WHERE n.nspname = 'public' AND t.typname = 'retailerinventorypurchasestatus'"
        )
    ).scalar_one_or_none()
    if exists is not None:
        return
    connection.execute(
        text(
            """
            DO $$
            BEGIN
                CREATE TYPE retailerinventorypurchasestatus AS ENUM ('active', 'void');
            EXCEPTION
                WHEN duplicate_object THEN NULL;
            END
            $$;
            """
        )
    )


def ensure_tenant_schema_drift_patches(connection: Connection, schema_name: str) -> None:
    """Idempotent tenant DDL when alembic_version is ahead of the physical schema."""
    _ensure_public_billstatus_cancelled_enum(connection)
    _ensure_public_retailer_sale_status_cancelled_enum(connection)
    safe = _safe_schema_name(schema_name)
    connection.execute(text(f'SET search_path TO "{safe}", public'))
    dialect = connection.dialect.name
    inspector = inspect(connection)
    table_names = set(inspector.get_table_names(schema=safe))

    if "checkout_snapshots" not in table_names:
        create_tenant_tables(connection, safe)
        inspector = inspect(connection)
        table_names = set(inspector.get_table_names(schema=safe))

    if "alembic_version" in table_names and dialect == "postgresql":
        connection.execute(
            text(
                "ALTER TABLE alembic_version "
                "ALTER COLUMN version_num TYPE VARCHAR(64)"
            )
        )

    if "users" in table_names:
        user_columns = {column["name"] for column in inspector.get_columns("users", schema=safe)}
        if "shop_name" not in user_columns:
            if dialect == "postgresql":
                connection.execute(
                    text(
                        "ALTER TABLE users "
                        "ADD COLUMN IF NOT EXISTS shop_name VARCHAR(120)"
                    )
                )
            else:
                connection.execute(text("ALTER TABLE users ADD COLUMN shop_name VARCHAR(120)"))

    if "shops" in table_names:
        shop_columns = {column["name"] for column in inspector.get_columns("shops", schema=safe)}
        if "daily_prices_published_on" not in shop_columns:
            if dialect == "postgresql":
                connection.execute(
                    text(
                        "ALTER TABLE shops ADD COLUMN IF NOT EXISTS daily_prices_published_on DATE"
                    )
                )
            else:
                connection.execute(
                    text("ALTER TABLE shops ADD COLUMN daily_prices_published_on DATE")
                )

    if "items" in table_names:
        item_columns = {column["name"] for column in inspector.get_columns("items", schema=safe)}
        if "global_image_template_id" not in item_columns:
            if dialect == "postgresql":
                connection.execute(
                    text(
                        "ALTER TABLE items "
                        "ADD COLUMN IF NOT EXISTS global_image_template_id UUID"
                    )
                )
                connection.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_items_global_image_template_id "
                        "ON items (global_image_template_id)"
                    )
                )
            else:
                connection.execute(
                    text("ALTER TABLE items ADD COLUMN global_image_template_id CHAR(32)")
                )

    if "inventory_items" in table_names:
        inventory_columns = {
            column["name"] for column in inspector.get_columns("inventory_items", schema=safe)
        }
        if "global_image_template_id" not in inventory_columns:
            if dialect == "postgresql":
                connection.execute(
                    text(
                        "ALTER TABLE inventory_items "
                        "ADD COLUMN IF NOT EXISTS global_image_template_id UUID"
                    )
                )
                connection.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_inventory_items_global_image_template_id "
                        "ON inventory_items (global_image_template_id)"
                    )
                )
            else:
                connection.execute(
                    text(
                        "ALTER TABLE inventory_items "
                        "ADD COLUMN global_image_template_id CHAR(32)"
                    )
                )

    if "expense_items" in table_names:
        expense_columns = {
            column["name"] for column in inspector.get_columns("expense_items", schema=safe)
        }
        if "global_image_template_id" not in expense_columns:
            if dialect == "postgresql":
                connection.execute(
                    text(
                        "ALTER TABLE expense_items "
                        "ADD COLUMN IF NOT EXISTS global_image_template_id UUID"
                    )
                )
                connection.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_expense_items_global_image_template_id "
                        "ON expense_items (global_image_template_id)"
                    )
                )
            else:
                connection.execute(
                    text(
                        "ALTER TABLE expense_items ADD COLUMN global_image_template_id CHAR(32)"
                    )
                )

    if "bills" in table_names:
        bill_columns = {
            column["name"]: column for column in inspector.get_columns("bills", schema=safe)
        }
        if dialect == "postgresql":
            if "checkout_token" not in bill_columns:
                connection.execute(
                    text("ALTER TABLE bills ADD COLUMN IF NOT EXISTS checkout_token VARCHAR(512)")
                )
                connection.execute(
                    text(
                        "CREATE UNIQUE INDEX IF NOT EXISTS ix_bills_checkout_token "
                        "ON bills (checkout_token)"
                    )
                )
            if "created_by_user_id" not in bill_columns:
                connection.execute(
                    text("ALTER TABLE bills ADD COLUMN IF NOT EXISTS created_by_user_id UUID")
                )
                connection.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_bills_created_by_user_id "
                        "ON bills (created_by_user_id)"
                    )
                )
                foreign_key_names = {
                    key["name"]
                    for key in inspector.get_foreign_keys("bills", schema=safe)
                    if key.get("name")
                }
                if "fk_bills_created_by_user_id_users" not in foreign_key_names:
                    connection.execute(
                        text(
                            """
                            ALTER TABLE bills
                            ADD CONSTRAINT fk_bills_created_by_user_id_users
                            FOREIGN KEY (created_by_user_id) REFERENCES public.users(id)
                            """
                        )
                    )
            if "item_count" not in bill_columns:
                connection.execute(
                    text(
                        "ALTER TABLE bills ADD COLUMN IF NOT EXISTS item_count "
                        "INTEGER NOT NULL DEFAULT 0"
                    )
                )
            if "total_quantity" not in bill_columns:
                connection.execute(
                    text(
                        "ALTER TABLE bills ADD COLUMN IF NOT EXISTS total_quantity "
                        "NUMERIC(10, 3) NOT NULL DEFAULT 0"
                    )
                )
        else:
            if "checkout_token" not in bill_columns:
                connection.execute(
                    text("ALTER TABLE bills ADD COLUMN checkout_token VARCHAR(512)")
                )
            if "created_by_user_id" not in bill_columns:
                connection.execute(text("ALTER TABLE bills ADD COLUMN created_by_user_id CHAR(32)"))
            if "item_count" not in bill_columns:
                connection.execute(
                    text(
                        "ALTER TABLE bills ADD COLUMN item_count INTEGER NOT NULL DEFAULT 0"
                    )
                )
            if "total_quantity" not in bill_columns:
                connection.execute(
                    text(
                        "ALTER TABLE bills ADD COLUMN total_quantity NUMERIC(10, 3) "
                        "NOT NULL DEFAULT 0"
                    )
                )

    if "receipts" in table_names:
        receipt_columns = {
            column["name"]: column for column in inspector.get_columns("receipts", schema=safe)
        }
        if dialect == "postgresql":
            _ensure_public_receipt_status_enum(connection)
            if "receipt_status" not in receipt_columns:
                connection.execute(
                    text(
                        "ALTER TABLE receipts ADD COLUMN IF NOT EXISTS receipt_status "
                        "public.receiptstatus NOT NULL "
                        "DEFAULT 'printed'::public.receiptstatus"
                    )
                )
                connection.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_receipts_receipt_status "
                        "ON receipts (receipt_status)"
                    )
                )
            else:
                _ensure_receipt_status_uses_public_enum(connection, safe)
            if "print_attempts" not in receipt_columns:
                connection.execute(
                    text(
                        "ALTER TABLE receipts ADD COLUMN IF NOT EXISTS print_attempts "
                        "INTEGER NOT NULL DEFAULT 0"
                    )
                )
                connection.execute(
                    text(
                        "UPDATE receipts SET print_attempts = 1 WHERE printed_at IS NOT NULL"
                    )
                )
            if "last_print_error" not in receipt_columns:
                connection.execute(
                    text(
                        "ALTER TABLE receipts ADD COLUMN IF NOT EXISTS last_print_error TEXT"
                    )
                )
            printed_at_col = receipt_columns.get("printed_at")
            if printed_at_col is not None and printed_at_col.get("nullable") is False:
                connection.execute(text("ALTER TABLE receipts ALTER COLUMN printed_at DROP NOT NULL"))
        else:
            if "receipt_status" not in receipt_columns:
                connection.execute(
                    text(
                        "ALTER TABLE receipts ADD COLUMN receipt_status VARCHAR(16) "
                        "NOT NULL DEFAULT 'printed'"
                    )
                )
            if "print_attempts" not in receipt_columns:
                connection.execute(
                    text(
                        "ALTER TABLE receipts ADD COLUMN print_attempts INTEGER NOT NULL DEFAULT 0"
                    )
                )
            if "last_print_error" not in receipt_columns:
                connection.execute(
                    text("ALTER TABLE receipts ADD COLUMN last_print_error TEXT")
                )

    if "retailer_sale_receipts" in table_names:
        retailer_receipt_columns = {
            column["name"] for column in inspector.get_columns("retailer_sale_receipts", schema=safe)
        }
        if "opening_balance" not in retailer_receipt_columns:
            if dialect == "postgresql":
                connection.execute(
                    text(
                        "ALTER TABLE retailer_sale_receipts "
                        "ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(10, 2) "
                        "NOT NULL DEFAULT 0.00"
                    )
                )
            else:
                connection.execute(
                    text(
                        "ALTER TABLE retailer_sale_receipts "
                        "ADD COLUMN opening_balance NUMERIC(10, 2) NOT NULL DEFAULT 0.00"
                    )
                )

    if "expense_entries" in table_names:
        expense_columns = {
            column["name"] for column in inspector.get_columns("expense_entries", schema=safe)
        }
        if "cash_amount" not in expense_columns:
            if dialect == "postgresql":
                connection.execute(
                    text(
                        "ALTER TABLE expense_entries "
                        "ADD COLUMN IF NOT EXISTS cash_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00"
                    )
                )
            else:
                connection.execute(
                    text(
                        "ALTER TABLE expense_entries "
                        "ADD COLUMN cash_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00"
                    )
                )
        if "upi_amount" not in expense_columns:
            if dialect == "postgresql":
                connection.execute(
                    text(
                        "ALTER TABLE expense_entries "
                        "ADD COLUMN IF NOT EXISTS upi_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00"
                    )
                )
            else:
                connection.execute(
                    text(
                        "ALTER TABLE expense_entries "
                        "ADD COLUMN upi_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00"
                    )
                )
        if "cash_amount" not in expense_columns or "upi_amount" not in expense_columns:
            connection.execute(
                text(
                    "UPDATE expense_entries SET cash_amount = amount, upi_amount = 0 "
                    "WHERE cash_amount = 0 AND upi_amount = 0"
                )
            )
            if dialect == "postgresql":
                connection.execute(
                    text(
                        """
                        DO $$
                        BEGIN
                            IF NOT EXISTS (
                                SELECT 1 FROM pg_constraint
                                WHERE conname = 'ck_expense_entries_cash_non_negative'
                            ) THEN
                                ALTER TABLE expense_entries
                                ADD CONSTRAINT ck_expense_entries_cash_non_negative
                                CHECK (cash_amount >= 0);
                            END IF;
                        END
                        $$;
                        """
                    )
                )
                connection.execute(
                    text(
                        """
                        DO $$
                        BEGIN
                            IF NOT EXISTS (
                                SELECT 1 FROM pg_constraint
                                WHERE conname = 'ck_expense_entries_upi_non_negative'
                            ) THEN
                                ALTER TABLE expense_entries
                                ADD CONSTRAINT ck_expense_entries_upi_non_negative
                                CHECK (upi_amount >= 0);
                            END IF;
                        END
                        $$;
                        """
                    )
                )
                connection.execute(
                    text(
                        """
                        DO $$
                        BEGIN
                            IF NOT EXISTS (
                                SELECT 1 FROM pg_constraint
                                WHERE conname = 'ck_expense_entries_split_positive'
                            ) THEN
                                ALTER TABLE expense_entries
                                ADD CONSTRAINT ck_expense_entries_split_positive
                                CHECK ((cash_amount + upi_amount) > 0);
                            END IF;
                        END
                        $$;
                        """
                    )
                )

    if "retailers" in table_names:
        retailer_columns = {
            column["name"] for column in inspector.get_columns("retailers", schema=safe)
        }
        if "credit_balance" not in retailer_columns:
            if dialect == "postgresql":
                connection.execute(
                    text(
                        "ALTER TABLE retailers "
                        "ADD COLUMN IF NOT EXISTS credit_balance NUMERIC(10, 2) "
                        "NOT NULL DEFAULT 0.00"
                    )
                )
            else:
                connection.execute(
                    text(
                        "ALTER TABLE retailers "
                        "ADD COLUMN credit_balance NUMERIC(10, 2) NOT NULL DEFAULT 0.00"
                    )
                )
        if "alternate_phone" not in retailer_columns:
            if dialect == "postgresql":
                connection.execute(
                    text(
                        "ALTER TABLE retailers "
                        "ADD COLUMN IF NOT EXISTS alternate_phone VARCHAR(30)"
                    )
                )
            else:
                connection.execute(
                    text("ALTER TABLE retailers ADD COLUMN alternate_phone VARCHAR(30)")
                )
        if "address" not in retailer_columns:
            if dialect == "postgresql":
                connection.execute(
                    text(
                        "ALTER TABLE retailers "
                        "ADD COLUMN IF NOT EXISTS address VARCHAR(500)"
                    )
                )
            else:
                connection.execute(text("ALTER TABLE retailers ADD COLUMN address VARCHAR(500)"))
        if "shop_name" not in retailer_columns:
            if dialect == "postgresql":
                connection.execute(
                    text(
                        "ALTER TABLE retailers "
                        "ADD COLUMN IF NOT EXISTS shop_name VARCHAR(120)"
                    )
                )
            else:
                connection.execute(text("ALTER TABLE retailers ADD COLUMN shop_name VARCHAR(120)"))
        if "opening_balance" not in retailer_columns:
            if dialect == "postgresql":
                connection.execute(
                    text(
                        "ALTER TABLE retailers "
                        "ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(10, 2) "
                        "NOT NULL DEFAULT 0.00"
                    )
                )
            else:
                connection.execute(
                    text(
                        "ALTER TABLE retailers "
                        "ADD COLUMN opening_balance NUMERIC(10, 2) NOT NULL DEFAULT 0.00"
                    )
                )

    if "retailer_payments" in table_names:
        payment_columns = {
            column["name"] for column in inspector.get_columns("retailer_payments", schema=safe)
        }
        if "wallet_amount" not in payment_columns:
            if dialect == "postgresql":
                connection.execute(
                    text(
                        "ALTER TABLE retailer_payments "
                        "ADD COLUMN IF NOT EXISTS wallet_amount NUMERIC(10, 2) "
                        "NOT NULL DEFAULT 0.00"
                    )
                )
            else:
                connection.execute(
                    text(
                        "ALTER TABLE retailer_payments "
                        "ADD COLUMN wallet_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00"
                    )
                )

    purchase_tables = ("retailer_inventory_purchases", "retailer_inventory_purchase_lines")
    if any(name not in table_names for name in purchase_tables):
        create_tenant_tables(connection, safe)

    if "retailer_inventory_purchases" in table_names:
        purchase_columns = {
            column["name"]
            for column in inspector.get_columns("retailer_inventory_purchases", schema=safe)
        }
        if dialect == "postgresql":
            if "amount_applied_to_outstanding" not in purchase_columns:
                connection.execute(
                    text(
                        "ALTER TABLE retailer_inventory_purchases "
                        "ADD COLUMN IF NOT EXISTS amount_applied_to_outstanding "
                        "NUMERIC(10, 2) NOT NULL DEFAULT 0.00"
                    )
                )
            if "amount_deposited_to_wallet" not in purchase_columns:
                connection.execute(
                    text(
                        "ALTER TABLE retailer_inventory_purchases "
                        "ADD COLUMN IF NOT EXISTS amount_deposited_to_wallet "
                        "NUMERIC(10, 2) NOT NULL DEFAULT 0.00"
                    )
                )
        else:
            if "amount_applied_to_outstanding" not in purchase_columns:
                connection.execute(
                    text(
                        "ALTER TABLE retailer_inventory_purchases "
                        "ADD COLUMN amount_applied_to_outstanding "
                        "NUMERIC(10, 2) NOT NULL DEFAULT 0.00"
                    )
                )
            if "amount_deposited_to_wallet" not in purchase_columns:
                connection.execute(
                    text(
                        "ALTER TABLE retailer_inventory_purchases "
                        "ADD COLUMN amount_deposited_to_wallet "
                        "NUMERIC(10, 2) NOT NULL DEFAULT 0.00"
                    )
                )

    if "retailer_payments" in table_names:
        payment_columns = {
            column["name"] for column in inspector.get_columns("retailer_payments", schema=safe)
        }
        if "retailer_inventory_purchase_id" not in payment_columns:
            if dialect == "postgresql":
                connection.execute(
                    text(
                        "ALTER TABLE retailer_payments "
                        "ADD COLUMN IF NOT EXISTS retailer_inventory_purchase_id UUID"
                    )
                )
            else:
                connection.execute(
                    text(
                        "ALTER TABLE retailer_payments "
                        "ADD COLUMN retailer_inventory_purchase_id CHAR(32)"
                    )
                )

    _party_name_tables = (
        "retailer_sales",
        "retailer_inventory_purchases",
        "retailer_inventory_usages",
    )
    for table_name in _party_name_tables:
        if table_name not in table_names:
            continue
        columns = {column["name"] for column in inspector.get_columns(table_name, schema=safe)}
        if dialect == "postgresql":
            if "retailer_name" not in columns:
                connection.execute(
                    text(
                        f'ALTER TABLE "{table_name}" '
                        "ADD COLUMN IF NOT EXISTS retailer_name VARCHAR(120) "
                        "NOT NULL DEFAULT ''"
                    )
                )
            if "shop_name" not in columns:
                connection.execute(
                    text(
                        f'ALTER TABLE "{table_name}" '
                        "ADD COLUMN IF NOT EXISTS shop_name VARCHAR(120) "
                        "NOT NULL DEFAULT ''"
                    )
                )
        else:
            if "retailer_name" not in columns:
                connection.execute(
                    text(
                        f'ALTER TABLE "{table_name}" '
                        "ADD COLUMN retailer_name VARCHAR(120) NOT NULL DEFAULT ''"
                    )
                )
            if "shop_name" not in columns:
                connection.execute(
                    text(
                        f'ALTER TABLE "{table_name}" '
                        "ADD COLUMN shop_name VARCHAR(120) NOT NULL DEFAULT ''"
                    )
                )

    _bird_count_tables = (
        "inventory_movements",
        "inventory_movement_splits",
        "inventory_transfers",
        "retailer_inventory_usages",
        "retailer_inventory_purchase_lines",
    )
    for table_name in _bird_count_tables:
        if table_name not in table_names:
            continue
        columns = {column["name"] for column in inspector.get_columns(table_name, schema=safe)}
        if "bird_count" in columns:
            continue
        if dialect == "postgresql":
            connection.execute(
                text(
                    f'ALTER TABLE "{table_name}" '
                    "ADD COLUMN IF NOT EXISTS bird_count INTEGER NOT NULL DEFAULT 0"
                )
            )
        else:
            connection.execute(
                text(
                    f'ALTER TABLE "{table_name}" '
                    "ADD COLUMN bird_count INTEGER NOT NULL DEFAULT 0"
                )
            )

    # User FKs must be nullable + ON DELETE SET NULL so hard-deleting a user
    # preserves transaction history (tenant migration 0030).
    _user_fk_set_null_targets = (
        ("retailer_sales", "created_by_user_id"),
        ("retailer_payments", "recorded_by_user_id"),
        ("retailer_wallet_payouts", "recorded_by_user_id"),
        ("bills", "created_by_user_id"),
    )
    if dialect == "postgresql":
        for table_name, column_name in _user_fk_set_null_targets:
            if table_name not in table_names:
                continue
            columns = {
                column["name"]: column
                for column in inspector.get_columns(table_name, schema=safe)
            }
            if column_name not in columns:
                continue
            if not columns[column_name].get("nullable", True):
                connection.execute(
                    text(
                        f'ALTER TABLE "{table_name}" '
                        f"ALTER COLUMN {column_name} DROP NOT NULL"
                    )
                )
            for fk in inspector.get_foreign_keys(table_name, schema=safe):
                if fk.get("constrained_columns") != [column_name] or not fk.get("name"):
                    continue
                if (fk.get("options") or {}).get("ondelete") == "SET NULL":
                    continue
                connection.execute(
                    text(f'ALTER TABLE "{table_name}" DROP CONSTRAINT "{fk["name"]}"')
                )
                connection.execute(
                    text(
                        f'ALTER TABLE "{table_name}" ADD CONSTRAINT "{fk["name"]}" '
                        f"FOREIGN KEY ({column_name}) REFERENCES users(id) ON DELETE SET NULL"
                    )
                )


def ensure_tenant_schema_column_patches(connection: Connection, schema_name: str) -> None:
    """Backward-compatible alias for startup/repair drift patching."""
    ensure_tenant_schema_drift_patches(connection, schema_name)


def create_tenant_tables(connection: Connection, schema_name: str) -> None:
    """Create all tenant tables in the named schema (schema-scoped existence check)."""
    from app import models as _models  # noqa: F401
    from app.db.database import Base

    safe = _safe_schema_name(schema_name)
    inspector = inspect(connection)
    connection.execute(text(f'SET search_path TO "{safe}", public'))
    _ensure_public_billstatus_cancelled_enum(connection)
    _ensure_public_retailer_sale_status_cancelled_enum(connection)
    _ensure_public_retailer_inventory_purchase_status_enum(connection)

    with _reuse_public_pg_enums(connection):
        for table in Base.metadata.sorted_tables:
            if table.name in PLATFORM_TABLES:
                continue
            if inspector.has_table(table.name, schema=safe):
                continue
            table.create(connection, checkfirst=False)

    verify_tenant_schema_ddl(connection, safe)


def drop_tenant_tables(connection: Connection, schema_name: str) -> None:
    from app import models as _models  # noqa: F401
    from app.db.database import Base

    safe = _safe_schema_name(schema_name)
    inspector = inspect(connection)
    connection.execute(text(f'SET search_path TO "{safe}", public'))

    with _reuse_public_pg_enums(connection):
        for table in reversed(Base.metadata.sorted_tables):
            if table.name in PLATFORM_TABLES:
                continue
            if not inspector.has_table(table.name, schema=safe):
                continue
            table.drop(connection, checkfirst=False)
