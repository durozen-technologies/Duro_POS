"""Add inventory weight-loss grams/day and application ledger."""

from __future__ import annotations

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0034_inventory_weight_loss"
down_revision: str | None = "0033_retailer_price_effective_date_ist"
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

    if inspector.has_table("inventory_items", schema=safe):
        columns = {
            column["name"] for column in inspector.get_columns("inventory_items", schema=safe)
        }
        if "weight_loss_grams_per_day" not in columns:
            op.add_column(
                "inventory_items",
                sa.Column(
                    "weight_loss_grams_per_day",
                    sa.Integer(),
                    nullable=False,
                    server_default=sa.text("0"),
                ),
            )
            op.alter_column("inventory_items", "weight_loss_grams_per_day", server_default=None)

    if not inspector.has_table("inventory_weight_loss_applications", schema=safe):
        op.create_table(
            "inventory_weight_loss_applications",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("shop_id", sa.Uuid(), nullable=False),
            sa.Column("inventory_item_id", sa.Uuid(), nullable=False),
            sa.Column("loss_for_date", sa.Date(), nullable=False),
            sa.Column("grams_per_day", sa.Integer(), nullable=False),
            sa.Column("bird_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("quantity_kg", sa.Numeric(12, 3), nullable=False),
            sa.Column("movement_id", sa.Uuid(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["inventory_item_id"], ["inventory_items.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["movement_id"], ["inventory_movements.id"], ondelete="SET NULL"
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "shop_id",
                "inventory_item_id",
                "loss_for_date",
                name="uq_inventory_weight_loss_shop_item_date",
            ),
        )
        op.create_index(
            "ix_inventory_weight_loss_applications_shop_id",
            "inventory_weight_loss_applications",
            ["shop_id"],
        )
        op.create_index(
            "ix_inventory_weight_loss_applications_inventory_item_id",
            "inventory_weight_loss_applications",
            ["inventory_item_id"],
        )
        op.create_index(
            "ix_inventory_weight_loss_applications_movement_id",
            "inventory_weight_loss_applications",
            ["movement_id"],
        )
        op.create_index(
            "ix_inventory_weight_loss_applications_shop_date",
            "inventory_weight_loss_applications",
            ["shop_id", "loss_for_date"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    schema = _target_schema()
    _set_search_path(bind, schema)
    from app.db.tenant_metadata import _safe_schema_name

    safe = _safe_schema_name(schema)
    inspector = sa.inspect(bind)

    if inspector.has_table("inventory_weight_loss_applications", schema=safe):
        op.drop_table("inventory_weight_loss_applications")

    if inspector.has_table("inventory_items", schema=safe):
        columns = {
            column["name"] for column in inspector.get_columns("inventory_items", schema=safe)
        }
        if "weight_loss_grams_per_day" in columns:
            op.drop_column("inventory_items", "weight_loss_grams_per_day")
