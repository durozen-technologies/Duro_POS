"""Add driver and vehicle to inventory movement

Revision ID: 1fb8087fddba
Revises: de470739b85b
Create Date: 2026-06-22 15:09:06.785481
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "1fb8087fddba"
down_revision: Union[str, None] = "de470739b85b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(bind, table_name: str) -> set[str]:
    return {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    columns = _column_names(bind, "inventory_movements")
    if "driver_name" not in columns:
        op.add_column(
            "inventory_movements",
            sa.Column("driver_name", sa.String(length=100), nullable=True),
        )
    if "vehicle_number" not in columns:
        op.add_column(
            "inventory_movements",
            sa.Column("vehicle_number", sa.String(length=50), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    columns = _column_names(bind, "inventory_movements")
    if "vehicle_number" in columns:
        op.drop_column("inventory_movements", "vehicle_number")
    if "driver_name" in columns:
        op.drop_column("inventory_movements", "driver_name")
