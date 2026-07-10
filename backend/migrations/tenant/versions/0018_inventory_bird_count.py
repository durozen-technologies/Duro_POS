"""Add bird_count to inventory movement tables."""

from __future__ import annotations

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018_inventory_bird_count"
down_revision: str | None = "0017_retailer_purchase_settle"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_BIRD_COUNT_TABLES = (
    "inventory_movements",
    "inventory_movement_splits",
    "inventory_transfers",
    "retailer_inventory_usages",
    "retailer_inventory_purchase_lines",
)


def _target_schema() -> str:
    schema = os.environ.get("TARGET_SCHEMA", "").strip()
    if not schema:
        raise RuntimeError("TARGET_SCHEMA environment variable is required for tenant migrations")
    return schema


def _set_search_path(bind, schema: str) -> None:
    from app.db.tenant_schema import assert_safe_schema_name

    safe = assert_safe_schema_name(schema)
    bind.execute(sa.text(f'SET search_path TO "{safe}", public'))


def _add_bird_count_column(bind, schema: str, table_name: str) -> None:
    from app.db.tenant_metadata import _safe_schema_name

    safe = _safe_schema_name(schema)
    inspector = sa.inspect(bind)
    if not inspector.has_table(table_name, schema=safe):
        return
    columns = {column["name"] for column in inspector.get_columns(table_name, schema=safe)}
    if "bird_count" in columns:
        return
    op.add_column(
        table_name,
        sa.Column("bird_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    op.alter_column(table_name, "bird_count", server_default=None)


def upgrade() -> None:
    bind = op.get_bind()
    schema = _target_schema()
    _set_search_path(bind, schema)
    for table_name in _BIRD_COUNT_TABLES:
        _add_bird_count_column(bind, schema, table_name)


def downgrade() -> None:
    bind = op.get_bind()
    schema = _target_schema()
    _set_search_path(bind, schema)
    from app.db.tenant_metadata import _safe_schema_name

    safe = _safe_schema_name(schema)
    inspector = sa.inspect(bind)
    for table_name in reversed(_BIRD_COUNT_TABLES):
        if not inspector.has_table(table_name, schema=safe):
            continue
        columns = {column["name"] for column in inspector.get_columns(table_name, schema=safe)}
        if "bird_count" not in columns:
            continue
        op.drop_column(table_name, "bird_count")
