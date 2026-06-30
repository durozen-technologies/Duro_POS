"""expense item image metadata

Revision ID: 0019_expense_item_images
Revises: 0018_expenses
Create Date: 2026-06-06 00:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019_expense_item_images"
down_revision: str | None = "0018_expenses"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _table_names(bind) -> set[str]:
    return set(sa.inspect(bind).get_table_names())


def _column_names(bind, table_name: str) -> set[str]:
    if table_name not in _table_names(bind):
        return set()
    return {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def _add_column_if_missing(table_name: str, column: sa.Column) -> None:
    bind = op.get_bind()
    if column.name in _column_names(bind, table_name):
        return
    op.add_column(table_name, column)


def upgrade() -> None:
    bind = op.get_bind()
    if "expense_items" not in _table_names(bind):
        return
    _add_column_if_missing(
        "expense_items", sa.Column("image_object_key", sa.String(length=255), nullable=True)
    )
    _add_column_if_missing(
        "expense_items", sa.Column("image_content_type", sa.String(length=120), nullable=True)
    )
    _add_column_if_missing(
        "expense_items",
        sa.Column("image_thumbnail_object_key", sa.String(length=255), nullable=True),
    )
    _add_column_if_missing(
        "expense_items",
        sa.Column("image_thumbnail_content_type", sa.String(length=120), nullable=True),
    )


def downgrade() -> None:
    bind = op.get_bind()
    columns = _column_names(bind, "expense_items")
    for column_name in (
        "image_thumbnail_content_type",
        "image_thumbnail_object_key",
        "image_content_type",
        "image_object_key",
    ):
        if column_name in columns:
            op.drop_column("expense_items", column_name)
