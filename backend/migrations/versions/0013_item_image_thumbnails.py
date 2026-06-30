"""item image thumbnails

Revision ID: 0013_item_image_thumbnails
Revises: 0012_admin_item_rows_idx
Create Date: 2026-05-31 00:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013_item_image_thumbnails"
down_revision: str | None = "0012_admin_item_rows_idx"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _table_names(bind) -> set[str]:
    return set(sa.inspect(bind).get_table_names())


def _column_names(bind, table_name: str) -> set[str]:
    if table_name not in _table_names(bind):
        return set()
    return {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    if "items" not in _table_names(bind):
        return

    columns = _column_names(bind, "items")
    if "image_thumbnail_object_key" not in columns:
        op.add_column(
            "items", sa.Column("image_thumbnail_object_key", sa.String(255), nullable=True)
        )
    if "image_thumbnail_content_type" not in columns:
        op.add_column(
            "items", sa.Column("image_thumbnail_content_type", sa.String(120), nullable=True)
        )


def downgrade() -> None:
    bind = op.get_bind()
    if "items" not in _table_names(bind):
        return

    columns = _column_names(bind, "items")
    if "image_thumbnail_content_type" in columns:
        op.drop_column("items", "image_thumbnail_content_type")
    if "image_thumbnail_object_key" in columns:
        op.drop_column("items", "image_thumbnail_object_key")
