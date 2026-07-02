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
        raise RuntimeError(
            f"public schema has {len(extra)} non-platform table(s): {extra}"
        )

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
        raise RuntimeError(
            f"Tenant schema {safe!r} is missing {len(missing)} table(s): {missing}"
        )


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
