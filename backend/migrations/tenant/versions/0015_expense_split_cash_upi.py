"""Add cash/UPI split amounts to tenant expense entries."""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015_expense_split_cash_upi"
down_revision: str | None = "0014_retailer_receipt_openingb"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "expense_entries",
        sa.Column("cash_amount", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),
    )
    op.add_column(
        "expense_entries",
        sa.Column("upi_amount", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),
    )
    op.execute(
        sa.text(
            "UPDATE expense_entries SET cash_amount = amount, upi_amount = 0 "
            "WHERE cash_amount = 0 AND upi_amount = 0"
        )
    )
    op.create_check_constraint(
        "ck_expense_entries_cash_non_negative",
        "expense_entries",
        "cash_amount >= 0",
    )
    op.create_check_constraint(
        "ck_expense_entries_upi_non_negative",
        "expense_entries",
        "upi_amount >= 0",
    )
    op.create_check_constraint(
        "ck_expense_entries_split_positive",
        "expense_entries",
        "(cash_amount + upi_amount) > 0",
    )
    op.alter_column("expense_entries", "cash_amount", server_default=None)
    op.alter_column("expense_entries", "upi_amount", server_default=None)


def downgrade() -> None:
    op.drop_constraint("ck_expense_entries_split_positive", "expense_entries", type_="check")
    op.drop_constraint("ck_expense_entries_upi_non_negative", "expense_entries", type_="check")
    op.drop_constraint("ck_expense_entries_cash_non_negative", "expense_entries", type_="check")
    op.drop_column("expense_entries", "upi_amount")
    op.drop_column("expense_entries", "cash_amount")
