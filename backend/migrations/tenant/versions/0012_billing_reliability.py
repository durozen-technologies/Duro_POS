"""Billing reliability: checkout snapshots, receipt status, bill metadata."""

from __future__ import annotations

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012_billing_reliability"
down_revision: str | None = "0011_retailer_inventory_usages"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _target_schema() -> str:
    schema = os.environ.get("TARGET_SCHEMA", "").strip()
    if not schema:
        raise RuntimeError("TARGET_SCHEMA environment variable is required for tenant migrations")
    return schema


def _set_search_path(bind, schema: str) -> None:
    from app.db.tenant_schema import assert_safe_schema_name

    safe = assert_safe_schema_name(schema)
    bind.execute(sa.text(f'SET search_path TO "{safe}", public'))


def _receipt_status_column():
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return sa.Column(
            "receipt_status",
            sa.Enum("pending", "printed", "failed", name="receiptstatus", create_type=False),
            nullable=False,
            server_default="printed",
        )
    return sa.Column(
        "receipt_status",
        sa.String(16),
        nullable=False,
        server_default="printed",
    )


def upgrade() -> None:
    bind = op.get_bind()
    schema = _target_schema()
    _set_search_path(bind, schema)
    inspector = sa.inspect(bind)

    if not inspector.has_table("checkout_snapshots"):
        from app.db.tenant_metadata import create_tenant_tables

        create_tenant_tables(bind, schema)
        inspector = sa.inspect(bind)

    bill_columns = (
        {col["name"] for col in inspector.get_columns("bills")} if inspector.has_table("bills") else set()
    )
    if inspector.has_table("bills"):
        if "checkout_token" not in bill_columns:
            if bind.dialect.name == "postgresql":
                bind.execute(
                    sa.text(
                        "ALTER TABLE bills ADD COLUMN IF NOT EXISTS checkout_token VARCHAR(512)"
                    )
                )
                bind.execute(
                    sa.text(
                        "CREATE UNIQUE INDEX IF NOT EXISTS ix_bills_checkout_token "
                        "ON bills (checkout_token)"
                    )
                )
            else:
                op.add_column("bills", sa.Column("checkout_token", sa.String(512), nullable=True))
                op.create_index("ix_bills_checkout_token", "bills", ["checkout_token"], unique=True)
        if "created_by_user_id" not in bill_columns:
            if bind.dialect.name == "postgresql":
                bind.execute(
                    sa.text(
                        "ALTER TABLE bills ADD COLUMN IF NOT EXISTS created_by_user_id UUID"
                    )
                )
                bind.execute(
                    sa.text(
                        "CREATE INDEX IF NOT EXISTS ix_bills_created_by_user_id "
                        "ON bills (created_by_user_id)"
                    )
                )
                foreign_key_names = {
                    key["name"]
                    for key in inspector.get_foreign_keys("bills")
                    if key.get("name")
                }
                if "fk_bills_created_by_user_id_users" not in foreign_key_names:
                    bind.execute(
                        sa.text(
                            """
                            ALTER TABLE bills
                            ADD CONSTRAINT fk_bills_created_by_user_id_users
                            FOREIGN KEY (created_by_user_id) REFERENCES users(id)
                            """
                        )
                    )
            else:
                op.add_column("bills", sa.Column("created_by_user_id", sa.Uuid(), nullable=True))
                op.create_index("ix_bills_created_by_user_id", "bills", ["created_by_user_id"])
                op.create_foreign_key(
                    "fk_bills_created_by_user_id_users",
                    "bills",
                    "users",
                    ["created_by_user_id"],
                    ["id"],
                )
        if "item_count" not in bill_columns:
            if bind.dialect.name == "postgresql":
                bind.execute(
                    sa.text(
                        "ALTER TABLE bills ADD COLUMN IF NOT EXISTS item_count "
                        "INTEGER NOT NULL DEFAULT 0"
                    )
                )
            else:
                op.add_column(
                    "bills",
                    sa.Column("item_count", sa.Integer(), nullable=False, server_default="0"),
                )
        if "total_quantity" not in bill_columns:
            if bind.dialect.name == "postgresql":
                bind.execute(
                    sa.text(
                        "ALTER TABLE bills ADD COLUMN IF NOT EXISTS total_quantity "
                        "NUMERIC(10, 3) NOT NULL DEFAULT 0"
                    )
                )
            else:
                op.add_column(
                    "bills",
                    sa.Column("total_quantity", sa.Numeric(10, 3), nullable=False, server_default="0"),
                )

    if inspector.has_table("receipts"):
        receipt_columns = {col["name"] for col in inspector.get_columns("receipts")}
        if "receipt_status" not in receipt_columns:
            op.add_column("receipts", _receipt_status_column())
            bind.execute(sa.text("UPDATE receipts SET receipt_status = 'printed'"))
            op.create_index("ix_receipts_receipt_status", "receipts", ["receipt_status"])
        if "print_attempts" not in receipt_columns:
            op.add_column(
                "receipts",
                sa.Column("print_attempts", sa.Integer(), nullable=False, server_default="0"),
            )
            bind.execute(
                sa.text("UPDATE receipts SET print_attempts = 1 WHERE printed_at IS NOT NULL")
            )
        if "last_print_error" not in receipt_columns:
            op.add_column("receipts", sa.Column("last_print_error", sa.Text(), nullable=True))
        if receipt_columns and "printed_at" in receipt_columns:
            printed_at_col = next(
                col for col in inspector.get_columns("receipts") if col["name"] == "printed_at"
            )
            if not printed_at_col.get("nullable", False):
                op.alter_column("receipts", "printed_at", nullable=True)


def downgrade() -> None:
    pass
