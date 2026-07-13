"""Add retailer opening balance for pre-bill outstanding amounts."""

from __future__ import annotations

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0026_retailer_opening_balance"
down_revision: str | None = "0025_retailer_shop_name"
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

    if inspector.has_table("retailers", schema=schema):
        retailer_columns = {
            column["name"] for column in inspector.get_columns("retailers", schema=schema)
        }
        if "opening_balance" not in retailer_columns:
            op.add_column(
                "retailers",
                sa.Column(
                    "opening_balance",
                    sa.Numeric(10, 2),
                    nullable=False,
                    server_default=sa.text("0.00"),
                ),
            )
            op.alter_column("retailers", "opening_balance", server_default=None)


def downgrade() -> None:
    pass
