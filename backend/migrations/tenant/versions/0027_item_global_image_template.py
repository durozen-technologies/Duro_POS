"""Add global_image_template_id to tenant items."""

from __future__ import annotations

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0027_item_global_image_template"
down_revision: str | None = "0026_retailer_opening_balance"
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
    inspector = sa.inspect(bind)

    if not inspector.has_table("items", schema=schema):
        return

    item_columns = {column["name"] for column in inspector.get_columns("items", schema=schema)}
    if "global_image_template_id" in item_columns:
        return

    if bind.dialect.name == "postgresql":
        op.add_column(
            "items",
            sa.Column("global_image_template_id", sa.Uuid(), nullable=True),
            schema=schema,
        )
        op.create_index(
            op.f("ix_items_global_image_template_id"),
            "items",
            ["global_image_template_id"],
            unique=False,
            schema=schema,
        )
    else:
        op.add_column(
            "items",
            sa.Column("global_image_template_id", sa.CHAR(32), nullable=True),
            schema=schema,
        )


def downgrade() -> None:
    bind = op.get_bind()
    schema = _target_schema()
    _set_search_path(bind, schema)
    inspector = sa.inspect(bind)
    if not inspector.has_table("items", schema=schema):
        return
    item_columns = {column["name"] for column in inspector.get_columns("items", schema=schema)}
    if "global_image_template_id" not in item_columns:
        return
    if bind.dialect.name == "postgresql":
        op.drop_index(
            op.f("ix_items_global_image_template_id"),
            table_name="items",
            schema=schema,
        )
    op.drop_column("items", "global_image_template_id", schema=schema)
