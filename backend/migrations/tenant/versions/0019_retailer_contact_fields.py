"""Add retailer alternate phone and address."""

from __future__ import annotations

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019_retailer_contact_fields"
down_revision: str | None = "0018_inventory_bird_count"
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


def _add_retailer_column(bind, schema: str, column_name: str, column_type: sa.types.TypeEngine) -> None:
    from app.db.tenant_metadata import _safe_schema_name

    safe = _safe_schema_name(schema)
    inspector = sa.inspect(bind)
    if not inspector.has_table("retailers", schema=safe):
        return
    columns = {column["name"] for column in inspector.get_columns("retailers", schema=safe)}
    if column_name in columns:
        return
    op.add_column("retailers", sa.Column(column_name, column_type, nullable=True))


def upgrade() -> None:
    bind = op.get_bind()
    schema = _target_schema()
    _set_search_path(bind, schema)
    _add_retailer_column(bind, schema, "alternate_phone", sa.String(length=30))
    _add_retailer_column(bind, schema, "address", sa.String(length=500))


def downgrade() -> None:
    bind = op.get_bind()
    schema = _target_schema()
    _set_search_path(bind, schema)
    from app.db.tenant_metadata import _safe_schema_name

    safe = _safe_schema_name(schema)
    inspector = sa.inspect(bind)
    if not inspector.has_table("retailers", schema=safe):
        return
    columns = {column["name"] for column in inspector.get_columns("retailers", schema=safe)}
    if "address" in columns:
        op.drop_column("retailers", "address")
    if "alternate_phone" in columns:
        op.drop_column("retailers", "alternate_phone")
