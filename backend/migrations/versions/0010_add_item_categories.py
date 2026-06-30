"""add item categories

Revision ID: 0010_item_categories
Revises: 0009_admin_item_search_indexes
Create Date: 2026-05-30 00:00:00
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
from app.core.ids import uuid7

import sqlalchemy as sa
from alembic import op

revision: str = "0010_item_categories"
down_revision: str | None = "0009_admin_item_search_indexes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _table_names(bind) -> set[str]:
    return set(sa.inspect(bind).get_table_names())


def _column_names(bind, table_name: str) -> set[str]:
    if table_name not in _table_names(bind):
        return set()
    return {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def _index_names(bind, table_name: str) -> set[str]:
    if table_name not in _table_names(bind):
        return set()
    return {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def _constraint_names(bind, table_name: str) -> set[str]:
    if table_name not in _table_names(bind):
        return set()
    inspector = sa.inspect(bind)
    names = set()
    for collection in (
        inspector.get_check_constraints(table_name),
        inspector.get_unique_constraints(table_name),
        inspector.get_foreign_keys(table_name),
    ):
        names.update(item["name"] for item in collection if item.get("name"))
    return names


def _backfill_categories(bind) -> None:
    if "items" not in _table_names(bind) or "item_categories" not in _table_names(bind):
        return
    if "category" not in _column_names(bind, "items") or "category_id" not in _column_names(bind, "items"):
        return

    item_categories = sa.table(
        "item_categories",
        sa.column("id", sa.Uuid(as_uuid=True)),
        sa.column("name", sa.String(length=80)),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    items = sa.table(
        "items",
        sa.column("category", sa.String(length=80)),
        sa.column("category_id", sa.Uuid(as_uuid=True)),
    )
    existing_rows = bind.execute(sa.select(item_categories.c.id, item_categories.c.name)).all()
    categories_by_name = {row.name.strip().lower(): row.id for row in existing_rows}
    category_names = bind.execute(
        sa.select(sa.distinct(items.c.category)).where(
            items.c.category.is_not(None),
            sa.func.length(sa.func.trim(items.c.category)) > 0,
        )
    ).scalars()

    for raw_name in category_names:
        category_name = raw_name.strip()
        key = category_name.lower()
        category_id = categories_by_name.get(key)
        if category_id is None:
            category_id = uuid7()
            now = datetime.now(UTC)
            bind.execute(
                item_categories.insert().values(
                    id=category_id,
                    name=category_name,
                    created_at=now,
                    updated_at=now,
                )
            )
            categories_by_name[key] = category_id
        bind.execute(
            items.update()
            .where(sa.func.lower(sa.func.trim(items.c.category)) == key)
            .values(category_id=category_id, category=category_name)
        )


def upgrade() -> None:
    bind = op.get_bind()
    timestamp_default = sa.func.now()

    if "item_categories" not in _table_names(bind):
        op.create_table(
            "item_categories",
            sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("name", sa.String(length=80), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=timestamp_default,
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=timestamp_default,
                nullable=False,
            ),
            sa.CheckConstraint(
                "length(trim(name)) >= 1", name="ck_item_categories_name_not_blank"
            ),
            sa.PrimaryKeyConstraint("id"),
        )
    if "ix_item_categories_id" not in _index_names(bind, "item_categories"):
        op.create_index("ix_item_categories_id", "item_categories", ["id"])
    if "ix_item_categories_lower_name" not in _index_names(bind, "item_categories"):
        op.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_item_categories_lower_name "
            "ON item_categories (lower(name))"
        )

    if "items" in _table_names(bind):
        if "category_id" not in _column_names(bind, "items"):
            op.add_column("items", sa.Column("category_id", sa.Uuid(as_uuid=True), nullable=True))
        if "ix_items_category_id" not in _index_names(bind, "items"):
            op.create_index("ix_items_category_id", "items", ["category_id"])
        if bind.dialect.name != "sqlite" and "fk_items_category_id_item_categories" not in _constraint_names(
            bind, "items"
        ):
            op.create_foreign_key(
                "fk_items_category_id_item_categories",
                "items",
                "item_categories",
                ["category_id"],
                ["id"],
                ondelete="SET NULL",
            )

    _backfill_categories(bind)


def downgrade() -> None:
    bind = op.get_bind()
    if "items" in _table_names(bind):
        if bind.dialect.name != "sqlite" and "fk_items_category_id_item_categories" in _constraint_names(
            bind, "items"
        ):
            op.drop_constraint("fk_items_category_id_item_categories", "items", type_="foreignkey")
        if "ix_items_category_id" in _index_names(bind, "items"):
            op.drop_index("ix_items_category_id", table_name="items")
        if "category_id" in _column_names(bind, "items"):
            op.drop_column("items", "category_id")
    if "item_categories" in _table_names(bind):
        if "ix_item_categories_lower_name" in _index_names(bind, "item_categories"):
            op.drop_index("ix_item_categories_lower_name", table_name="item_categories")
        if "ix_item_categories_id" in _index_names(bind, "item_categories"):
            op.drop_index("ix_item_categories_id", table_name="item_categories")
        op.drop_table("item_categories")
