import logging

from .database import get_engine, get_session_local
from .schema_guards import (
    _ensure_item_category_schema,
    _ensure_item_image_columns,
    _ensure_uuid_identifier_columns,
)

logger = logging.getLogger(__name__)


async def initialize_database() -> None:
    await run_database_startup_tasks()


async def migrate_legacy_item_images_before_schema_changes() -> None:
    async with get_session_local()() as db:
        from .storage import migrate_item_image_data_to_rustfs

        migrated_image_count = await migrate_item_image_data_to_rustfs(db)
        if migrated_image_count:
            logger.info(
                "Pre-schema migration moved/cleared %s legacy database item image(s).",
                migrated_image_count,
            )


async def run_database_startup_tasks() -> None:
    from .. import models as _models  # noqa: F401

    async with get_engine().begin() as conn:
        await conn.run_sync(_ensure_item_category_schema)
        await conn.run_sync(_ensure_item_image_columns)
        await conn.run_sync(_ensure_uuid_identifier_columns)
    async with get_session_local()() as db:
        from .storage import migrate_item_image_data_to_rustfs

        migrated_image_count = await migrate_item_image_data_to_rustfs(db)
        if migrated_image_count:
            logger.info(
                "Database initialization migrated/cleared %s legacy database item image(s).",
                migrated_image_count,
            )
