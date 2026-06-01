from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection

from ..core.ids import uuid7
from .database import Base

UUID_IDENTIFIER_COLUMNS = {
    "bill_items": {"id", "bill_id", "item_id"},
    "bills": {"id", "shop_id"},
    "daily_prices": {"id", "shop_id", "item_id"},
    "items": {"id", "category_id"},
    "item_categories": {"id"},
    "item_change_events": {"id", "item_id", "shop_id"},
    "payments": {"id", "bill_id"},
    "receipts": {"id", "bill_id"},
    "shop_item_allocations": {"id", "shop_id", "item_id"},
    "shops": {"id", "owner_user_id"},
    "users": {"id"},
}


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
    if "image_object_key" not in column_names:
        sync_conn.execute(text("ALTER TABLE items ADD COLUMN image_object_key VARCHAR(255)"))
    if "image_content_type" not in column_names:
        sync_conn.execute(text("ALTER TABLE items ADD COLUMN image_content_type VARCHAR(120)"))
    if "image_thumbnail_object_key" not in column_names:
        sync_conn.execute(text("ALTER TABLE items ADD COLUMN image_thumbnail_object_key VARCHAR(255)"))
    if "image_thumbnail_content_type" not in column_names:
        sync_conn.execute(text("ALTER TABLE items ADD COLUMN image_thumbnail_content_type VARCHAR(120)"))


def _ensure_item_tamil_name_column(sync_conn: Connection) -> None:
    inspector = inspect(sync_conn)
    if "items" not in set(inspector.get_table_names()):
        return

    column_names = {column["name"] for column in inspector.get_columns("items")}
    if "tamil_name" not in column_names:
        sync_conn.execute(text("ALTER TABLE items ADD COLUMN tamil_name VARCHAR(120)"))


def _ensure_item_category_schema(sync_conn: Connection) -> None:
    """Compatibility guard for direct API starts before Alembic has run.

    Alembic remains the canonical migration path. This small idempotent guard
    prevents a newer app process from crashing on ``items.category_id`` when a
    local or manually started backend points at an older database.
    """
    inspector = inspect(sync_conn)
    table_names = set(inspector.get_table_names())
    dialect = sync_conn.dialect.name

    if "item_categories" not in table_names:
        if dialect == "postgresql":
            sync_conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS item_categories (
                        id UUID PRIMARY KEY,
                        name VARCHAR(80) NOT NULL,
                        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
                        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
                        CONSTRAINT ck_item_categories_name_not_blank CHECK (length(trim(name)) >= 1)
                    )
                    """
                )
            )
        else:
            sync_conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS item_categories (
                        id CHAR(32) PRIMARY KEY,
                        name VARCHAR(80) NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                        CONSTRAINT ck_item_categories_name_not_blank CHECK (length(trim(name)) >= 1)
                    )
                    """
                )
            )

    if dialect == "postgresql":
        sync_conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_item_categories_lower_name "
                "ON item_categories (lower(name))"
            )
        )
    else:
        sync_conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_item_categories_lower_name "
                "ON item_categories (lower(name))"
            )
        )

    table_names = set(inspect(sync_conn).get_table_names())
    if "items" not in table_names:
        return

    item_columns = {column["name"] for column in inspect(sync_conn).get_columns("items")}
    if "category_id" not in item_columns:
        if dialect == "postgresql":
            sync_conn.execute(text("ALTER TABLE items ADD COLUMN IF NOT EXISTS category_id UUID"))
        else:
            sync_conn.execute(text("ALTER TABLE items ADD COLUMN category_id CHAR(32)"))

    if dialect == "postgresql":
        sync_conn.execute(text("CREATE INDEX IF NOT EXISTS ix_items_category_id ON items (category_id)"))
        foreign_key_names = {
            key["name"] for key in inspect(sync_conn).get_foreign_keys("items") if key.get("name")
        }
        if "fk_items_category_id_item_categories" not in foreign_key_names:
            sync_conn.execute(
                text(
                    """
                    ALTER TABLE items
                    ADD CONSTRAINT fk_items_category_id_item_categories
                    FOREIGN KEY (category_id) REFERENCES item_categories(id) ON DELETE SET NULL
                    """
                )
            )
    else:
        sync_conn.execute(text("CREATE INDEX IF NOT EXISTS ix_items_category_id ON items (category_id)"))

    category_rows = sync_conn.execute(
        text(
            """
            SELECT DISTINCT trim(category) AS name
            FROM items
            WHERE category IS NOT NULL AND trim(category) != ''
            """
        )
    ).mappings()
    existing_categories = {
        str(row["name"]).strip().lower(): row["id"]
        for row in sync_conn.execute(text("SELECT id, name FROM item_categories")).mappings()
    }
    for row in category_rows:
        category_name = str(row["name"]).strip()
        key = category_name.lower()
        category_id = existing_categories.get(key)
        if category_id is None:
            category_id = uuid7()
            bound_category_id = category_id if dialect == "postgresql" else str(category_id)
            sync_conn.execute(
                text(
                    """
                    INSERT INTO item_categories (id, name)
                    VALUES (:category_id, :category_name)
                    """
                ),
                {"category_id": bound_category_id, "category_name": category_name},
            )
            existing_categories[key] = bound_category_id
            category_id = bound_category_id
        sync_conn.execute(
            text(
                """
                UPDATE items
                SET category_id = :category_id,
                    category = :category_name
                WHERE lower(trim(category)) = :category_key
                """
            ),
            {
                "category_id": category_id,
                "category_name": category_name,
                "category_key": key,
            },
        )
