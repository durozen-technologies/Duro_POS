"""Add cancelled status to retailer sales."""

from __future__ import annotations

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020_retailer_sale_cancelled"
down_revision: str | None = "0019_retailer_contact_fields"
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
    with op.get_context().autocommit_block():
        op.execute(
            sa.text("ALTER TYPE retailersalestatus ADD VALUE IF NOT EXISTS 'cancelled'")
        )


def downgrade() -> None:
    pass
