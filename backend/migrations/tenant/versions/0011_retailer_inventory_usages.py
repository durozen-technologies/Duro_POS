"""Add retailer_inventory_usages table to tenant schemas."""

from __future__ import annotations

import os
from collections.abc import Sequence

import sqlalchemy as sa
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
    if inspector.has_table("retailer_inventory_usages", schema=safe):
        return

    table = Base.metadata.tables["retailer_inventory_usages"]
    with _reuse_public_pg_enums(bind):
        table.create(bind, checkfirst=False)


def downgrade() -> None:
    pass
