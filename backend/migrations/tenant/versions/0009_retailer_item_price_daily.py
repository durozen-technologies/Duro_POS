"""Add effective_date to retailer_item_prices for daily price history"""

from __future__ import annotations

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009_retailer_item_price_daily"
down_revision: str | None = "0008_shop_retailer_items"
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
    schema = _target_schema()
    _set_search_path(bind, schema)
    inspector = sa.inspect(bind)

    if not inspector.has_table("retailer_item_prices"):
        return

    columns = {c["name"] for c in inspector.get_columns("retailer_item_prices")}
    if "effective_date" in columns:
        return

    # We must first drop the unique constraints that don't include effective_date
    op.drop_constraint("uq_retailer_item_prices", "retailer_item_prices", type_="unique")
    
    op.add_column(
        "retailer_item_prices",
        sa.Column("effective_date", sa.Date(), nullable=True),
    )
    
    # Set default values for existing rows to CURRENT_DATE
    op.execute(
        sa.text("UPDATE retailer_item_prices SET effective_date = CURRENT_DATE WHERE effective_date IS NULL")
    )
    
    # Make effective_date NOT NULL
    op.alter_column("retailer_item_prices", "effective_date", nullable=False)
    
    # Re-create unique constraint WITH effective_date
    op.create_unique_constraint(
        "uq_retailer_item_prices_daily",
        "retailer_item_prices",
        ["retailer_id", "shop_id", "item_id", "effective_date"]
    )
    
    # Add index for efficient date filtering
    op.create_index(
        "ix_retailer_item_prices_date",
        "retailer_item_prices",
        ["retailer_id", "shop_id", "effective_date"]
    )


def downgrade() -> None:
    bind = op.get_bind()
    schema = _target_schema()
    _set_search_path(bind, schema)
    
    op.drop_index("ix_retailer_item_prices_date", table_name="retailer_item_prices")
    op.drop_constraint("uq_retailer_item_prices_daily", "retailer_item_prices", type_="unique")
    op.drop_column("retailer_item_prices", "effective_date")
    op.create_unique_constraint(
        "uq_retailer_item_prices",
        "retailer_item_prices",
        ["retailer_id", "shop_id", "item_id"]
    )
