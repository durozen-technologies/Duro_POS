"""Add retailer purchase settlement audit fields and payment linkage."""

from __future__ import annotations

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017_retailer_purchase_settle"
down_revision: str | None = "0016_retailer_credit_wallet"
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

    if inspector.has_table("retailer_inventory_purchases", schema=schema):
        purchase_columns = {
            column["name"]
            for column in inspector.get_columns("retailer_inventory_purchases", schema=schema)
        }
        if "amount_applied_to_outstanding" not in purchase_columns:
            op.add_column(
                "retailer_inventory_purchases",
                sa.Column(
                    "amount_applied_to_outstanding",
                    sa.Numeric(10, 2),
                    nullable=False,
                    server_default=sa.text("0.00"),
                ),
            )
            op.alter_column(
                "retailer_inventory_purchases",
                "amount_applied_to_outstanding",
                server_default=None,
            )
        if "amount_deposited_to_wallet" not in purchase_columns:
            op.add_column(
                "retailer_inventory_purchases",
                sa.Column(
                    "amount_deposited_to_wallet",
                    sa.Numeric(10, 2),
                    nullable=False,
                    server_default=sa.text("0.00"),
                ),
            )
            op.alter_column(
                "retailer_inventory_purchases",
                "amount_deposited_to_wallet",
                server_default=None,
            )

    if inspector.has_table("retailer_payments", schema=schema):
        payment_columns = {
            column["name"] for column in inspector.get_columns("retailer_payments", schema=schema)
        }
        if "retailer_inventory_purchase_id" not in payment_columns:
            op.add_column(
                "retailer_payments",
                sa.Column("retailer_inventory_purchase_id", sa.UUID(), nullable=True),
            )
            op.create_foreign_key(
                "fk_retailer_payments_inventory_purchase_id",
                "retailer_payments",
                "retailer_inventory_purchases",
                ["retailer_inventory_purchase_id"],
                ["id"],
                ondelete="SET NULL",
            )
            op.create_index(
                "ix_retailer_payments_retailer_inventory_purchase_id",
                "retailer_payments",
                ["retailer_inventory_purchase_id"],
            )


def downgrade() -> None:
    pass
