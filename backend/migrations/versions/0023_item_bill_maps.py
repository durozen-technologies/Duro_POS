"""allow item-level billing mappings

Revision ID: 0023_item_bill_maps
Revises: 0022_category_bill_maps
Create Date: 2026-06-08 00:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0023_item_bill_maps"
down_revision: str | None = "0022_category_bill_maps"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MAPPING_TABLE = "inventory_item_billing_mappings"
ITEM_LEVEL_INDEX = "ux_inventory_item_billing_mappings_item_billing"


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


def upgrade() -> None:
    bind = op.get_bind()
    if MAPPING_TABLE not in _table_names(bind):
        return
    if "inventory_category_id" in _column_names(bind, MAPPING_TABLE):
        op.alter_column(
            MAPPING_TABLE,
            "inventory_category_id",
            existing_type=sa.Uuid(as_uuid=True),
            nullable=True,
        )
    if ITEM_LEVEL_INDEX not in _index_names(bind, MAPPING_TABLE):
        op.create_index(
            ITEM_LEVEL_INDEX,
            MAPPING_TABLE,
            ["inventory_item_id", "billing_item_id"],
            unique=True,
            postgresql_where=sa.text("inventory_category_id IS NULL"),
            sqlite_where=sa.text("inventory_category_id IS NULL"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    if MAPPING_TABLE not in _table_names(bind):
        return
    if ITEM_LEVEL_INDEX in _index_names(bind, MAPPING_TABLE):
        op.drop_index(ITEM_LEVEL_INDEX, table_name=MAPPING_TABLE)
    bind.execute(sa.text(f"DELETE FROM {MAPPING_TABLE} WHERE inventory_category_id IS NULL"))
    if "inventory_category_id" in _column_names(bind, MAPPING_TABLE):
        op.alter_column(
            MAPPING_TABLE,
            "inventory_category_id",
            existing_type=sa.Uuid(as_uuid=True),
            nullable=False,
        )
