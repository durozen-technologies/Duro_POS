"""Add branch-level retailer item catalog allocations."""

from __future__ import annotations

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008_shop_retailer_items"
down_revision: str | None = "0007_retailer_branch_prices"
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

    if not inspector.has_table("shop_retailer_item_allocations"):
        from app.db.tenant_metadata import create_tenant_tables

        create_tenant_tables(bind, schema)
        inspector = sa.inspect(bind)

    if not inspector.has_table("shop_retailer_item_allocations"):
        return

    if inspector.has_table("retailer_item_prices"):
        bind.execute(
            sa.text(
                """
                INSERT INTO shop_retailer_item_allocations (
                    id, shop_id, item_id, is_active, created_at, updated_at
                )
                SELECT gen_random_uuid(), rip.shop_id, rip.item_id, true, NOW(), NOW()
                FROM (
                    SELECT DISTINCT shop_id, item_id
                    FROM retailer_item_prices
                ) rip
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM shop_retailer_item_allocations existing
                    WHERE existing.shop_id = rip.shop_id
                      AND existing.item_id = rip.item_id
                )
                """
            )
        )


def downgrade() -> None:
    bind = op.get_bind()
    _set_search_path(bind, _target_schema())
    inspector = sa.inspect(bind)
    if inspector.has_table("shop_retailer_item_allocations"):
        op.drop_table("shop_retailer_item_allocations")
