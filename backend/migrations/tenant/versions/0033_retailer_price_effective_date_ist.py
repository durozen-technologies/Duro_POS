"""Use IST calendar date as retailer_item_prices.effective_date server default."""

from __future__ import annotations

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0033_retailer_price_effective_date_ist"
down_revision: str | None = "0032_user_retailer_orders"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_IST_DATE_DEFAULT = "(now() AT TIME ZONE 'Asia/Kolkata')::date"


def _target_schema() -> str:
    schema = os.environ.get("TARGET_SCHEMA", "").strip()
    if not schema:
        raise RuntimeError("TARGET_SCHEMA environment variable is required for tenant migrations")
    return schema


def _set_search_path(bind, schema: str) -> None:
    from app.db.tenant_schema import assert_safe_schema_name

    safe = assert_safe_schema_name(schema)
    bind.execute(sa.text(f'SET search_path TO "{safe}", public'))


def upgrade() -> None:
    bind = op.get_bind()
    schema = _target_schema()
    _set_search_path(bind, schema)

    op.alter_column(
        "retailer_item_prices",
        "effective_date",
        server_default=sa.text(_IST_DATE_DEFAULT),
    )


def downgrade() -> None:
    bind = op.get_bind()
    schema = _target_schema()
    _set_search_path(bind, schema)

    op.alter_column(
        "retailer_item_prices",
        "effective_date",
        server_default=sa.text("CURRENT_DATE"),
    )
