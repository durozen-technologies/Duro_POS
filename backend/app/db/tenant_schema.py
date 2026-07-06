"""Schema-per-tenant provisioning and search_path routing."""

import logging
import os
import re
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import UUID

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.tenant_context_var import (
    get_active_tenant_schema,
    reset_active_tenant_schema,
    set_active_tenant_schema,
)

logger = logging.getLogger(__name__)

_SCHEMA_PREFIX = "tenant_"
_MAX_SCHEMA_LEN = 63
_SAFE_SCHEMA_RE = re.compile(r"^[a-z_][a-z0-9_]*$")

TENANT_MIGRATION_HEAD = "0013_daily_prices_published"
RETAILER_RBAC_PERMISSIONS = ("retailers.read", "retailers.manage")


async def is_postgres_session(session: AsyncSession) -> bool:
    inner = getattr(session, "_session", session)
    bind = inner.get_bind() if hasattr(inner, "get_bind") else session.get_bind()
    return bind.dialect.name == "postgresql"


def is_postgres_database() -> bool:
    url = str(get_settings().database_url).lower()
    return "postgresql" in url or "+asyncpg" in url


from app.db.postgres_url import sync_postgres_database_url


def derive_schema_name(slug: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "_", slug.strip().lower()).strip("_")
    if not normalized:
        raise ValueError("Cannot derive schema name from empty slug")
    return f"{_SCHEMA_PREFIX}{normalized}"[:_MAX_SCHEMA_LEN]


def assert_safe_schema_name(schema_name: str) -> str:
    if not _SAFE_SCHEMA_RE.match(schema_name) or len(schema_name) > _MAX_SCHEMA_LEN:
        raise ValueError(f"Invalid schema name: {schema_name!r}")
    return schema_name


async def set_search_path(session: AsyncSession, schema_name: str | None) -> None:
    if not await is_postgres_session(session):
        return
    await session.execute(text("RESET search_path"))
    if schema_name:
        safe = assert_safe_schema_name(schema_name)
        await session.execute(text(f'SET search_path TO "{safe}", public'))
    else:
        await session.execute(text("SET search_path TO public"))


@asynccontextmanager
async def tenant_schema_scope(
    session: AsyncSession,
    schema_name: str,
) -> AsyncGenerator[None, None]:
    token = set_active_tenant_schema(schema_name)
    try:
        await set_search_path(session, schema_name)
        yield
    finally:
        reset_active_tenant_schema(token)
        await set_search_path(session, get_active_tenant_schema())


async def resolve_org_schema(session: AsyncSession, organization_id: UUID) -> str:
    schema_name = await tenant_router.resolve_schema(session, organization_id)
    if not schema_name:
        raise ValueError(f"No tenant schema for organization {organization_id}")
    return schema_name


async def create_tenant_schema(session: AsyncSession, schema_name: str) -> None:
    if not is_postgres_database():
        return
    safe = assert_safe_schema_name(schema_name)
    await session.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{safe}"'))


def _ensure_tenant_retailer_permissions(connection, schema_name: str) -> None:
    """Idempotent grant of retailer RBAC codes (mirrors tenant migration 0004)."""
    from sqlalchemy import inspect as sa_inspect

    safe = assert_safe_schema_name(schema_name)
    connection.execute(text(f'SET search_path TO "{safe}", public'))
    inspector = sa_inspect(connection)
    if not inspector.has_table("admin_role_permissions"):
        return
    for code in RETAILER_RBAC_PERMISSIONS:
        connection.execute(
            text(
                """
                INSERT INTO admin_role_permissions (role_id, permission_code)
                SELECT r.id, :code
                FROM admin_roles r
                WHERE r.is_system = TRUE AND r.name = 'TenantFullAdmin'
                ON CONFLICT DO NOTHING
                """
            ),
            {"code": code},
        )
    if inspector.has_table("users"):
        connection.execute(
            text(
                "UPDATE users SET permissions_version = permissions_version + 1 "
                "WHERE role = 'TENANT_ADMIN'"
            )
        )


def _stamp_tenant_alembic_head(connection, schema_name: str) -> None:
    """Record tenant head revision after idempotent drift repair."""
    safe = assert_safe_schema_name(schema_name)
    connection.execute(
        text(
            f'CREATE TABLE IF NOT EXISTS "{safe}".alembic_version ('
            "version_num VARCHAR(32) NOT NULL, "
            "CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num))"
        )
    )
    connection.execute(text(f'DELETE FROM "{safe}".alembic_version'))
    connection.execute(
        text(f'INSERT INTO "{safe}".alembic_version (version_num) VALUES (:version)'),
        {"version": TENANT_MIGRATION_HEAD},
    )


async def run_tenant_migrations_async(session: AsyncSession, schema_name: str) -> None:
    """Apply tenant baseline on the caller's session (no extra pool checkout)."""
    if not is_postgres_database():
        return

    from app.db.tenant_metadata import create_tenant_tables, ensure_tenant_schema_drift_patches

    safe = assert_safe_schema_name(schema_name)
    logger.info("Running tenant migrations for schema %s", safe)
    await session.execute(text(f'SET search_path TO "{safe}", public'))

    def _bootstrap(sync_session) -> None:
        create_tenant_tables(sync_session.connection(), safe)

    await session.run_sync(_bootstrap)
    run_tenant_migrations(safe)

    def _finalize(sync_session) -> None:
        connection = sync_session.connection()
        ensure_tenant_schema_drift_patches(connection, safe)
        _ensure_tenant_retailer_permissions(connection, safe)

    await session.run_sync(_finalize)


