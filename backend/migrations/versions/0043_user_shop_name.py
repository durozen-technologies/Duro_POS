"""Add shop_name to public users table."""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0043_user_shop_name"
down_revision: str | None = "0042_global_image_templates"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _column_names(bind, table_name: str) -> set[str]:
    if table_name not in sa.inspect(bind).get_table_names():
        return set()
    return {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    if "shop_name" in _column_names(bind, "users"):
        return

    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("users") as batch_op:
            batch_op.add_column(sa.Column("shop_name", sa.String(length=120), nullable=True))
        return

    op.add_column("users", sa.Column("shop_name", sa.String(length=120), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    if "shop_name" not in _column_names(bind, "users"):
        return

    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("users") as batch_op:
            batch_op.drop_column("shop_name")
        return

    op.drop_column("users", "shop_name")
