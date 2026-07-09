"""Add retailer credit wallet, payment wallet_amount, and inventory purchase tables."""

from __future__ import annotations

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016_retailer_credit_wallet"
down_revision: str | None = "0015_expense_split_cash_upi"
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
    from app import models as _models  # noqa: F401
    from app.db.database import Base
    from app.db.tenant_metadata import _reuse_public_pg_enums, _safe_schema_name

    bind = op.get_bind()
    schema = _target_schema()
    safe = _safe_schema_name(schema)
    _set_search_path(bind, schema)
    inspector = sa.inspect(bind)

    if inspector.has_table("retailers", schema=safe):
        retailer_columns = {
            column["name"] for column in inspector.get_columns("retailers", schema=safe)
        }
        if "credit_balance" not in retailer_columns:
            op.add_column(
                "retailers",
                sa.Column(
                    "credit_balance",
                    sa.Numeric(10, 2),
                    nullable=False,
                    server_default=sa.text("0.00"),
                ),
            )
            op.alter_column("retailers", "credit_balance", server_default=None)

    if inspector.has_table("retailer_payments", schema=safe):
        payment_columns = {
            column["name"] for column in inspector.get_columns("retailer_payments", schema=safe)
        }
        if "wallet_amount" not in payment_columns:
            op.add_column(
                "retailer_payments",
                sa.Column(
                    "wallet_amount",
                    sa.Numeric(10, 2),
                    nullable=False,
                    server_default=sa.text("0.00"),
                ),
            )
            op.alter_column("retailer_payments", "wallet_amount", server_default=None)

    if not inspector.has_table("retailer_inventory_purchases", schema=safe):
        from app.db.tenant_metadata import (
            _ensure_public_retailer_inventory_purchase_status_enum,
        )

        _ensure_public_retailer_inventory_purchase_status_enum(bind)
        for table_name in ("retailer_inventory_purchases", "retailer_inventory_purchase_lines"):
            table = Base.metadata.tables[table_name]
            with _reuse_public_pg_enums(bind):
                table.create(bind, checkfirst=False)


def downgrade() -> None:
    pass
