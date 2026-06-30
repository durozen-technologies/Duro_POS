"""Add shop backdating config

Revision ID: acc38e8c9926
Revises: a3b8c4d5e6f7
Create Date: 2026-06-29 11:52:22.392579
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

revision: str = "acc38e8c9926"
down_revision: Union[str, None] = "a3b8c4d5e6f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ponytail: inventory_backdate_policy is created in a3b8c4d5e6f7; autogenerate duplicated it here
    return None


def downgrade() -> None:
    return None
