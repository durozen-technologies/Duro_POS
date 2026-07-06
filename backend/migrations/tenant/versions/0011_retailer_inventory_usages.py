"""Add retailer_inventory_usages table to tenant schemas."""

from __future__ import annotations

import os
from collections.abc import Sequence

from alembic import op

revision: str = "0011_retailer_inventory_usages"
down_revision: str | None = "0010_retailer_item_price_default"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _target_schema() -> str:
    schema = os.environ.get("TARGET_SCHEMA", "").strip()
    if not schema:
        raise RuntimeError("TARGET_SCHEMA environment variable is required for tenant migrations")
    return schema


def upgrade() -> None:
    from app.db.tenant_metadata import create_tenant_tables

    create_tenant_tables(op.get_bind(), _target_schema())


def downgrade() -> None:
    pass
