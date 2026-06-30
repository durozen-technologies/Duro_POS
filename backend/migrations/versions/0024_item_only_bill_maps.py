"""remove category-level inventory billing mappings

Revision ID: 0024_item_only_maps
Revises: 0023_item_bill_maps
Create Date: 2026-06-08 00:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0024_item_only_maps"
down_revision: str | None = "0023_item_bill_maps"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MAPPING_TABLE = "inventory_item_billing_mappings"
CATEGORY_COLUMN = "inventory_category_id"
CATEGORY_FK = "fk_inventory_item_billing_mappings_category"
CATEGORY_INDEX = "ix_inventory_item_billing_mappings_item_category"
ITEM_LEVEL_INDEX = "ux_inventory_item_billing_mappings_item_billing"
UNIQUE_CONSTRAINT = "uq_inventory_item_billing_mappings"


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


def _foreign_keys(bind, table_name: str) -> list[dict[str, object]]:
    if table_name not in _table_names(bind):
        return []
    return sa.inspect(bind).get_foreign_keys(table_name)


def _unique_constraints(bind, table_name: str) -> dict[str, tuple[str, ...]]:
    if table_name not in _table_names(bind):
        return {}
    return {
        constraint["name"]: tuple(constraint.get("column_names") or ())
        for constraint in sa.inspect(bind).get_unique_constraints(table_name)
        if constraint.get("name")
    }


def upgrade() -> None:
    bind = op.get_bind()
    if MAPPING_TABLE not in _table_names(bind):
        return

    columns = _column_names(bind, MAPPING_TABLE)
    if CATEGORY_COLUMN in columns:
        bind.execute(sa.text(f"DELETE FROM {MAPPING_TABLE} WHERE {CATEGORY_COLUMN} IS NOT NULL"))

    indexes = _index_names(bind, MAPPING_TABLE)
    if ITEM_LEVEL_INDEX in indexes:
        op.drop_index(ITEM_LEVEL_INDEX, table_name=MAPPING_TABLE)
    if CATEGORY_INDEX in indexes:
        op.drop_index(CATEGORY_INDEX, table_name=MAPPING_TABLE)

    for foreign_key in _foreign_keys(bind, MAPPING_TABLE):
        name = foreign_key.get("name")
        constrained_columns = set(foreign_key.get("constrained_columns") or ())
        if name and CATEGORY_COLUMN in constrained_columns:
            op.drop_constraint(name, MAPPING_TABLE, type_="foreignkey")

    for name, constrained_columns in _unique_constraints(bind, MAPPING_TABLE).items():
        if CATEGORY_COLUMN in constrained_columns:
            op.drop_constraint(name, MAPPING_TABLE, type_="unique")

    if CATEGORY_COLUMN in _column_names(bind, MAPPING_TABLE):
        op.drop_column(MAPPING_TABLE, CATEGORY_COLUMN)

    unique_constraints = _unique_constraints(bind, MAPPING_TABLE)
    if UNIQUE_CONSTRAINT not in unique_constraints:
        op.create_unique_constraint(
            UNIQUE_CONSTRAINT,
            MAPPING_TABLE,
            ["inventory_item_id", "billing_item_id"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    if MAPPING_TABLE not in _table_names(bind):
        return

    columns = _column_names(bind, MAPPING_TABLE)
    if CATEGORY_COLUMN not in columns:
        unique_constraints = _unique_constraints(bind, MAPPING_TABLE)
        if UNIQUE_CONSTRAINT in unique_constraints:
            op.drop_constraint(UNIQUE_CONSTRAINT, MAPPING_TABLE, type_="unique")
        op.add_column(
            MAPPING_TABLE,
            sa.Column(CATEGORY_COLUMN, sa.Uuid(as_uuid=True), nullable=True),
        )
        op.create_foreign_key(
            CATEGORY_FK,
            MAPPING_TABLE,
            "inventory_categories",
            [CATEGORY_COLUMN],
            ["id"],
            ondelete="CASCADE",
        )
        op.create_unique_constraint(
            UNIQUE_CONSTRAINT,
            MAPPING_TABLE,
            ["inventory_item_id", CATEGORY_COLUMN, "billing_item_id"],
        )

    indexes = _index_names(bind, MAPPING_TABLE)
    if CATEGORY_INDEX not in indexes:
        op.create_index(
            CATEGORY_INDEX,
            MAPPING_TABLE,
            ["inventory_item_id", CATEGORY_COLUMN],
        )
    if ITEM_LEVEL_INDEX not in indexes:
        op.create_index(
            ITEM_LEVEL_INDEX,
            MAPPING_TABLE,
            ["inventory_item_id", "billing_item_id"],
            unique=True,
            postgresql_where=sa.text(f"{CATEGORY_COLUMN} IS NULL"),
            sqlite_where=sa.text(f"{CATEGORY_COLUMN} IS NULL"),
        )
