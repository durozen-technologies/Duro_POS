"""Scope retailer item prices to branch."""

from __future__ import annotations

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_retailer_branch_prices"
down_revision: str | None = "0006_shop_retailer_allocations"
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


def _retailer_price_unique_columns(inspector: sa.Inspector) -> set[str] | None:
    for constraint in inspector.get_unique_constraints("retailer_item_prices"):
        if constraint["name"] == "uq_retailer_item_prices":
            return set(constraint.get("column_names") or [])
    return None


def _migration_complete(inspector: sa.Inspector) -> bool:
    columns = {column["name"] for column in inspector.get_columns("retailer_item_prices")}
    if "shop_id" not in columns:
        return False
    shop_id_col = next(
        column
        for column in inspector.get_columns("retailer_item_prices")
        if column["name"] == "shop_id"
    )
    if shop_id_col.get("nullable", True):
        return False
    indexes = {index["name"] for index in inspector.get_indexes("retailer_item_prices")}
    return "ix_retailer_item_prices_shop_retailer" in indexes


def upgrade() -> None:
    bind = op.get_bind()
    schema = _target_schema()
    _set_search_path(bind, schema)
    inspector = sa.inspect(bind)

    if not inspector.has_table("retailer_item_prices"):
        from app.db.tenant_metadata import create_tenant_tables

        create_tenant_tables(bind, schema)
        return

    if _migration_complete(inspector):
        return

    columns = {column["name"] for column in inspector.get_columns("retailer_item_prices")}
    if "shop_id" not in columns:
        op.add_column(
            "retailer_item_prices",
            sa.Column("shop_id", sa.Uuid(), nullable=True),
        )
        op.create_foreign_key(
            "fk_retailer_item_prices_shop_id",
            "retailer_item_prices",
            "shops",
            ["shop_id"],
            ["id"],
            ondelete="CASCADE",
        )
        inspector = sa.inspect(bind)

    # Legacy unique key is (retailer_id, item_id). Branch copies share that pair until
    # shop_id is part of the constraint — drop it before INSERT, not after.
    unique_columns = _retailer_price_unique_columns(inspector)
    if unique_columns == {"retailer_id", "item_id"}:
        op.drop_constraint("uq_retailer_item_prices", "retailer_item_prices", type_="unique")

    # ponytail: duplicate legacy retailer-wide rows onto each assigned branch; delete
    # the NULL shop_id shells afterward. Retailers with no allocation get a fallback shop.
    bind.execute(
        sa.text(
            """
            INSERT INTO retailer_item_prices (
                id, retailer_id, shop_id, item_id, price_per_unit, is_active
            )
            SELECT
                gen_random_uuid(),
                rip.retailer_id,
                sra.shop_id,
                rip.item_id,
                rip.price_per_unit,
                rip.is_active
            FROM retailer_item_prices rip
            JOIN shop_retailer_allocations sra
                ON sra.retailer_id = rip.retailer_id
               AND sra.is_active = true
            WHERE rip.shop_id IS NULL
              AND NOT EXISTS (
                  SELECT 1
                  FROM retailer_item_prices existing
                  WHERE existing.retailer_id = rip.retailer_id
                    AND existing.shop_id = sra.shop_id
                    AND existing.item_id = rip.item_id
              )
            """
        )
    )
    bind.execute(
        sa.text(
            """
            DELETE FROM retailer_item_prices legacy
            WHERE legacy.shop_id IS NULL
              AND EXISTS (
                  SELECT 1
                  FROM retailer_item_prices branched
                  WHERE branched.retailer_id = legacy.retailer_id
                    AND branched.item_id = legacy.item_id
                    AND branched.shop_id IS NOT NULL
              )
            """
        )
    )
    bind.execute(
        sa.text(
            """
            UPDATE retailer_item_prices rip
            SET shop_id = (SELECT s.id FROM shops s ORDER BY s.id LIMIT 1)
            WHERE rip.shop_id IS NULL
            """
        )
    )
    bind.execute(sa.text("DELETE FROM retailer_item_prices WHERE shop_id IS NULL"))

    op.alter_column("retailer_item_prices", "shop_id", nullable=False)

    inspector = sa.inspect(bind)
    unique_columns = _retailer_price_unique_columns(inspector)
    if unique_columns != {"retailer_id", "shop_id", "item_id"}:
        op.create_unique_constraint(
            "uq_retailer_item_prices",
            "retailer_item_prices",
            ["retailer_id", "shop_id", "item_id"],
        )

    indexes = {index["name"] for index in inspector.get_indexes("retailer_item_prices")}
    if "ix_retailer_item_prices_shop_retailer" not in indexes:
        op.create_index(
            "ix_retailer_item_prices_shop_retailer",
            "retailer_item_prices",
            ["shop_id", "retailer_id", "is_active"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    _set_search_path(bind, _target_schema())
    inspector = sa.inspect(bind)
    if not inspector.has_table("retailer_item_prices"):
        return
    columns = {column["name"] for column in inspector.get_columns("retailer_item_prices")}
    if "shop_id" not in columns:
        return

    op.drop_index("ix_retailer_item_prices_shop_retailer", table_name="retailer_item_prices")
    op.drop_constraint("uq_retailer_item_prices", "retailer_item_prices", type_="unique")
    op.create_unique_constraint(
        "uq_retailer_item_prices",
        "retailer_item_prices",
        ["retailer_id", "item_id"],
    )
    op.drop_constraint(
        "fk_retailer_item_prices_shop_id", "retailer_item_prices", type_="foreignkey"
    )
    op.drop_column("retailer_item_prices", "shop_id")
