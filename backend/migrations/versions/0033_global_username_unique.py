"""global unique username on user_auth_index

Revision ID: 0033_global_username_unique
Revises: 0032_organization_max_branches
Create Date: 2026-06-30 23:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0033_global_username_unique"
down_revision: str | None = "0032_organization_max_branches"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _table_names(bind) -> set[str]:
    return set(sa.inspect(bind).get_table_names())


def upgrade() -> None:
    bind = op.get_bind()
    if "user_auth_index" not in _table_names(bind):
        return

    # ponytail: keep lexicographically smallest id per username; upgrade path is manual dedupe if wrong row kept
    op.execute(
        sa.text(
            """
            DELETE FROM user_auth_index a
            USING user_auth_index b
            WHERE a.username_lower = b.username_lower
              AND a.id > b.id
            """
        )
    )

    op.drop_index("uq_user_auth_index_username_org", table_name="user_auth_index")
    op.drop_index(op.f("ix_user_auth_index_username_lower"), table_name="user_auth_index")
    op.create_index(
        "uq_user_auth_index_username_lower",
        "user_auth_index",
        ["username_lower"],
        unique=True,
    )


def downgrade() -> None:
    bind = op.get_bind()
    if "user_auth_index" not in _table_names(bind):
        return

    op.drop_index("uq_user_auth_index_username_lower", table_name="user_auth_index")
    op.create_index(
        op.f("ix_user_auth_index_username_lower"),
        "user_auth_index",
        ["username_lower"],
        unique=False,
    )
    op.create_index(
        "uq_user_auth_index_username_org",
        "user_auth_index",
        ["username_lower", "organization_id"],
        unique=True,
    )
