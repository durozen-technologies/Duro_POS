"""Create retailerreceipttype enum in public for tenant retailer_sale_receipts DDL."""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0040_retailer_receipt_type_enum"
down_revision: str | None = "0039_retailer_role_perms"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ENUM_NAME = "retailerreceipttype"
_ENUM_VALUES = ("sale_invoice", "balance_payment")


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
