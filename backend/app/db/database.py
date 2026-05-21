import logging
from collections.abc import AsyncGenerator

from sqlalchemy import LargeBinary, MetaData, inspect, select, text
from sqlalchemy.engine import URL, Connection, make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.core.config import get_settings
from app.db.default_items import DEFAULT_ITEM_DEFINITIONS, DEFAULT_ITEM_IMAGE_PATHS

settings = get_settings()
logger = logging.getLogger(__name__)

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def _build_engine_config(database_url: str) -> tuple[URL | str, dict[str, str]]:
    url = make_url(database_url)
    connect_args: dict[str, str] = {}

    if url.drivername in {"postgres", "postgresql"}:
        url = url.set(drivername="postgresql+asyncpg")

    sslmode = url.query.get("sslmode")
    if sslmode:
        connect_args["ssl"] = sslmode
        url = url.set(query={key: value for key, value in url.query.items() if key != "sslmode"})

    return url, connect_args


engine: AsyncEngine | None = None
SessionLocal: async_sessionmaker[AsyncSession] | None = None
UUID_IDENTIFIER_COLUMNS = {
    "bill_items": {"id", "bill_id", "item_id"},
    "bills": {"id", "shop_id"},
    "daily_prices": {"id", "shop_id", "item_id"},
    "items": {"id"},
    "payments": {"id", "bill_id"},
    "receipts": {"id", "bill_id"},
    "shops": {"id", "owner_user_id"},
    "users": {"id"},
}


def get_engine() -> AsyncEngine:
    global engine
    if engine is None:
        engine_url, engine_connect_args = _build_engine_config(settings.database_url)
        engine = create_async_engine(
            engine_url,
            future=True,
            connect_args=engine_connect_args,
            pool_pre_ping=True,
            pool_size=settings.db_pool_size,
            max_overflow=settings.db_max_overflow,
            pool_timeout=settings.db_pool_timeout,
            pool_recycle=settings.db_pool_recycle,
        )
    return engine


def get_session_local() -> async_sessionmaker[AsyncSession]:
    global SessionLocal
    if SessionLocal is None:
        SessionLocal = async_sessionmaker(
            bind=get_engine(), autoflush=False, expire_on_commit=False
        )
    return SessionLocal


def _ensure_indexes(sync_conn: Connection) -> None:
    for table in Base.metadata.sorted_tables:
        for index in table.indexes:
            index.create(bind=sync_conn, checkfirst=True)


def _drop_legacy_shop_code_column(sync_conn: Connection) -> None:
    inspector = inspect(sync_conn)
    if "shops" not in set(inspector.get_table_names()):
        return

    column_names = {column["name"] for column in inspector.get_columns("shops")}
    if "code" not in column_names:
        return

    sync_conn.execute(text("ALTER TABLE shops DROP COLUMN code"))


def _ensure_uuid_identifier_columns(sync_conn: Connection) -> None:
    inspector = inspect(sync_conn)
    table_names = set(inspector.get_table_names())
    incompatible_columns: list[str] = []

    for table_name, column_names in UUID_IDENTIFIER_COLUMNS.items():
        if table_name not in table_names:
            continue

        columns = {column["name"]: column["type"] for column in inspector.get_columns(table_name)}
        for column_name in column_names:
            column_type = columns.get(column_name)
            if column_type is None:
                continue

            rendered_type = str(column_type).lower()
            if "uuid" in rendered_type or rendered_type.startswith("char"):
                continue

            incompatible_columns.append(f"{table_name}.{column_name} ({column_type})")

    if incompatible_columns:
        joined_columns = ", ".join(sorted(incompatible_columns))
        raise RuntimeError(
            "Database schema still uses legacy non-UUID identifier columns: "
            f"{joined_columns}. Reset the database or run a manual PK/FK migration to UUIDv7."
        )


