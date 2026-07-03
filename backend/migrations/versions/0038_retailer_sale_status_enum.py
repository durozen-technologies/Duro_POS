"""Create retailersalestatus enum in public for tenant retailer_sales DDL.

Revision ID: 0038_retailer_sale_status_enum
Revises: 0037_retailer_permissions
Create Date: 2026-07-03 00:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0038_retailer_sale_status_enum"
down_revision: str | None = "0037_retailer_permissions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ENUM_NAME = "retailersalestatus"
_ENUM_VALUES = ("open", "partial", "settled", "void")


def _ensure_postgresql_enum(name: str, values: Sequence[str]) -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    quoted_values = ", ".join(f"'{value}'" for value in values)
    op.execute(
        sa.text(
            f"""
            DO $$
            BEGIN
                CREATE TYPE {name} AS ENUM ({quoted_values});
            EXCEPTION
                WHEN duplicate_object THEN NULL;
            END
            $$;
            """
        )
    )


def upgrade() -> None:
    _ensure_postgresql_enum(_ENUM_NAME, _ENUM_VALUES)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute(sa.text(f"DROP TYPE IF EXISTS {_ENUM_NAME} CASCADE"))
