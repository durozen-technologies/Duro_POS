"""Create receiptstatus enum in public for tenant receipts DDL."""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0041_receipt_status_enum"
down_revision: str | None = "0040_retailer_receipt_type_enum"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ENUM_NAME = "receiptstatus"
_ENUM_VALUES = ("pending", "printed", "failed")


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
    op.execute(sa.text(f"DROP TYPE IF EXISTS {_ENUM_NAME}"))
