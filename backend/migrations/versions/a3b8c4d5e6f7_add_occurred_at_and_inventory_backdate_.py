"""add occurred_at and inventory backdate policy

Revision ID: a3b8c4d5e6f7
Revises: d199bf838d3f
Create Date: 2026-06-28 23:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a3b8c4d5e6f7"
down_revision: Union[str, None] = "d199bf838d3f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "inventory_movements",
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "inventory_transfers",
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute("UPDATE inventory_movements SET occurred_at = created_at")
    op.execute("UPDATE inventory_transfers SET occurred_at = created_at")
    op.alter_column("inventory_movements", "occurred_at", nullable=False)
    op.alter_column("inventory_transfers", "occurred_at", nullable=False)

    op.create_index(
        "ix_inventory_movements_shop_item_occurred",
        "inventory_movements",
        ["shop_id", "inventory_item_id", "occurred_at", "id"],
        unique=False,
    )
    op.create_index(
        "ix_inventory_movements_shop_category_occurred",
        "inventory_movements",
        ["shop_id", "category_id", "occurred_at", "id"],
        unique=False,
    )
    op.create_index(
        "ix_inventory_movements_shop_item_category_occurred",
        "inventory_movements",
        ["shop_id", "inventory_item_id", "category_id", "occurred_at", "id"],
        unique=False,
    )
    op.create_index(
        "ix_inventory_transfers_shop_item_occurred",
        "inventory_transfers",
        ["source_shop_id", "inventory_item_id", "occurred_at", "id"],
        unique=False,
    )

    op.create_table(
        "inventory_backdate_policy",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column(
            "allow_shop_backdated_inventory",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("shop_backdate_window_days", sa.Integer(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute(
        "INSERT INTO inventory_backdate_policy (id, allow_shop_backdated_inventory, shop_backdate_window_days) "
        "VALUES (1, false, 0)"
    )


def downgrade() -> None:
    op.drop_table("inventory_backdate_policy")
    op.drop_index("ix_inventory_transfers_shop_item_occurred", table_name="inventory_transfers")
    op.drop_index(
        "ix_inventory_movements_shop_item_category_occurred",
        table_name="inventory_movements",
    )
    op.drop_index(
        "ix_inventory_movements_shop_category_occurred",
        table_name="inventory_movements",
    )
    op.drop_index(
        "ix_inventory_movements_shop_item_occurred",
        table_name="inventory_movements",
    )
    op.drop_column("inventory_transfers", "occurred_at")
    op.drop_column("inventory_movements", "occurred_at")
