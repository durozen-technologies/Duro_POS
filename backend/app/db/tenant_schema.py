"""Schema-per-tenant provisioning and search_path routing."""

import logging
import os
import re
import threading
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager, contextmanager, nullcontext
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

TENANT_MIGRATION_HEAD = "0028_inventory_expense_global_image_template"
RETAILER_RBAC_PERMISSIONS = ("retailers.read", "retailers.manage")
_tenant_drift_repair_lock = threading.Lock()
_tenant_drift_repaired_head: dict[str, str] = {}
_ALEMBIC_LOGGERS = (
    logging.getLogger("alembic"),
    logging.getLogger("alembic.runtime.migration"),
)


@contextmanager
def _quiet_alembic_logs():
    previous = {lg: lg.level for lg in _ALEMBIC_LOGGERS}
    for lg in _ALEMBIC_LOGGERS:
        lg.setLevel(logging.WARNING)
    try:
        yield
    finally:
        for lg, level in previous.items():
            lg.setLevel(level)


def _migration_info(quiet: bool, msg: str, *args) -> None:
    if quiet:
        logger.debug(msg, *args)
    else:
        logger.info(msg, *args)


def _tenant_schema_exists(connection, schema_name: str) -> bool:
    safe = assert_safe_schema_name(schema_name)
    return (
        connection.execute(
            text("SELECT 1 FROM information_schema.schemata WHERE schema_name = :name"),
            {"name": safe},
        ).scalar_one_or_none()
        is not None
    )


def _finalize_tenant_schema(connection, schema_name: str) -> None:
    from app.db.tenant_metadata import ensure_tenant_schema_drift_patches, verify_tenant_schema_ddl

    ensure_tenant_schema_drift_patches(connection, schema_name)
    verify_tenant_schema_ddl(connection, schema_name)
    _ensure_tenant_retailer_permissions(connection, schema_name)


def _tenant_schema_ddl_is_complete(connection, schema_name: str) -> bool:
    from app.db.tenant_metadata import verify_tenant_schema_ddl

    safe = assert_safe_schema_name(schema_name)
    if not _tenant_schema_exists(connection, safe):
        return False
    try:
        verify_tenant_schema_ddl(connection, safe)
        return True
    except RuntimeError:
        return False


def _sync_tenant_schema_to_head(connection, schema_name: str) -> None:
    """Stamp Alembic head when physical DDL already matches models."""
    _finalize_tenant_schema(connection, schema_name)
    _stamp_tenant_alembic_head(connection, schema_name)


def _provision_fresh_tenant_schema(connection, schema_name: str) -> None:
    from app.db.tenant_metadata import create_tenant_tables

    safe = assert_safe_schema_name(schema_name)
    create_tenant_tables(connection, safe)
    _sync_tenant_schema_to_head(connection, safe)


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
        ensure_tenant_schema_drift_repaired(safe)
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
            "version_num VARCHAR(64) NOT NULL, "
            "CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num))"
        )
    )
    connection.execute(text(f'DELETE FROM "{safe}".alembic_version'))
    connection.execute(
        text(f'INSERT INTO "{safe}".alembic_version (version_num) VALUES (:version)'),
        {"version": TENANT_MIGRATION_HEAD},
    )


def _read_tenant_alembic_revision(connection, schema_name: str) -> str | None:
    safe = assert_safe_schema_name(schema_name)
    if not inspect(connection).has_table("alembic_version", schema=safe):
        return None
    return connection.execute(
        text(f'SELECT version_num FROM "{safe}".alembic_version LIMIT 1')
    ).scalar_one_or_none()


async def provision_tenant_schema_async(session: AsyncSession, schema_name: str) -> None:
    """Bootstrap a new tenant schema from models at current head (no Alembic run)."""
    if not is_postgres_database():
        return

    safe = assert_safe_schema_name(schema_name)
    _migration_info(True, "Provisioning tenant schema %s", safe)
    await session.execute(text(f'SET search_path TO "{safe}", public'))

    def _provision(sync_session) -> None:
        connection = sync_session.connection()
        _provision_fresh_tenant_schema(connection, safe)

    await session.run_sync(_provision)


async def run_tenant_migrations_async(session: AsyncSession, schema_name: str) -> None:
    """Upgrade a tenant schema when Alembic revision is behind head."""
    if not is_postgres_database():
        return

    safe = assert_safe_schema_name(schema_name)
    await session.flush()
    ensure_tenant_schema_drift_repaired(safe)


def ensure_tenant_schema_drift_repaired(schema_name: str) -> None:
    """Apply idempotent tenant DDL patches once per schema per migration head."""
    if not is_postgres_database():
        return
    safe = assert_safe_schema_name(schema_name)
    if _tenant_drift_repaired_head.get(safe) == TENANT_MIGRATION_HEAD:
        return
    with _tenant_drift_repair_lock:
        if _tenant_drift_repaired_head.get(safe) == TENANT_MIGRATION_HEAD:
            return
        repair_tenant_schema_ddl(safe, quiet=True)
        _tenant_drift_repaired_head[safe] = TENANT_MIGRATION_HEAD