def _ensure_item_image_columns(sync_conn: Connection) -> None:
    inspector = inspect(sync_conn)
    if "items" not in set(inspector.get_table_names()):
        return

    column_names = {column["name"] for column in inspector.get_columns("items")}
    if "image_data" not in column_names:
        image_data_type = str(LargeBinary().compile(dialect=sync_conn.dialect))
        sync_conn.execute(text(f"ALTER TABLE items ADD COLUMN image_data {image_data_type}"))
    if "image_object_key" not in column_names:
        sync_conn.execute(text("ALTER TABLE items ADD COLUMN image_object_key VARCHAR(255)"))
    if "image_content_type" not in column_names:
        sync_conn.execute(text("ALTER TABLE items ADD COLUMN image_content_type VARCHAR(120)"))


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    db = get_session_local()()
    try:
        yield db
    finally:
        await db.close()


async def initialize_database() -> None:
    import app.models  # noqa: F401

    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_drop_legacy_shop_code_column)
        await conn.run_sync(_ensure_uuid_identifier_columns)
        await conn.run_sync(_ensure_item_image_columns)
        await conn.run_sync(_ensure_indexes)
    async with get_session_local()() as db:
        refreshed_image_count = await seed_defaults_with_images(db, force_image_refresh=True)
        logger.info("Database initialization refreshed %s default item image(s).", refreshed_image_count)


async def _upsert_default_items(db: AsyncSession):
    from app.models import BaseUnit, Item, UnitType

    existing_items_result = await db.scalars(select(Item))
    existing_items = {item.name: item for item in existing_items_result.all()}
    for item_definition in DEFAULT_ITEM_DEFINITIONS:
        item_payload = {
            "name": item_definition["name"],
            "unit_type": UnitType[item_definition["unit_type"]],
            "base_unit": BaseUnit[item_definition["base_unit"]],
        }
        item = existing_items.get(item_payload["name"])
        if item is None:
            item = Item(**item_payload, is_active=True)
            db.add(item)
            existing_items[item.name] = item
            continue
        item.unit_type = item_payload["unit_type"]
        item.base_unit = item_payload["base_unit"]
        item.is_active = True

    await db.flush()
    return existing_items


async def seed_defaults(db: AsyncSession) -> None:
    await _upsert_default_items(db)
    await db.commit()


async def seed_defaults_with_images(
    db: AsyncSession,
    *,
    force_image_refresh: bool = False,
) -> int:
    existing_items = await _upsert_default_items(db)
    uploaded_count = await _seed_default_item_images_for_items(
        db,
        existing_items,
        force=force_image_refresh,
    )
    await db.commit()
    return uploaded_count


async def _seed_default_item_images_for_items(
    db: AsyncSession,
    existing_items_by_name,
    *,
    force: bool = False,
) -> int:
    from app.db.storage import save_item_image_content

    uploaded_count = 0
    for item_definition in DEFAULT_ITEM_DEFINITIONS:
        item_name = item_definition["name"]
        image_path = item_definition["image_path"]
        item = existing_items_by_name.get(item_name)
        if item is None:
            logger.warning(
                "Skipping default image seed for %s because the item was not found.",
                item_name,
            )
            continue
        if not force and item.image_content_type and (item.image_object_key or item.image_data):
            continue
        if not image_path.is_file():
            logger.warning(
                "Skipping default image seed for %s because the file was not found at %s.",
                item_name,
                image_path,
            )
            continue

        await save_item_image_content(
            db,
            item,
            filename=image_path.name,
            content=image_path.read_bytes(),
            commit=False,
        )
        uploaded_count += 1

    return uploaded_count


async def seed_default_item_images(
    db: AsyncSession,
    *,
    force: bool = False,
) -> int:
    from app.models import Item

    existing_items_result = await db.scalars(
        select(Item).where(Item.name.in_(tuple(DEFAULT_ITEM_IMAGE_PATHS)))
    )
    existing_items = {item.name: item for item in existing_items_result.all()}
    uploaded_count = await _seed_default_item_images_for_items(
        db,
        existing_items,
        force=force,
    )

    if uploaded_count:
        await db.commit()
        logger.info("Seeded default images for %s item(s).", uploaded_count)
        return uploaded_count

    return 0
