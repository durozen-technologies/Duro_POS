"""Add tenant admin shop_name field."""

from __future__ import annotations

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0029_tenant_admin_shop_name"
down_revision: str | None = "0028_inventory_expense_global_image_template"
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
    from app.db.tenant_metadata import _safe_schema_name

    safe = _safe_schema_name(schema)
    inspector = sa.inspect(bind)
    if not inspector.has_table("users", schema=safe):
        return
    columns = {column["name"] for column in inspector.get_columns("users", schema=safe)}
    if "shop_name" not in columns:
        op.add_column("users", sa.Column("shop_name", sa.String(length=120), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    schema = _target_schema()
    _set_search_path(bind, schema)
    from app.db.tenant_metadata import _safe_schema_name

    safe = _safe_schema_name(schema)
    inspector = sa.inspect(bind)
    if not inspector.has_table("users", schema=safe):
        return
    columns = {column["name"] for column in inspector.get_columns("users", schema=safe)}
    if "shop_name" in columns:
        op.drop_column("users", "shop_name")

