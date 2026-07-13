"""Add global_image_template_id to inventory and expense items."""

from __future__ import annotations

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0028_inventory_expense_global_image_template"
down_revision: str | None = "0027_item_global_image_template"
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


def _add_column(bind, schema: str, table: str, index_name: str) -> None:
    inspector = sa.inspect(bind)
    if not inspector.has_table(table, schema=schema):
        return
    columns = {column["name"] for column in inspector.get_columns(table, schema=schema)}
    if "global_image_template_id" in columns:
        return
    if bind.dialect.name == "postgresql":
        op.add_column(
            table,
            sa.Column("global_image_template_id", sa.Uuid(), nullable=True),
            schema=schema,
        )
        op.create_index(
            index_name,
            table,
            ["global_image_template_id"],
            unique=False,
            schema=schema,
        )
    else:
        op.add_column(
            table,
            sa.Column("global_image_template_id", sa.CHAR(32), nullable=True),
            schema=schema,
        )


def _drop_column(bind, schema: str, table: str, index_name: str) -> None:
    inspector = sa.inspect(bind)
    if not inspector.has_table(table, schema=schema):
        return
    columns = {column["name"] for column in inspector.get_columns(table, schema=schema)}
    if "global_image_template_id" not in columns:
        return
    if bind.dialect.name == "postgresql":
        op.drop_index(index_name, table_name=table, schema=schema)
    op.drop_column(table, "global_image_template_id", schema=schema)


def upgrade() -> None:
    bind = op.get_bind()
    schema = _target_schema()
    _set_search_path(bind, schema)
    _add_column(
        bind,
        schema,
        "inventory_items",
        op.f("ix_inventory_items_global_image_template_id"),
    )
    _add_column(
        bind,
        schema,
        "expense_items",
        op.f("ix_expense_items_global_image_template_id"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    schema = _target_schema()
    _set_search_path(bind, schema)
    _drop_column(
        bind,
        schema,
        "expense_items",
        op.f("ix_expense_items_global_image_template_id"),
    )
    _drop_column(
        bind,
        schema,
        "inventory_items",
        op.f("ix_inventory_items_global_image_template_id"),
    )