def repair_tenant_schema_ddl(schema_name: str) -> None:
    """Idempotently create missing tenant tables and apply tenant Alembic upgrades."""
    if not is_postgres_database():
        return

    from sqlalchemy import create_engine

    from app.db.tenant_metadata import (
        create_tenant_tables,
        ensure_tenant_schema_drift_patches,
        verify_tenant_schema_ddl,
    )

    safe = assert_safe_schema_name(schema_name)
    url = sync_postgres_database_url(str(get_settings().database_url))
    engine = create_engine(url, future=True)
    try:
        with engine.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{safe}"'))
            create_tenant_tables(conn, safe)
        run_tenant_migrations(safe)
        with engine.begin() as conn:
            ensure_tenant_schema_drift_patches(conn, safe)
            verify_tenant_schema_ddl(conn, safe)
            _stamp_tenant_alembic_head(conn, safe)
            _ensure_tenant_retailer_permissions(conn, safe)
        logger.info("Repaired tenant DDL for schema %s", safe)
    finally:
        engine.dispose()


def run_all_tenant_ddl_repairs(schema_filter: str | None = None) -> None:
    if not is_postgres_database():
        logger.info("Skipping tenant DDL repair (not PostgreSQL)")
        return

    schemas = list_tenant_schema_names_from_db(schema_filter)
    if schema_filter and not schemas:
        raise SystemExit(f"Invalid tenant schema name: {schema_filter!r}")

    if not schemas:
        logger.info("No tenant schemas found to repair")
        return

    for schema_name in schemas:
        repair_tenant_schema_ddl(schema_name)
    logger.info("Tenant DDL repair completed for %s schema(s)", len(schemas))


def run_tenant_migrations(schema_name: str) -> None:
    """Sync entry for CLI scripts (no running event loop)."""
    if not is_postgres_database():
        return
    safe = assert_safe_schema_name(schema_name)
    backend_root = Path(__file__).resolve().parents[2]
    os.environ["TARGET_SCHEMA"] = safe
    alembic_config = Config(str(backend_root / "migrations" / "tenant" / "alembic.ini"))
    alembic_config.set_main_option("script_location", str(backend_root / "migrations" / "tenant"))
    logger.info("Running tenant migrations for schema %s", safe)
    command.upgrade(alembic_config, TENANT_MIGRATION_HEAD)


def _public_table_exists(connection, table_name: str) -> bool:

    return inspect(connection).has_table(table_name, schema="public")


def list_tenant_schema_names_from_db(schema_filter: str | None = None) -> list[str]:
    """List tenant schemas for migrate/repair CLI.

    Sources (unioned when unfiltered):
    - organizations.schema_name (when public.organizations exists)
    - existing information_schema schemata named tenant_*
    Explicit --schema is honored without an organizations row.
    """
    if not is_postgres_database():
        return []

    from sqlalchemy import create_engine, text

    if schema_filter:
        return [assert_safe_schema_name(schema_filter)]

    url = str(get_settings().database_url)
    if "+asyncpg" in url:
        url = sync_postgres_database_url(url)

    engine = create_engine(url, future=True)
    try:
        with engine.connect() as conn:
            names: set[str] = set()
            if _public_table_exists(conn, "organizations"):
                names.update(
                    conn.execute(
                        text("SELECT schema_name FROM organizations WHERE schema_name IS NOT NULL")
                    ).scalars()
                )
            names.update(
                conn.execute(
                    text(
                        "SELECT schema_name FROM information_schema.schemata "
                        "WHERE schema_name LIKE 'tenant_%'"
                    )
                ).scalars()
            )
            return sorted(names)
    finally:
        engine.dispose()


def platform_schema_ready() -> bool:
    """True when public platform tables (organizations) exist."""
    if not is_postgres_database():
        return True

    from sqlalchemy import create_engine

    url = sync_postgres_database_url(str(get_settings().database_url))
    engine = create_engine(url, future=True)
    try:
        with engine.connect() as conn:
            return _public_table_exists(conn, "organizations")
    finally:
        engine.dispose()


def run_all_tenant_migrations(schema_filter: str | None = None) -> None:
    if not is_postgres_database():
        logger.info("Skipping tenant migrations (not PostgreSQL)")
        return

    schemas = list_tenant_schema_names_from_db(schema_filter)
    if schema_filter and not schemas:
        raise SystemExit(f"Invalid tenant schema name: {schema_filter!r}")

    if not schemas:
        logger.info("No tenant schemas found to repair")
        return

    for schema_name in schemas:
        repair_tenant_schema_ddl(schema_name)
    logger.info("Tenant migrations completed for %s schema(s)", len(schemas))


class TenantSchemaRouter:
    async def resolve_schema(self, db: AsyncSession, organization_id: UUID) -> str | None:
        from app.models import Organization

        return await db.scalar(
            select(Organization.schema_name).where(Organization.id == organization_id)
        )


tenant_router = TenantSchemaRouter()
