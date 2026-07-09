"""Store retailer opening balance snapshot on sale receipts."""

from __future__ import annotations

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014_retailer_receipt_openingb"
down_revision: str | None = "0013_daily_prices_published"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


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
    _set_search_path(bind, _target_schema())
    inspector = sa.inspect(bind)
    if not inspector.has_table("retailer_sale_receipts"):
        return

    columns = {col["name"] for col in inspector.get_columns("retailer_sale_receipts")}
    if "opening_balance" not in columns:
        op.add_column(
            "retailer_sale_receipts",
            sa.Column(
                "opening_balance",
                sa.Numeric(10, 2),
                nullable=False,
                server_default="0.00",
            ),
        )


def downgrade() -> None:
    bind = op.get_bind()
    _set_search_path(bind, _target_schema())
    inspector = sa.inspect(bind)
    if not inspector.has_table("retailer_sale_receipts"):
        return

    columns = {col["name"] for col in inspector.get_columns("retailer_sale_receipts")}
    if "opening_balance" in columns:
        op.drop_column("retailer_sale_receipts", "opening_balance")
