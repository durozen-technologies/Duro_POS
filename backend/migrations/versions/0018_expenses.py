"""independent expenses domain

Revision ID: 0018_expenses
Revises: 0017_inventory_ledger_perf
Create Date: 2026-06-05 00:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018_expenses"
down_revision: str | None = "0017_inventory_ledger_perf"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _table_names(bind) -> set[str]:
    return set(sa.inspect(bind).get_table_names())


def _index_names(bind, table_name: str) -> set[str]:
    if table_name not in _table_names(bind):
        return set()
    return {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def _create_index_if_missing(table_name: str, index_name: str, columns: list[str]) -> None:
    bind = op.get_bind()
    if table_name not in _table_names(bind):
        return
    if index_name in _index_names(bind, table_name):
        return
    op.create_index(index_name, table_name, columns)


def upgrade() -> None:
    bind = op.get_bind()
    tables = _table_names(bind)
    timestamp_default = sa.func.now()

    if "expense_items" not in tables:
        op.create_table(
            "expense_items",
            sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("tamil_name", sa.String(length=120), nullable=False),
            sa.Column("sort_order", sa.Integer(), server_default=sa.text("0"), nullable=False),
            sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            sa.Column("image_object_key", sa.String(length=255), nullable=True),
            sa.Column("image_content_type", sa.String(length=120), nullable=True),
            sa.Column("image_thumbnail_object_key", sa.String(length=255), nullable=True),
            sa.Column("image_thumbnail_content_type", sa.String(length=120), nullable=True),
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
            sa.CheckConstraint("length(trim(name)) >= 2", name="ck_expense_items_name_not_blank"),
            sa.CheckConstraint(
                "length(trim(tamil_name)) >= 1", name="ck_expense_items_tamil_name_not_blank"
            ),
            sa.PrimaryKeyConstraint("id"),
        )
    if "ix_expense_items_lower_name" not in _index_names(bind, "expense_items"):
        op.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_expense_items_lower_name ON expense_items (lower(name))"
        )
    _create_index_if_missing(
        "expense_items", "ix_expense_items_sort_name", ["sort_order", "name", "id"]
    )
    _create_index_if_missing(
        "expense_items",
        "ix_expense_items_active_sort_name",
        ["is_active", "sort_order", "name", "id"],
    )

    if "shop_expense_allocations" not in tables:
        op.create_table(
            "shop_expense_allocations",
            sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("shop_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("expense_item_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            sa.Column("sort_order", sa.Integer(), server_default=sa.text("0"), nullable=False),
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
            sa.ForeignKeyConstraint(["expense_item_id"], ["expense_items.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "shop_id", "expense_item_id", name="uq_shop_expense_allocations_shop_item"
            ),
        )
    _create_index_if_missing(
        "shop_expense_allocations",
        "ix_shop_expense_allocations_sort",
        ["shop_id", "is_active", "sort_order", "expense_item_id"],
    )
    _create_index_if_missing(
        "shop_expense_allocations",
        "ix_shop_expense_allocations_shop_sort_item",
        ["shop_id", "sort_order", "expense_item_id"],
    )

    if "expense_entries" not in tables:
        op.create_table(
            "expense_entries",
            sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("shop_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("expense_item_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("expense_name", sa.String(length=120), nullable=False),
            sa.Column("expense_tamil_name", sa.String(length=120), nullable=False),
            sa.Column("amount", sa.Numeric(12, 2), nullable=False),
            sa.Column(
                "spent_at",
                sa.DateTime(timezone=True),
                server_default=timestamp_default,
                nullable=False,
            ),
            sa.Column("note", sa.String(length=255), nullable=True),
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
            sa.CheckConstraint("amount > 0", name="ck_expense_entries_amount_positive"),
            sa.CheckConstraint(
                "length(trim(expense_name)) >= 2", name="ck_expense_entries_name_not_blank"
            ),
            sa.CheckConstraint(
                "length(trim(expense_tamil_name)) >= 1",
                name="ck_expense_entries_tamil_name_not_blank",
            ),
            sa.ForeignKeyConstraint(["expense_item_id"], ["expense_items.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_if_missing(
        "expense_entries", "ix_expense_entries_shop_spent", ["shop_id", "spent_at", "id"]
    )
    _create_index_if_missing("expense_entries", "ix_expense_entries_spent", ["spent_at", "id"])
    _create_index_if_missing(
        "expense_entries", "ix_expense_entries_item_spent", ["expense_item_id", "spent_at", "id"]
    )


def downgrade() -> None:
    bind = op.get_bind()
    for table_name in ("expense_entries", "shop_expense_allocations", "expense_items"):
        if table_name in _table_names(bind):
            op.drop_table(table_name)
