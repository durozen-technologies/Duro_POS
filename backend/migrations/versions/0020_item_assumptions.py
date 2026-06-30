"""item inventory assumptions

Revision ID: 0020_item_assumptions
Revises: 0019_expense_item_images
Create Date: 2026-06-07 00:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020_item_assumptions"
down_revision: str | None = "0019_expense_item_images"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _table_names(bind) -> set[str]:
    return set(sa.inspect(bind).get_table_names())


def _column_names(bind, table_name: str) -> set[str]:
    if table_name not in _table_names(bind):
        return set()
    return {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def _constraint_names(bind, table_name: str) -> set[str]:
    if table_name not in _table_names(bind):
        return set()
    inspector = sa.inspect(bind)
    names: set[str] = set()
    for constraint in inspector.get_check_constraints(table_name):
        if constraint.get("name"):
            names.add(str(constraint["name"]))
    for constraint in inspector.get_foreign_keys(table_name):
        if constraint.get("name"):
            names.add(str(constraint["name"]))
    return names


def _index_names(bind, table_name: str) -> set[str]:
    if table_name not in _table_names(bind):
        return set()
    return {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def _add_column_if_missing(table_name: str, column: sa.Column) -> None:
    bind = op.get_bind()
    if column.name in _column_names(bind, table_name):
        return
    op.add_column(table_name, column)


def _create_index_if_missing(table_name: str, index_name: str, columns: list[str]) -> None:
    bind = op.get_bind()
    if index_name in _index_names(bind, table_name):
        return
    op.create_index(index_name, table_name, columns)


def upgrade() -> None:
    bind = op.get_bind()
    if "items" not in _table_names(bind):
        return

    _add_column_if_missing(
        "items", sa.Column("assumption_percent", sa.Numeric(5, 2), nullable=True)
    )
    _add_column_if_missing(
        "items",
        sa.Column("assumption_inventory_item_id", sa.Uuid(as_uuid=True), nullable=True),
    )
    _add_column_if_missing(
        "items",
        sa.Column("assumption_inventory_category_id", sa.Uuid(as_uuid=True), nullable=True),
    )

    constraints = _constraint_names(bind, "items")
    if "ck_items_assumption_percent_range" not in constraints:
        op.create_check_constraint(
            "ck_items_assumption_percent_range",
            "items",
            "assumption_percent IS NULL OR (assumption_percent > 0 AND assumption_percent <= 100)",
        )

    tables = _table_names(bind)
    constraints = _constraint_names(bind, "items")
    if "inventory_items" in tables and "fk_items_assumption_inventory_item" not in constraints:
        op.create_foreign_key(
            "fk_items_assumption_inventory_item",
            "items",
            "inventory_items",
            ["assumption_inventory_item_id"],
            ["id"],
            ondelete="SET NULL",
        )
    if (
        "inventory_categories" in tables
        and "fk_items_assumption_inventory_category" not in constraints
    ):
        op.create_foreign_key(
            "fk_items_assumption_inventory_category",
            "items",
            "inventory_categories",
            ["assumption_inventory_category_id"],
            ["id"],
            ondelete="SET NULL",
        )

    _create_index_if_missing(
        "items",
        "ix_items_assumption_inventory_item_id",
        ["assumption_inventory_item_id"],
    )
    _create_index_if_missing(
        "items",
        "ix_items_assumption_inventory_category_id",
        ["assumption_inventory_category_id"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    if "items" not in _table_names(bind):
        return

    indexes = _index_names(bind, "items")
    for index_name in (
        "ix_items_assumption_inventory_category_id",
        "ix_items_assumption_inventory_item_id",
    ):
        if index_name in indexes:
            op.drop_index(index_name, table_name="items")

    constraints = _constraint_names(bind, "items")
    for constraint_name in (
        "fk_items_assumption_inventory_category",
        "fk_items_assumption_inventory_item",
        "ck_items_assumption_percent_range",
    ):
        if constraint_name in constraints:
            op.drop_constraint(
                constraint_name,
                "items",
                type_="foreignkey" if constraint_name.startswith("fk_") else "check",
            )

    columns = _column_names(bind, "items")
    for column_name in (
        "assumption_inventory_category_id",
        "assumption_inventory_item_id",
        "assumption_percent",
    ):
        if column_name in columns:
            op.drop_column("items", column_name)
