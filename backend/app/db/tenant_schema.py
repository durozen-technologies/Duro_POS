"""Schema-per-tenant provisioning and search_path routing."""

from __future__ import annotations

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
from app.models import Organization

logger = logging.getLogger(__name__)

_SCHEMA_PREFIX = "tenant_"
_MAX_SCHEMA_LEN = 63
_SAFE_SCHEMA_RE = re.compile(r"^[a-z_][a-z0-9_]*$")

ORG_SCHEMA_CACHE_TTL_SECONDS = 300
TENANT_MIGRATION_HEAD = "0001_tenant_baseline"


async def is_postgres_session(session: AsyncSession) -> bool:
    inner = getattr(session, "_session", session)
    bind = inner.get_bind() if hasattr(inner, "get_bind") else session.get_bind()
    return bind.dialect.name == "postgresql"


def is_postgres_database() -> bool:
    url = str(get_settings().database_url).lower()
    return "postgresql" in url or "+asyncpg" in url


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
    # ponytail: schema-per-tenant is Postgres-only; SQLite tests skip search_path
    if not is_postgres_database():
        return
    await session.execute(text("RESET search_path"))
    if schema_name:
        safe = assert_safe_schema_name(schema_name)
        await session.execute(text(f'SET search_path TO "{safe}", public'))
    else:
        await session.execute(text("SET search_path TO public"))


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
        create_tenant_tables(connection)
        _stamp_tenant_alembic_version(connection, safe)

    await session.run_sync(_upgrade)


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


class TenantSchemaRouter:
    async def resolve_schema(self, db: AsyncSession, organization_id: UUID) -> str | None:
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
