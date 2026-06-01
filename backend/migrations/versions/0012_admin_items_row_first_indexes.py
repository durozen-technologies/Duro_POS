"""admin items row-first indexes

Revision ID: 0012_admin_item_rows_idx
Revises: 0011_shop_item_compact_indexes
Create Date: 2026-05-31 00:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012_admin_item_rows_idx"
down_revision: str | None = "0011_shop_item_compact_indexes"
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
    if "daily_prices" not in _table_names(bind):
        return

    if "ix_daily_prices_shop_date_item" not in _index_names(bind, "daily_prices"):
        op.create_index(
            "ix_daily_prices_shop_date_item",
            "daily_prices",
            ["shop_id", "price_date", "item_id"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    if "daily_prices" not in _table_names(bind):
        return

    if "ix_daily_prices_shop_date_item" in _index_names(bind, "daily_prices"):
        op.drop_index("ix_daily_prices_shop_date_item", table_name="daily_prices")
