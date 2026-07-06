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
    connection.execute(
        text(
            """
            DO $$
            BEGIN
                CREATE TYPE receiptstatus AS ENUM ('pending', 'printed', 'failed');
            EXCEPTION
                WHEN duplicate_object THEN NULL;
            END
            $$;
            """
        )
    )


def ensure_tenant_schema_drift_patches(connection: Connection, schema_name: str) -> None:
    """Idempotent tenant DDL when alembic_version is ahead of the physical schema."""
    safe = _safe_schema_name(schema_name)
    connection.execute(text(f'SET search_path TO "{safe}", public'))
    dialect = connection.dialect.name
    inspector = inspect(connection)
    table_names = set(inspector.get_table_names(schema=safe))

    if "checkout_snapshots" not in table_names:
        create_tenant_tables(connection, safe)
        inspector = inspect(connection)
        table_names = set(inspector.get_table_names(schema=safe))

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
                        "receiptstatus NOT NULL DEFAULT 'printed'"
                    )
                )
                connection.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_receipts_receipt_status "
                        "ON receipts (receipt_status)"
                    )
                )
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
