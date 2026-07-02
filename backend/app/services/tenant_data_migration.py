"""Copy legacy public tenant rows into dedicated PostgreSQL schemas."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy import MetaData, Table, inspect, select, text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.schema import CreateSchema

from app.db.database import Base
from app.db.tenant_metadata import (
    PLATFORM_TABLES,
    drop_public_tenant_table_shells,
    tenant_table_names,
)
from app.db.tenant_schema import (
    assert_safe_schema_name,
    create_tenant_schema,
    derive_schema_name,
    is_postgres_database,
    run_tenant_migrations_async,
    set_search_path,
)
from app.core.ids import uuid7
from app.models import Organization
from app.schemas.auth import normalize_username

logger = logging.getLogger(__name__)


def _rel(schema: str, table: str) -> str:
    if schema == "public":
        return f"public.{table}"
    safe = assert_safe_schema_name(schema)
    return f'"{safe}".{table}'


# ponytail: direct org-scoped roots; child tables copied via FK join to these
_ORG_ROOT_TABLES = frozenset(
    {
        "shops",
        "items",
        "item_categories",
        "inventory_categories",
        "inventory_items",
        "expense_items",
        "transfer_shops",
        "admin_roles",
        "users",
        "audit_logs",
        "inventory_backdate_policy",
        "monthly_bill_sequences",
        "whatsapp_users",
    }
)


@dataclass
class TableMigrationReport:
    table: str
    public_count: int = 0
    copied: int = 0
    tenant_count: int = 0


@dataclass
class OrgMigrationReport:
    organization_id: UUID
    slug: str
    schema_name: str
    tables: list[TableMigrationReport] = field(default_factory=list)
    auth_index_rows: int = 0
    public_ddl_dropped: int = 0

    @property
    def ok(self) -> bool:
        return all(row.public_count == row.tenant_count for row in self.tables if row.public_count)


def _tenant_tables() -> list[Table]:
    from app import models as _models  # noqa: F401

    return [
        table
        for table in Base.metadata.sorted_tables
        if table.name not in PLATFORM_TABLES and table.name != "alembic_version"
    ]


def _table_has_column(table: Table, column_name: str) -> bool:
    return column_name in table.c


def _public_count(conn: Connection, table_name: str, org_id: UUID) -> int:
    if not inspect(conn).has_table(table_name, schema="public"):
        return 0
    table = Table(table_name, MetaData(), autoload_with=conn)
    if _table_has_column(table, "organization_id"):
        return conn.execute(
            text(f"SELECT COUNT(*) FROM public.{table_name} WHERE organization_id = :org_id"),
            {"org_id": org_id},
        ).scalar_one()
    if table_name == "users":
        return conn.execute(
            text(
                "SELECT COUNT(*) FROM public.users "
                "WHERE organization_id = :org_id AND organization_id IS NOT NULL"
            ),
            {"org_id": org_id},
        ).scalar_one()
    return _child_public_count(conn, table_name, org_id)


def _child_public_count(conn: Connection, table_name: str, org_id: UUID) -> int:
    sql = _child_select_sql(table_name, org_id, count_only=True)
    if sql is None:
        return 0
    return conn.execute(text(sql), {"org_id": org_id}).scalar_one()


def _child_select_sql(
    table_name: str, org_id: UUID, *, count_only: bool, schema: str = "public"
) -> str | None:
    if table_name in _ORG_ROOT_TABLES:
        return None
    expense_item_children = {"expense_entries", "shop_expense_allocations"}
    if table_name in expense_item_children:
        shop_link = (
            f"EXISTS (SELECT 1 FROM {_rel(schema, 'shops')} s "
            f"WHERE s.organization_id = :org_id AND {_fk_exists_clause(table_name, 's', schema=schema)})"
        )
        item_link = (
            f"EXISTS (SELECT 1 FROM {_rel(schema, 'expense_items')} ei "
            "WHERE ei.organization_id = :org_id AND ei.id = p.expense_item_id)"
        )
        where = f"WHERE ({shop_link} OR {item_link})"
        if count_only:
            return f"SELECT COUNT(*) FROM {_rel(schema, table_name)} p {where}"
        return f"SELECT p.* FROM {_rel(schema, table_name)} p {where}"
    # Common child patterns via shops
    shop_children = {
        "bills",
        "bill_items",
        "daily_prices",
        "receipts",
        "payments",
        "shop_item_allocations",
        "shop_inventory_allocations",
        "inventory_movements",
        "inventory_movement_splits",
        "whatsapp_user_shops",
        "whatsapp_conversations",
        "processed_whatsapp_messages",
    }
    if table_name in shop_children:
        if count_only:
            return (
                f"SELECT COUNT(*) FROM {_rel(schema, table_name)} p "
                "WHERE EXISTS ("
                f"SELECT 1 FROM {_rel(schema, 'shops')} s "
                f"WHERE s.organization_id = :org_id AND {_fk_exists_clause(table_name, 's', schema=schema)}"
                ")"
            )
        return (
            f"SELECT p.* FROM {_rel(schema, table_name)} p "
            "WHERE EXISTS ("
            f"SELECT 1 FROM {_rel(schema, 'shops')} s "
            f"WHERE s.organization_id = :org_id AND {_fk_exists_clause(table_name, 's', schema=schema)}"
            ")"
        )
    item_children = {"item_change_events"}
    if table_name in item_children:
        col = "item_id"
        if count_only:
            return (
                f"SELECT COUNT(*) FROM {_rel(schema, table_name)} p "
                f"WHERE EXISTS (SELECT 1 FROM {_rel(schema, 'items')} i "
                f"WHERE i.organization_id = :org_id AND i.id = p.{col})"
            )
        return (
            f"SELECT p.* FROM {_rel(schema, table_name)} p "
            f"WHERE EXISTS (SELECT 1 FROM {_rel(schema, 'items')} i "
            f"WHERE i.organization_id = :org_id AND i.id = p.{col})"
        )
    rbac_children = {"admin_role_permissions", "admin_user_roles"}
    if table_name in rbac_children:
        role_col = "role_id"
        if count_only:
            return (
                f"SELECT COUNT(*) FROM {_rel(schema, table_name)} p "
                f"WHERE EXISTS (SELECT 1 FROM {_rel(schema, 'admin_roles')} r "
                f"WHERE r.organization_id = :org_id AND r.id = p.{role_col})"
            )
        return (
            f"SELECT p.* FROM {_rel(schema, table_name)} p "
            f"WHERE EXISTS (SELECT 1 FROM {_rel(schema, 'admin_roles')} r "
            f"WHERE r.organization_id = :org_id AND r.id = p.{role_col})"
        )
    inv_children = {
        "inventory_item_categories",
        "inventory_item_billing_mappings",
        "inventory_item_purchase_rate_history",
    }
    if table_name in inv_children:
        if count_only:
            return (
                f"SELECT COUNT(*) FROM {_rel(schema, table_name)} p "
                f"WHERE EXISTS (SELECT 1 FROM {_rel(schema, 'inventory_items')} i "
                "WHERE i.organization_id = :org_id AND i.id = p.inventory_item_id)"
            )
        return (
            f"SELECT p.* FROM {_rel(schema, table_name)} p "
            f"WHERE EXISTS (SELECT 1 FROM {_rel(schema, 'inventory_items')} i "
            "WHERE i.organization_id = :org_id AND i.id = p.inventory_item_id)"
        )
    if table_name == "inventory_transfers":
        if count_only:
            return (
                f"SELECT COUNT(*) FROM {_rel(schema, table_name)} p "
                f"WHERE EXISTS (SELECT 1 FROM {_rel(schema, 'transfer_shops')} t "
                "WHERE t.organization_id = :org_id AND t.id = p.transfer_shop_id)"
            )
        return (
            f"SELECT p.* FROM {_rel(schema, table_name)} p "
            f"WHERE EXISTS (SELECT 1 FROM {_rel(schema, 'transfer_shops')} t "
            "WHERE t.organization_id = :org_id AND t.id = p.transfer_shop_id)"
        )
    logger.warning("No org filter for table %s — skipping", table_name)
    return None


def _child_delete_sql(table_name: str, org_id: UUID, *, schema: str = "public") -> str | None:
    count_sql = _child_select_sql(table_name, org_id, count_only=True, schema=schema)
    if count_sql is None:
        return None
    prefix = f"SELECT COUNT(*) FROM {_rel(schema, table_name)} p "
    if not count_sql.startswith(prefix):
        return None
    return f"DELETE FROM {_rel(schema, table_name)} p {count_sql[len(prefix):]}"


def _fk_exists_clause(table_name: str, shop_alias: str, *, schema: str = "public") -> str:
    bills = _rel(schema, "bills")
    movements = _rel(schema, "inventory_movements")
    whatsapp_users = _rel(schema, "whatsapp_users")
    whatsapp_user_shops = _rel(schema, "whatsapp_user_shops")
    mapping = {
        "bills": f"{shop_alias}.id = p.shop_id",
        "bill_items": f"EXISTS (SELECT 1 FROM {bills} b WHERE b.shop_id = {shop_alias}.id AND b.id = p.bill_id)",
        "daily_prices": f"{shop_alias}.id = p.shop_id",
        "receipts": f"EXISTS (SELECT 1 FROM {bills} b WHERE b.shop_id = {shop_alias}.id AND b.id = p.bill_id)",
        "payments": f"EXISTS (SELECT 1 FROM {bills} b WHERE b.shop_id = {shop_alias}.id AND b.id = p.bill_id)",
        "shop_item_allocations": f"{shop_alias}.id = p.shop_id",
        "shop_expense_allocations": f"{shop_alias}.id = p.shop_id",
        "shop_inventory_allocations": f"{shop_alias}.id = p.shop_id",
        "expense_entries": f"{shop_alias}.id = p.shop_id",
        "inventory_movements": f"{shop_alias}.id = p.shop_id",
        "inventory_movement_splits": (
            f"EXISTS (SELECT 1 FROM {movements} m "
            f"WHERE m.shop_id = {shop_alias}.id AND m.id = p.movement_id)"
        ),
        "whatsapp_user_shops": f"{shop_alias}.id = p.shop_id",
        "whatsapp_conversations": (
            f"EXISTS (SELECT 1 FROM {whatsapp_users} wu "
            f"JOIN {whatsapp_user_shops} wus ON wus.user_id = wu.id "
            f"WHERE wus.shop_id = {shop_alias}.id AND wu.phone_number = p.phone_number)"
        ),
        "processed_whatsapp_messages": (
            f"EXISTS (SELECT 1 FROM {whatsapp_users} wu "
            f"JOIN {whatsapp_user_shops} wus ON wus.user_id = wu.id "
            f"WHERE wus.shop_id = {shop_alias}.id AND wu.phone_number = p.phone_number)"
        ),
    }
    return mapping.get(table_name, f"{shop_alias}.id = p.shop_id")


def _common_column_names(conn: Connection, table_name: str, schema: str) -> list[str]:
    insp = inspect(conn)
    if not insp.has_table(table_name, schema="public"):
        return []
    public_names = {c["name"] for c in insp.get_columns(table_name, schema="public")}
    tenant_cols = insp.get_columns(table_name, schema=schema)
    return [c["name"] for c in tenant_cols if c["name"] in public_names]


def _copy_table(conn: Connection, schema: str, table: Table, org_id: UUID) -> int:
    safe = assert_safe_schema_name(schema)
    name = table.name
    cols = _common_column_names(conn, name, safe)
    if not cols:
        return 0
    col_list = ", ".join(cols)
    if _table_has_column(table, "organization_id"):
        result = conn.execute(
            text(
                f'INSERT INTO "{safe}".{name} ({col_list}) '
                f"SELECT {col_list} FROM public.{name} WHERE organization_id = :org_id "
                "ON CONFLICT DO NOTHING"
            ),
            {"org_id": org_id},
        )
        return result.rowcount or 0
    if name == "users":
        result = conn.execute(
            text(
                f'INSERT INTO "{safe}".users ({col_list}) '
                f"SELECT {col_list} FROM public.users WHERE organization_id = :org_id "
                "ON CONFLICT DO NOTHING"
            ),
            {"org_id": org_id},
        )
        return result.rowcount or 0
    select_sql = _child_select_sql(name, org_id, count_only=True)
    if select_sql is None:
        return 0
    prefix = f"SELECT COUNT(*) FROM public.{name} p "
    if not select_sql.startswith(prefix):
        return 0
    result = conn.execute(
        text(
            f'INSERT INTO "{safe}".{name} ({col_list}) '
            f"SELECT {col_list} FROM public.{name} p {select_sql[len(prefix):]} "
            "ON CONFLICT DO NOTHING"
        ),
        {"org_id": org_id},
    )
    return result.rowcount or 0


def _tenant_count(conn: Connection, schema: str, table_name: str) -> int:
    safe = assert_safe_schema_name(schema)
    return conn.execute(text(f'SELECT COUNT(*) FROM "{safe}".{table_name}')).scalar_one()


def _build_auth_index(conn: Connection, schema: str, org_id: UUID) -> int:
    safe = assert_safe_schema_name(schema)
    rows = conn.execute(
        text(
            f'SELECT id, username FROM "{safe}".users WHERE organization_id = :org_id'
        ),
        {"org_id": org_id},
    ).all()
    count = 0
    for user_id, username in rows:
        username_lower = normalize_username(username)
        conn.execute(
            text(
                "INSERT INTO public.user_auth_index "
                "(id, username_lower, organization_id, schema_name, user_id) "
                "VALUES (:id, :username_lower, :org_id, :schema_name, :user_id) "
                "ON CONFLICT (username_lower) DO UPDATE "
                "SET schema_name = EXCLUDED.schema_name, "
                "user_id = EXCLUDED.user_id, "
                "organization_id = EXCLUDED.organization_id"
            ),
            {
                "id": uuid7(),
                "username_lower": username_lower,
                "org_id": org_id,
                "schema_name": safe,
                "user_id": user_id,
            },
        )
        count += 1
    return count


def _delete_org_scoped_tenant_rows(conn: Connection, org_id: UUID, schema: str) -> None:
    insp = inspect(conn)
    pg_schema = "public" if schema == "public" else assert_safe_schema_name(schema)
    for table in reversed(_tenant_tables()):
        name = table.name
        if not insp.has_table(name, schema=pg_schema):
            continue
        if _table_has_column(table, "organization_id"):
            conn.execute(
                text(f"DELETE FROM {_rel(pg_schema, name)} WHERE organization_id = :org_id"),
                {"org_id": org_id},
            )
        elif name == "users":
            conn.execute(
                text(f"DELETE FROM {_rel(pg_schema, 'users')} WHERE organization_id = :org_id"),
                {"org_id": org_id},
            )
        else:
            delete_sql = _child_delete_sql(name, org_id, schema=pg_schema)
            if delete_sql is None:
                continue
            conn.execute(text(delete_sql), {"org_id": org_id})


def _delete_public_tenant_rows(conn: Connection, org_id: UUID) -> None:
    _delete_org_scoped_tenant_rows(conn, org_id, "public")


def purge_public_tenant_rows_for_org(conn: Connection, org_id: UUID) -> None:
    """Delete legacy public tenant rows for one org (pre-cutover leftovers)."""
    _delete_public_tenant_rows(conn, org_id)


def purge_organization_rows_for_hard_delete(
    conn: Connection,
    org_id: UUID,
    *,
    skip_schema: str | None,
) -> None:
    """Drop org-scoped rows everywhere before deleting public.organizations."""
    from app.db.tenant_schema import list_tenant_schema_names_from_db

    _delete_org_scoped_tenant_rows(conn, org_id, "public")
    for schema_name in list_tenant_schema_names_from_db():
        if schema_name == skip_schema:
            continue
        _delete_org_scoped_tenant_rows(conn, org_id, schema_name)


def migrate_organization_data(
    engine: Engine,
    org: Organization,
    *,
    dry_run: bool = False,
    execute: bool = False,
) -> OrgMigrationReport:
    if not is_postgres_database():
        raise RuntimeError("Tenant data migration requires PostgreSQL")

    schema_name = org.schema_name or derive_schema_name(org.slug)
    report = OrgMigrationReport(organization_id=org.id, slug=org.slug, schema_name=schema_name)

    with engine.begin() as conn:
        report.schema_name = org.schema_name or derive_schema_name(org.slug)

        if dry_run and not execute:
            for table in _tenant_tables():
                public_count = _public_count(conn, table.name, org.id)
                report.tables.append(
                    TableMigrationReport(
                        table=table.name,
                        public_count=public_count,
                        copied=public_count,
                        tenant_count=public_count,
                    )
                )
            report.auth_index_rows = conn.execute(
                text("SELECT COUNT(*) FROM public.users WHERE organization_id = :org_id"),
                {"org_id": org.id},
            ).scalar_one()
            return report

        if not execute:
            raise RuntimeError("Pass --execute to apply migration (use --dry-run to preview)")

        safe = assert_safe_schema_name(report.schema_name)
        if org.schema_name is None:
            conn.execute(
                text(
                    "UPDATE public.organizations SET schema_name = :schema_name WHERE id = :org_id"
                ),
                {"schema_name": safe, "org_id": org.id},
            )

        conn.execute(CreateSchema(safe, if_not_exists=True))
        from app.db.tenant_metadata import create_tenant_tables

        conn.execute(text(f'SET search_path TO "{safe}", public'))
        create_tenant_tables(conn, safe)
        conn.execute(text("SET search_path TO public"))

        for table in _tenant_tables():
            public_count = _public_count(conn, table.name, org.id)
            copied = _copy_table(conn, safe, table, org.id) if public_count else 0
            tenant_count = _tenant_count(conn, safe, table.name)
            report.tables.append(
                TableMigrationReport(
                    table=table.name,
                    public_count=public_count,
                    copied=copied,
                    tenant_count=tenant_count,
                )
            )

        report.auth_index_rows = _build_auth_index(conn, safe, org.id)

        if not report.ok:
            raise RuntimeError(f"Migration verification failed for org {org.slug}")

        _delete_public_tenant_rows(conn, org.id)
        report.public_ddl_dropped = drop_public_tenant_table_shells(conn)

    return report


def cleanup_public_migrated_backups(engine: Engine) -> int:
    """Drop public._migrated_* backup tables left after tenant data migration."""
    dropped = 0
    with engine.begin() as conn:
        rows = conn.execute(
            text(
                "SELECT tablename FROM pg_tables "
                "WHERE schemaname = 'public' AND tablename LIKE '_migrated_%'"
            )
        ).all()
        for (table_name,) in rows:
            conn.execute(text(f'DROP TABLE IF EXISTS public."{table_name}" CASCADE'))
            dropped += 1
    return dropped


def format_report(report: OrgMigrationReport) -> str:
    lines = [
        f"Organization {report.slug} ({report.organization_id}) -> {report.schema_name}",
        f"{'table':<40} {'public':>8} {'copied':>8} {'tenant':>8}",
    ]
    for row in report.tables:
        lines.append(
            f"{row.table:<40} {row.public_count:>8} {row.copied:>8} {row.tenant_count:>8}"
        )
    lines.append(f"auth_index_rows: {report.auth_index_rows}")
    if report.public_ddl_dropped:
        lines.append(f"public_ddl_dropped: {report.public_ddl_dropped}")
    lines.append(f"ok: {report.ok}")
    return "\n".join(lines)
