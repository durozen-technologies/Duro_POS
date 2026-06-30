"""drop inventory movement quantity positive constraint

Revision ID: d199bf838d3f
Revises: 0f40690b114f
Create Date: 2026-06-27 13:18:12.715627
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "d199bf838d3f"
down_revision: Union[str, None] = "0f40690b114f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_CONSTRAINT = "ck_inventory_movements_quantity_positive"


def _check_constraint_names(bind, table_name: str) -> set[str]:
    return {row["name"] for row in sa.inspect(bind).get_check_constraints(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    if _CONSTRAINT in _check_constraint_names(bind, "inventory_movements"):
        op.drop_constraint(_CONSTRAINT, "inventory_movements", type_="check")


def downgrade() -> None:
    bind = op.get_bind()
    if _CONSTRAINT not in _check_constraint_names(bind, "inventory_movements"):
        op.create_check_constraint(_CONSTRAINT, "inventory_movements", "quantity > 0")
