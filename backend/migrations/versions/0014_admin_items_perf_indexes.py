"""admin items performance indexes

Revision ID: 0014_admin_items_perf_indexes
Revises: 0013_item_image_thumbnails
Create Date: 2026-05-31 00:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014_admin_items_perf_indexes"
down_revision: str | None = "0013_item_image_thumbnails"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _table_names(bind) -> set[str]:
    return set(sa.inspect(bind).get_table_names())


def _index_names(bind, table_name: str) -> set[str]:
    if table_name not in _table_names(bind):
        return set()
    return {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def _create_simple_index_if_missing(table_name: str, index_name: str, columns: list[str]) -> None:
    bind = op.get_bind()
    if table_name not in _table_names(bind):
        return
    if index_name in _index_names(bind, table_name):
        return
    op.create_index(index_name, table_name, columns)


def upgrade() -> None:
    bind = op.get_bind()
    tables = _table_names(bind)

    if bind.dialect.name == "postgresql" and "items" in tables:
        with op.get_context().autocommit_block():
            op.execute(
                """
                CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_items_catalogue_sort_lower_name
                ON items (sort_order, lower(name), id)
                WHERE shop_id IS NULL
                """
            )
            op.execute(
                """
                CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_items_catalogue_active_sort_lower_name
                ON items (sort_order, lower(name), id)
                WHERE shop_id IS NULL AND is_active IS TRUE
                """
            )
            op.execute(
                """
                CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_items_shop_sort_lower_name
                ON items (shop_id, sort_order, lower(name), id)
                WHERE shop_id IS NOT NULL
                """
            )

    if bind.dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            if "daily_prices" in tables:
                op.execute(
                    """
                    CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_daily_prices_created_at
                    ON daily_prices (created_at)
                    """
                )
            if "item_categories" in tables:
                op.execute(
                    """
                    CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_item_categories_created_at
                    ON item_categories (created_at)
                    """
                )
        return

    _create_simple_index_if_missing("daily_prices", "ix_daily_prices_created_at", ["created_at"])
    _create_simple_index_if_missing(
        "item_categories", "ix_item_categories_created_at", ["created_at"]
    )


def downgrade() -> None:
    bind = op.get_bind()

    if bind.dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            for index_name in (
                "ix_item_categories_created_at",
                "ix_daily_prices_created_at",
                "ix_items_shop_sort_lower_name",
                "ix_items_catalogue_active_sort_lower_name",
                "ix_items_catalogue_sort_lower_name",
            ):
                op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {index_name}")
        return

    for table_name, index_name in (
        ("item_categories", "ix_item_categories_created_at"),
        ("daily_prices", "ix_daily_prices_created_at"),
    ):
        if index_name in _index_names(bind, table_name):
            op.drop_index(index_name, table_name=table_name)
