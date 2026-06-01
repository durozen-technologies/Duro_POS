"""Apply Alembic schema migrations and idempotent data startup tasks."""

import asyncio
import logging
from pathlib import Path

from alembic import command
from alembic.config import Config

from app.db.database import close_database_connections
from app.db.startup import (
    migrate_legacy_item_images_before_schema_changes,
    run_database_startup_tasks,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BACKEND_ROOT = Path(__file__).resolve().parent


def run_schema_migrations() -> None:
    alembic_config = Config(str(BACKEND_ROOT / "alembic.ini"))
    alembic_config.set_main_option("script_location", str(BACKEND_ROOT / "migrations"))
    logger.info("Running Alembic migrations...")
    command.upgrade(alembic_config, "head")
    logger.info("Alembic migrations completed.")


async def run_async_migration_phase(phase) -> None:
    try:
        await phase()
    finally:
        await close_database_connections()


def main() -> None:
    logger.info("Running database migration workflow...")
    asyncio.run(run_async_migration_phase(migrate_legacy_item_images_before_schema_changes))
    run_schema_migrations()
    asyncio.run(run_async_migration_phase(run_database_startup_tasks))
    logger.info("Database migration workflow completed.")


if __name__ == "__main__":
    main()
