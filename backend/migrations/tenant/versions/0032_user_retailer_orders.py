"""Add user_retailer_orders for per-user retailer display order."""

from __future__ import annotations

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0032_user_retailer_orders"
down_revision: str | None = "0031_purchasers"
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
    from app.db.tenant_metadata import _safe_schema_name

    bind = op.get_bind()
    schema = _target_schema()
    safe = _safe_schema_name(schema)
    _set_search_path(bind, schema)
    inspector = sa.inspect(bind)

    if not inspector.has_table("user_retailer_orders", schema=safe):
        table = Base.metadata.tables["user_retailer_orders"]
        table.create(bind, checkfirst=False)


def downgrade() -> None:
    from app.db.tenant_metadata import _safe_schema_name

    bind = op.get_bind()
    schema = _target_schema()
    safe = _safe_schema_name(schema)
    _set_search_path(bind, schema)
    inspector = sa.inspect(bind)

    if inspector.has_table("user_retailer_orders", schema=safe):
        op.drop_table("user_retailer_orders")