def repair_tenant_schema_ddl(schema_name: str, *, quiet: bool = False) -> bool:
    """Idempotently create missing tenant tables and apply tenant Alembic upgrades.

    Returns True when schema was created, upgraded, or materially repaired.
    Returns False when schema was already at head (cheap drift check only).
    """
    if not is_postgres_database():
        return False

    from sqlalchemy import create_engine

    from app.db.tenant_metadata import create_tenant_tables, ensure_tenant_schema_drift_patches

    safe = assert_safe_schema_name(schema_name)
    url = sync_postgres_database_url(str(get_settings().database_url))
    engine = create_engine(url, future=True)
    try:
        with engine.connect() as conn:
            exists = _tenant_schema_exists(conn, safe)
            current_revision = _read_tenant_alembic_revision(conn, safe) if exists else None
            ddl_complete = exists and _tenant_schema_ddl_is_complete(conn, safe)

        if exists and current_revision == TENANT_MIGRATION_HEAD:
            with engine.begin() as conn:
                _finalize_tenant_schema(conn, safe)
            _migration_info(quiet, "Tenant schema %s up to date", safe)
            return False

        material_change = not exists or current_revision != TENANT_MIGRATION_HEAD
        with engine.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{safe}"'))
            if not exists or (current_revision is None and not ddl_complete):
                _provision_fresh_tenant_schema(conn, safe)
            elif current_revision is None and ddl_complete:
                _sync_tenant_schema_to_head(conn, safe)
            else:
                create_tenant_tables(conn, safe)
                ensure_tenant_schema_drift_patches(conn, safe)
                if ddl_complete and current_revision != TENANT_MIGRATION_HEAD:
                    _sync_tenant_schema_to_head(conn, safe)
                    current_revision = TENANT_MIGRATION_HEAD

        if current_revision not in (None, TENANT_MIGRATION_HEAD):
            run_tenant_migrations(safe, quiet=quiet)
            with engine.begin() as conn:
                if _read_tenant_alembic_revision(conn, safe) != TENANT_MIGRATION_HEAD:
                    _sync_tenant_schema_to_head(conn, safe)
            material_change = True

        if material_change:
            _migration_info(quiet, "Repaired tenant DDL for schema %s", safe)
        return material_change
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


def run_tenant_migrations(schema_name: str, *, quiet: bool = False) -> bool:
    """Sync Alembic upgrade for one tenant schema. Returns True when upgrade ran."""
    if not is_postgres_database():
        return False

    from sqlalchemy import create_engine

    safe = assert_safe_schema_name(schema_name)
    url = sync_postgres_database_url(str(get_settings().database_url))
    engine = create_engine(url, future=True)
    try:
        with engine.connect() as conn:
            current_revision = _read_tenant_alembic_revision(conn, safe)
            ddl_complete = _tenant_schema_ddl_is_complete(conn, safe)
        if current_revision == TENANT_MIGRATION_HEAD:
            _migration_info(
                quiet,
                "Tenant schema %s already at migration head (%s)",
                safe,
                TENANT_MIGRATION_HEAD,
            )
            return False
        if ddl_complete:
            with engine.begin() as conn:
                _sync_tenant_schema_to_head(conn, safe)
            _migration_info(quiet, "Stamped tenant schema %s at head (DDL already current)", safe)
            return False
    finally:
        engine.dispose()

    backend_root = Path(__file__).resolve().parents[2]
    os.environ["TARGET_SCHEMA"] = safe
    alembic_config = Config(str(backend_root / "migrations" / "tenant" / "alembic.ini"))
    alembic_config.set_main_option("script_location", str(backend_root / "migrations" / "tenant"))
    _migration_info(quiet, "Running tenant migrations for schema %s", safe)
    with _quiet_alembic_logs() if quiet else nullcontext():
        command.upgrade(alembic_config, TENANT_MIGRATION_HEAD)
    return True


def _public_table_exists(connection, table_name: str) -> bool:

    return inspect(connection).has_table(table_name, schema="public")


def list_tenant_schema_names_from_db(
    schema_filter: str | None = None,
    *,
    registered_only: bool = False,
) -> list[str]:
    """List tenant schemas for migrate/repair CLI.

    Sources (unioned when unfiltered):
    - organizations.schema_name (when public.organizations exists)
    - existing information_schema schemata named tenant_* (unless registered_only)
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
            if not registered_only:
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


def run_all_tenant_migrations(
    schema_filter: str | None = None,
    *,
    quiet: bool = False,
    registered_only: bool = False,
) -> None:
    if not is_postgres_database():
        _migration_info(quiet, "Skipping tenant migrations (not PostgreSQL)")
        return

    schemas = list_tenant_schema_names_from_db(schema_filter, registered_only=registered_only)
    if schema_filter and not schemas:
        raise SystemExit(f"Invalid tenant schema name: {schema_filter!r}")

    if not schemas:
        _migration_info(quiet, "No tenant schemas found to repair")
        return

    repaired = 0
    for schema_name in schemas:
        if repair_tenant_schema_ddl(schema_name, quiet=quiet):
            repaired += 1
    if repaired:
        _migration_info(quiet, "Tenant migrations completed for %s schema(s)", repaired)


class TenantSchemaRouter:
    async def resolve_schema(self, db: AsyncSession, organization_id: UUID) -> str | None:
        from app.models import Organization

        return await db.scalar(
            select(Organization.schema_name).where(Organization.id == organization_id)
        )


tenant_router = TenantSchemaRouter()
