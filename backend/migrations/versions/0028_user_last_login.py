"""track user last login time

Revision ID: 0028_user_last_login
Revises: 0027_category_one_to_one_maps
Create Date: 2026-06-16 00:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0028_user_last_login"
down_revision: str | None = "0027_category_one_to_one_maps"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _column_names(bind, table_name: str) -> set[str]:
    if table_name not in sa.inspect(bind).get_table_names():
        return set()
    return {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    if "last_login_at" in _column_names(bind, "users"):
        return

    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("users") as batch_op:
            batch_op.add_column(
                sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True)
            )
        return

    op.add_column("users", sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    if "last_login_at" not in _column_names(bind, "users"):
        return

    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("users") as batch_op:
            batch_op.drop_column("last_login_at")
        return

    op.drop_column("users", "last_login_at")
