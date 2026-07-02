"""Schema-per-tenant provisioning and search_path routing."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
import logging
import os
import re
from pathlib import Path
from uuid import UUID

from alembic import command
from alembic.config import Config
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.redis_cache import cache_get_json, cache_set_json, org_schema_cache_key
from app.db.tenant_context_var import (
    get_active_tenant_schema,
    reset_active_tenant_schema,
    set_active_tenant_schema,
)

logger = logging.getLogger(__name__)

_SCHEMA_PREFIX = "tenant_"
_MAX_SCHEMA_LEN = 63
_SAFE_SCHEMA_RE = re.compile(r"^[a-z_][a-z0-9_]*$")

ORG_SCHEMA_CACHE_TTL_SECONDS = 300
TENANT_MIGRATION_HEAD = "0002_drop_tenant_organization_id"


async def is_postgres_session(session: AsyncSession) -> bool:
    inner = getattr(session, "_session", session)
    bind = inner.get_bind() if hasattr(inner, "get_bind") else session.get_bind()
    return bind.dialect.name == "postgresql"


def is_postgres_database() -> bool:
    url = str(get_settings().database_url).lower()
    return "postgresql" in url or "+asyncpg" in url


def sync_postgres_database_url(url: str) -> str:
    """Sync SQLAlchemy URL for psycopg3 (migrate CLI, tenant listing)."""
    if "postgresql+asyncpg:" in url:
        return url.replace("postgresql+asyncpg:", "postgresql+psycopg:", 1)
    return url


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


def _stamp_tenant_alembic_version(connection, schema_name: str) -> None:
    safe = assert_safe_schema_name(schema_name)
    connection.execute(
        text(
            f'CREATE TABLE IF NOT EXISTS "{safe}".alembic_version ('
            "version_num VARCHAR(32) NOT NULL, "
            "CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num))"
        )
    )
    existing = connection.execute(
        text(f'SELECT version_num FROM "{safe}".alembic_version LIMIT 1')
    ).scalar_one_or_none()
    if existing is None:
        connection.execute(
            text(f'INSERT INTO "{safe}".alembic_version (version_num) VALUES (:version)'),
            {"version": TENANT_MIGRATION_HEAD},
        )


async def run_tenant_migrations_async(session: AsyncSession, schema_name: str) -> None:
    """Apply tenant baseline on the caller's session (no extra pool checkout)."""
    if not is_postgres_database():
        return

    from app.db.tenant_metadata import create_tenant_tables

    safe = assert_safe_schema_name(schema_name)
    logger.info("Running tenant migrations for schema %s", safe)
    await session.execute(text(f'SET search_path TO "{safe}", public'))

    def _upgrade(sync_session) -> None:
        connection = sync_session.connection()
        create_tenant_tables(connection, safe)
        _stamp_tenant_alembic_version(connection, safe)

    await session.run_sync(_upgrade)


def repair_tenant_schema_ddl(schema_name: str) -> None:
    """Idempotently create missing tenant tables and stamp alembic_version."""
    if not is_postgres_database():
        return

    from sqlalchemy import create_engine

    from app.db.tenant_metadata import create_tenant_tables, verify_tenant_schema_ddl

    safe = assert_safe_schema_name(schema_name)
    url = sync_postgres_database_url(str(get_settings().database_url))
    engine = create_engine(url, future=True)
    try:
        with engine.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{safe}"'))
            create_tenant_tables(conn, safe)
            verify_tenant_schema_ddl(conn, safe)
            _stamp_tenant_alembic_version(conn, safe)
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
    from sqlalchemy import inspect

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
                        text(
                            "SELECT schema_name FROM organizations "
                            "WHERE schema_name IS NOT NULL"
                        )
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
        run_tenant_migrations(schema_name)
        repair_tenant_schema_ddl(schema_name)
    logger.info("Tenant migrations completed for %s schema(s)", len(schemas))


class TenantSchemaRouter:
    async def resolve_schema(self, db: AsyncSession, organization_id: UUID) -> str | None:
        from app.models import Organization

        cache_key = org_schema_cache_key(organization_id)
        cached = await cache_get_json(cache_key)
        if isinstance(cached, str) and cached:
            return cached

        schema_name = await db.scalar(
            select(Organization.schema_name).where(Organization.id == organization_id)
        )
        if schema_name:
            await cache_set_json(
                cache_key,
                schema_name,
                ttl_seconds=ORG_SCHEMA_CACHE_TTL_SECONDS,
            )
        return schema_name

    async def evict_schema_cache(self, organization_id: UUID) -> None:
        from app.core.redis_cache import cache_delete

        await cache_delete(org_schema_cache_key(organization_id))


tenant_router = TenantSchemaRouter()
