"""Add cancelled status to shop bills."""

from __future__ import annotations

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0022_bill_cancelled"
down_revision: str | None = "0021_retailer_wallet_payouts"
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
    if bind.dialect.name != "postgresql":
        return

    schema = _target_schema()
    _set_search_path(bind, schema)
    from app.db.tenant_metadata import _ensure_public_billstatus_cancelled_enum

    _ensure_public_billstatus_cancelled_enum(bind)


def downgrade() -> None:
    pass
