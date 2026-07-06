"""Billing reliability: checkout snapshots, receipt status, bill metadata."""

from __future__ import annotations

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012_billing_reliability"
down_revision: str | None = "0011_retailer_inventory_usages"
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
    from app.db.tenant_metadata import ensure_tenant_schema_drift_patches

    bind = op.get_bind()
    schema = _target_schema()
    _set_search_path(bind, schema)
    # ponytail: idempotent raw SQL (enum + IF NOT EXISTS); op.add_column blocked on large receipts
    ensure_tenant_schema_drift_patches(bind, schema)


def downgrade() -> None:
    pass
