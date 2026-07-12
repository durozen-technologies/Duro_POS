"""Snapshot retailer and shop names on sales and inventory records."""

from __future__ import annotations

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0024_retailer_party_name_snapshots"
down_revision: str | None = "0023_bill_cancelled_uppercase"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PARTY_TABLES = (
    "retailer_sales",
    "retailer_inventory_purchases",
    "retailer_inventory_usages",
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


def _table_exists(bind, table_name: str) -> bool:
    from app.db.tenant_metadata import _safe_schema_name

    schema = _target_schema()
    safe = _safe_schema_name(schema)
    inspector = sa.inspect(bind)
    return inspector.has_table(table_name, schema=safe)


def _add_party_columns(table_name: str) -> None:
    if not _table_exists(op.get_bind(), table_name):
        return
    op.add_column(table_name, sa.Column("retailer_name", sa.String(length=120), nullable=True))
    op.add_column(table_name, sa.Column("shop_name", sa.String(length=120), nullable=True))


def _backfill_party_names(bind) -> None:
    if bind.dialect.name != "postgresql":
        return

    bind.execute(
        sa.text(
            """
            UPDATE retailer_sales rs
            SET retailer_name = COALESCE(r.name, ''),
                shop_name = COALESCE(s.name, '')
            FROM retailers r, shops s
            WHERE rs.retailer_id = r.id
              AND rs.shop_id = s.id
              AND (rs.retailer_name IS NULL OR rs.shop_name IS NULL)
            """
        )
    )
    bind.execute(
        sa.text(
            """
            UPDATE retailer_inventory_purchases p
            SET retailer_name = COALESCE(r.name, ''),
                shop_name = COALESCE(s.name, '')
            FROM retailers r, shops s
            WHERE p.retailer_id = r.id
              AND p.shop_id = s.id
              AND (p.retailer_name IS NULL OR p.shop_name IS NULL)
            """
        )
    )
    bind.execute(
        sa.text(
            """
            UPDATE retailer_inventory_usages u
            SET shop_name = COALESCE(s.name, ''),
                retailer_name = COALESCE(r.name, '')
            FROM shops s
            LEFT JOIN retailers r ON r.id = u.retailer_id
            WHERE u.shop_id = s.id
              AND (u.retailer_name IS NULL OR u.shop_name IS NULL)
            """
        )
    )


def _finalize_party_columns(table_name: str) -> None:
    if not _table_exists(op.get_bind(), table_name):
        return
    op.alter_column(
        table_name,
        "retailer_name",
        existing_type=sa.String(length=120),
        nullable=False,
        server_default="",
    )
    op.alter_column(
        table_name,
        "shop_name",
        existing_type=sa.String(length=120),
        nullable=False,
        server_default="",
    )


def upgrade() -> None:
    bind = op.get_bind()
    schema = _target_schema()
    _set_search_path(bind, schema)

    for table_name in _PARTY_TABLES:
        _add_party_columns(table_name)

    _backfill_party_names(bind)

    for table_name in _PARTY_TABLES:
        _finalize_party_columns(table_name)


def downgrade() -> None:
    bind = op.get_bind()
    schema = _target_schema()
    _set_search_path(bind, schema)

    for table_name in reversed(_PARTY_TABLES):
        if not _table_exists(bind, table_name):
            continue
        op.drop_column(table_name, "shop_name")
        op.drop_column(table_name, "retailer_name")
