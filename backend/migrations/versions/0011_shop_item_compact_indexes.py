"""shop item compact list indexes

Revision ID: 0011_shop_item_compact_indexes
Revises: 0010_item_categories
Create Date: 2026-05-31 00:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011_shop_item_compact_indexes"
down_revision: str | None = "0010_item_categories"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _table_names(bind) -> set[str]:
    return set(sa.inspect(bind).get_table_names())


def _index_names(bind, table_name: str) -> set[str]:
    if table_name not in _table_names(bind):
        return set()
    return {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    tables = _table_names(bind)

    if "items" in tables:
        item_indexes = _index_names(bind, "items")
        if "ix_items_global_active_import_sort" not in item_indexes:
            op.create_index(
                "ix_items_global_active_import_sort",
                "items",
                ["shop_id", "is_active", "sort_order", "name", "id"],
            )
        if "ix_items_shop_sort_name_id" not in item_indexes:
            op.create_index(
                "ix_items_shop_sort_name_id",
                "items",
                ["shop_id", "sort_order", "name", "id"],
            )

    if "shop_item_allocations" in tables:
        allocation_indexes = _index_names(bind, "shop_item_allocations")
        if "ix_shop_item_allocations_shop_sort_item_fast" not in allocation_indexes:
            op.create_index(
                "ix_shop_item_allocations_shop_sort_item_fast",
                "shop_item_allocations",
                ["shop_id", "sort_order", "item_id"],
            )


def downgrade() -> None:
    bind = op.get_bind()
    tables = _table_names(bind)

    if "shop_item_allocations" in tables:
        allocation_indexes = _index_names(bind, "shop_item_allocations")
        if "ix_shop_item_allocations_shop_sort_item_fast" in allocation_indexes:
            op.drop_index(
                "ix_shop_item_allocations_shop_sort_item_fast",
                table_name="shop_item_allocations",
            )

    if "items" in tables:
        item_indexes = _index_names(bind, "items")
        if "ix_items_shop_sort_name_id" in item_indexes:
            op.drop_index("ix_items_shop_sort_name_id", table_name="items")
        if "ix_items_global_active_import_sort" in item_indexes:
            op.drop_index("ix_items_global_active_import_sort", table_name="items")
