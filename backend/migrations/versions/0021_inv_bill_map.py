"""inventory billing item mappings

Revision ID: 0021_inv_bill_map
Revises: 0020_item_assumptions
Create Date: 2026-06-08 00:00:00
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
from app.core.ids import uuid7

import sqlalchemy as sa
from alembic import op

revision: str = "0021_inv_bill_map"
down_revision: str | None = "0020_item_assumptions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MAPPING_TABLE = "inventory_item_billing_mappings"


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
    for constraint in inspector.get_foreign_keys(table_name):
        if constraint.get("name"):
            names.add(str(constraint["name"]))
    for constraint in inspector.get_unique_constraints(table_name):
        if constraint.get("name"):
            names.add(str(constraint["name"]))
    return names


def _index_names(bind, table_name: str) -> set[str]:
    if table_name not in _table_names(bind):
        return set()
    return {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def _create_index_if_missing(table_name: str, index_name: str, columns: list[str]) -> None:
    bind = op.get_bind()
    if table_name not in _table_names(bind) or index_name in _index_names(bind, table_name):
        return
    op.create_index(index_name, table_name, columns)


def _create_mapping_table_if_missing() -> None:
    bind = op.get_bind()
    if MAPPING_TABLE in _table_names(bind):
        return
    op.create_table(
        MAPPING_TABLE,
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("inventory_item_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("inventory_category_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("billing_item_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["billing_item_id"],
            ["items.id"],
            name="fk_inventory_item_billing_mappings_billing_item",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["inventory_category_id"],
            ["inventory_categories.id"],
            name="fk_inventory_item_billing_mappings_category",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["inventory_item_id"],
            ["inventory_items.id"],
            name="fk_inventory_item_billing_mappings_item",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "inventory_item_id",
            "inventory_category_id",
            "billing_item_id",
            name="uq_inventory_item_billing_mappings",
        ),
    )


def _insert_mapping_rows(rows: set[tuple[object, object, object]]) -> None:
    if not rows:
        return
    bind = op.get_bind()
    existing_keys = {
        tuple(str(value) for value in row)
        for row in bind.execute(
            sa.text(
                f"""
                SELECT inventory_item_id, inventory_category_id, billing_item_id
                FROM {MAPPING_TABLE}
                """
            )
        ).all()
    }
    created_at = datetime.now(UTC)
    for inventory_item_id, inventory_category_id, billing_item_id in rows:
        row_key = tuple(
            str(value)
            for value in (inventory_item_id, inventory_category_id, billing_item_id)
        )
        if row_key in existing_keys:
            continue
        bind.execute(
            sa.text(
                f"""
                INSERT INTO {MAPPING_TABLE}
                    (id, inventory_item_id, inventory_category_id, billing_item_id, created_at)
                VALUES
                    (:id, :inventory_item_id, :inventory_category_id, :billing_item_id, :created_at)
                """
            ),
            {
                "id": uuid7(),
                "inventory_item_id": inventory_item_id,
                "inventory_category_id": inventory_category_id,
                "billing_item_id": billing_item_id,
                "created_at": created_at,
            },
        )
        existing_keys.add(row_key)


def _backfill_from_single_column() -> None:
    bind = op.get_bind()
    if "billing_item_id" not in _column_names(bind, "inventory_items"):
        return
    rows = bind.execute(
        sa.text(
            """
            SELECT
                inventory_items.id AS inventory_item_id,
                inventory_item_categories.category_id AS inventory_category_id,
                inventory_items.billing_item_id AS billing_item_id
            FROM inventory_items
            JOIN items ON items.id = inventory_items.billing_item_id
            JOIN inventory_item_categories
                ON inventory_item_categories.inventory_item_id = inventory_items.id
            JOIN (
                SELECT
                    inventory_item_id,
                    count(*) AS category_count
                FROM inventory_item_categories
                GROUP BY inventory_item_id
            ) AS category_counts
                ON category_counts.inventory_item_id = inventory_items.id
            WHERE inventory_items.billing_item_id IS NOT NULL
                AND category_counts.category_count = 1
                AND items.shop_id IS NULL
                AND items.base_unit = inventory_items.base_unit
            """
        )
    ).all()
    _insert_mapping_rows(
        {
            (row.inventory_item_id, row.inventory_category_id, row.billing_item_id)
            for row in rows
        }
    )


def _backfill_from_assumptions() -> None:
    bind = op.get_bind()
    item_columns = _column_names(bind, "items")
    if not {"assumption_inventory_item_id", "assumption_inventory_category_id"}.issubset(item_columns):
        return
    rows = bind.execute(
        sa.text(
            """
            SELECT DISTINCT
                items.assumption_inventory_item_id AS inventory_item_id,
                items.assumption_inventory_category_id AS inventory_category_id,
                items.id AS billing_item_id
            FROM items
            JOIN inventory_items
                ON inventory_items.id = items.assumption_inventory_item_id
            JOIN inventory_item_categories
                ON inventory_item_categories.inventory_item_id = items.assumption_inventory_item_id
                AND inventory_item_categories.category_id = items.assumption_inventory_category_id
            WHERE items.shop_id IS NULL
                AND items.assumption_inventory_item_id IS NOT NULL
                AND items.assumption_inventory_category_id IS NOT NULL
                AND items.base_unit = inventory_items.base_unit
            """
        )
    ).all()
    _insert_mapping_rows(
        {
            (row.inventory_item_id, row.inventory_category_id, row.billing_item_id)
            for row in rows
        }
    )


def _drop_single_column_mapping() -> None:
    bind = op.get_bind()
    if "inventory_items" not in _table_names(bind):
        return
    if "ix_inventory_items_billing_item_id" in _index_names(bind, "inventory_items"):
        op.drop_index("ix_inventory_items_billing_item_id", table_name="inventory_items")
    if "fk_inventory_items_billing_item" in _constraint_names(bind, "inventory_items"):
        op.drop_constraint(
            "fk_inventory_items_billing_item",
            "inventory_items",
            type_="foreignkey",
        )
    if "billing_item_id" in _column_names(bind, "inventory_items"):
        op.drop_column("inventory_items", "billing_item_id")


def upgrade() -> None:
    bind = op.get_bind()
    if not {"inventory_items", "inventory_categories", "inventory_item_categories", "items"}.issubset(
        _table_names(bind)
    ):
        return

    _create_mapping_table_if_missing()
    _create_index_if_missing(
        MAPPING_TABLE,
        "ix_inventory_item_billing_mappings_item_category",
        ["inventory_item_id", "inventory_category_id"],
    )
    _create_index_if_missing(
        MAPPING_TABLE,
        "ix_inventory_item_billing_mappings_billing_item",
        ["billing_item_id", "inventory_item_id"],
    )
    _backfill_from_single_column()
    _backfill_from_assumptions()
    _drop_single_column_mapping()


def downgrade() -> None:
    bind = op.get_bind()
    if MAPPING_TABLE not in _table_names(bind):
        return
    for index_name in (
        "ix_inventory_item_billing_mappings_billing_item",
        "ix_inventory_item_billing_mappings_item_category",
    ):
        if index_name in _index_names(bind, MAPPING_TABLE):
            op.drop_index(index_name, table_name=MAPPING_TABLE)
    op.drop_table(MAPPING_TABLE)
