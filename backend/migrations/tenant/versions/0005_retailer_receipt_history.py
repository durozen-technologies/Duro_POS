"""Allow multiple retailer sale receipts linked to payments."""

from __future__ import annotations

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005_retailer_receipt_history"
down_revision: str | None = "0004_retailer_role_perms"
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


def upgrade() -> None:
    bind = op.get_bind()
    _set_search_path(bind, _target_schema())
    inspector = sa.inspect(bind)
    if not inspector.has_table("retailer_sale_receipts"):
        return

    columns = {col["name"] for col in inspector.get_columns("retailer_sale_receipts")}
    if "receipt_type" not in columns:
        if bind.dialect.name == "postgresql":
            op.add_column(
                "retailer_sale_receipts",
                sa.Column(
                    "receipt_type",
                    sa.Enum(
                        "sale_invoice",
                        "balance_payment",
                        name="retailerreceipttype",
                        create_type=False,
                    ),
                    nullable=False,
                    server_default="sale_invoice",
                ),
            )
        else:
            op.add_column(
                "retailer_sale_receipts",
                sa.Column(
                    "receipt_type",
                    sa.String(32),
                    nullable=False,
                    server_default="sale_invoice",
                ),
            )

    if "retailer_payment_id" not in columns:
        op.add_column(
            "retailer_sale_receipts",
            sa.Column("retailer_payment_id", sa.Uuid(), nullable=True),
        )
        bind.execute(
            sa.text(
                """
                UPDATE retailer_sale_receipts r
                SET retailer_payment_id = (
                    SELECT p.id
                    FROM retailer_payments p
                    WHERE p.retailer_sale_id = r.retailer_sale_id
                    ORDER BY p.paid_at ASC, p.id ASC
                    LIMIT 1
                )
                """
            )
        )
        orphan_count = bind.execute(
            sa.text(
                "SELECT COUNT(*) FROM retailer_sale_receipts WHERE retailer_payment_id IS NULL"
            )
        ).scalar_one()
        if orphan_count:
            raise RuntimeError(
                f"{orphan_count} retailer_sale_receipts row(s) have no matching payment"
            )
        op.alter_column("retailer_sale_receipts", "retailer_payment_id", nullable=False)
        op.create_foreign_key(
            "fk_retailer_sale_receipts_payment_id",
            "retailer_sale_receipts",
            "retailer_payments",
            ["retailer_payment_id"],
            ["id"],
            ondelete="CASCADE",
        )
        op.create_unique_constraint(
            "uq_retailer_sale_receipts_payment_id",
            "retailer_sale_receipts",
            ["retailer_payment_id"],
        )

    unique_constraints = {
        uc["name"]
        for uc in inspector.get_unique_constraints("retailer_sale_receipts")
    }
    for uc in inspector.get_unique_constraints("retailer_sale_receipts"):
        if uc["column_names"] == ["retailer_sale_id"]:
            op.drop_constraint(uc["name"], "retailer_sale_receipts", type_="unique")

    indexes = {idx["name"] for idx in inspector.get_indexes("retailer_sale_receipts")}
    if "ix_retailer_sale_receipts_sale_id_printed_at" not in indexes:
        op.create_index(
            "ix_retailer_sale_receipts_sale_id_printed_at",
            "retailer_sale_receipts",
            ["retailer_sale_id", "printed_at"],
        )

    if bind.dialect.name == "postgresql":
        op.alter_column("retailer_sale_receipts", "receipt_type", server_default=None)
        op.alter_column(
            "retailer_sale_receipts",
            "receipt_number",
            type_=sa.String(80),
            existing_type=sa.String(50),
            existing_nullable=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    _set_search_path(bind, _target_schema())
    inspector = sa.inspect(bind)
    if not inspector.has_table("retailer_sale_receipts"):
        return

    indexes = {idx["name"] for idx in inspector.get_indexes("retailer_sale_receipts")}
    if "ix_retailer_sale_receipts_sale_id_printed_at" in indexes:
        op.drop_index(
            "ix_retailer_sale_receipts_sale_id_printed_at",
            table_name="retailer_sale_receipts",
        )

    unique_constraints = {
        uc["name"]: uc["column_names"]
        for uc in inspector.get_unique_constraints("retailer_sale_receipts")
    }
    if "uq_retailer_sale_receipts_payment_id" in unique_constraints:
        op.drop_constraint(
            "uq_retailer_sale_receipts_payment_id",
            "retailer_sale_receipts",
            type_="unique",
        )

    columns = {col["name"] for col in inspector.get_columns("retailer_sale_receipts")}
    if "retailer_payment_id" in columns:
        op.drop_constraint(
            "fk_retailer_sale_receipts_payment_id",
            "retailer_sale_receipts",
            type_="foreignkey",
        )
        op.drop_column("retailer_sale_receipts", "retailer_payment_id")

    if "receipt_type" in columns:
        op.drop_column("retailer_sale_receipts", "receipt_type")

    if not any(cols == ["retailer_sale_id"] for cols in unique_constraints.values()):
        op.create_unique_constraint(
            "retailer_sale_receipts_retailer_sale_id_key",
            "retailer_sale_receipts",
            ["retailer_sale_id"],
        )
