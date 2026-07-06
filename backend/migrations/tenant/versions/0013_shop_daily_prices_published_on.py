"""Track when admin publishes the full daily price book for a shop."""

from __future__ import annotations

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013_daily_prices_published"
down_revision: str | None = "0012_billing_reliability"
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
    if bind.dialect.name == "postgresql":
        bind.execute(
            sa.text(
                "ALTER TABLE shops ADD COLUMN IF NOT EXISTS daily_prices_published_on DATE"
            )
        )
    else:
        op.add_column("shops", sa.Column("daily_prices_published_on", sa.Date(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    schema = _target_schema()
    _set_search_path(bind, schema)
    op.drop_column("shops", "daily_prices_published_on")
