"""Add shop retailer branch allocations."""

from __future__ import annotations

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_shop_retailer_allocations"
down_revision: str | None = "0005_retailer_receipt_history"
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

    if not inspector.has_table("shop_retailer_allocations"):
        from app.db.tenant_metadata import create_tenant_tables

        create_tenant_tables(bind, schema)
        inspector = sa.inspect(bind)

    if not inspector.has_table("shop_retailer_allocations"):
        return

    # ponytail: one-time backfill pairs every existing retailer with every shop so
    # wholesale billing keeps working until admin trims branch access.
    bind.execute(
        sa.text(
            """
            INSERT INTO shop_retailer_allocations (id, shop_id, retailer_id, is_active, created_at, updated_at)
            SELECT gen_random_uuid(), s.id, r.id, true, NOW(), NOW()
            FROM shops s
            CROSS JOIN retailers r
            WHERE NOT EXISTS (
                SELECT 1
                FROM shop_retailer_allocations a
                WHERE a.shop_id = s.id AND a.retailer_id = r.id
            )
            """
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    _set_search_path(bind, _target_schema())
    inspector = sa.inspect(bind)
    if inspector.has_table("shop_retailer_allocations"):
        op.drop_table("shop_retailer_allocations")
