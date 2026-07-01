"""Apply Alembic schema migrations and idempotent data startup tasks."""

import argparse
import asyncio
import logging
from pathlib import Path

from alembic import command
from alembic.config import Config

from app.db.database import close_database_connections
from app.db.migration_repair import repair_alembic_version
from app.db.startup import (
    migrate_legacy_item_images_before_schema_changes,
    run_database_startup_tasks,
)
from app.db.tenant_schema import (
    platform_schema_ready,
    run_all_tenant_ddl_repairs,
    run_all_tenant_migrations,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BACKEND_ROOT = Path(__file__).resolve().parent


def run_schema_migrations() -> None:
    alembic_config = Config(str(BACKEND_ROOT / "alembic.ini"))
    alembic_config.set_main_option("script_location", str(BACKEND_ROOT / "migrations"))
    if repair_alembic_version(alembic_config):
        logger.info("Repaired alembic_version before upgrade.")
    logger.info("Running Alembic migrations...")
    command.upgrade(alembic_config, "head")
    logger.info("Alembic migrations completed.")


async def run_async_migration_phase(phase) -> None:
    try:
        await phase()
    finally:
        await close_database_connections()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Run platform and optional tenant migrations")
    parser.add_argument(
        "--tenants",
        action="store_true",
        help="After platform migrations, upgrade all registered tenant schemas",
    )
    parser.add_argument(
        "--schema",
        metavar="SCHEMA",
        help="With --tenants, upgrade only this tenant schema (e.g. tenant_default)",
    )
    parser.add_argument(
        "--tenants-only",
        action="store_true",
        help="Skip platform migrations and startup tasks; only run tenant migrations",
    )
    parser.add_argument(
        "--repair-tenant-ddl",
        action="store_true",
        help="Repair missing tenant tables (idempotent); use alone or with --tenants-only",
    )
    args = parser.parse_args(argv)

    if args.schema and not args.tenants and not args.tenants_only and not args.repair_tenant_ddl:
        parser.error("--schema requires --tenants, --tenants-only, or --repair-tenant-ddl")

    if args.repair_tenant_ddl and not args.tenants_only:
        if not platform_schema_ready():
            logger.info("Platform schema missing; running platform migrations first...")
            run_schema_migrations()
        run_all_tenant_ddl_repairs(schema_filter=args.schema)
        logger.info("Tenant DDL repair workflow completed.")
        return

    if not args.tenants_only:
        logger.info("Running database migration workflow...")
        asyncio.run(run_async_migration_phase(migrate_legacy_item_images_before_schema_changes))
        run_schema_migrations()
        asyncio.run(run_async_migration_phase(run_database_startup_tasks))

    if args.repair_tenant_ddl and args.tenants_only:
        run_all_tenant_ddl_repairs(schema_filter=args.schema)
    else:
        run_all_tenant_migrations(schema_filter=args.schema)

    if not args.tenants_only:
        logger.info("Database migration workflow completed.")
    else:
        logger.info("Tenant-only migration workflow completed.")


if __name__ == "__main__":
    main()
