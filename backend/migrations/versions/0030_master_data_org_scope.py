"""master data organization scoping

Revision ID: 0030_master_data_org_scope
Revises: 0029_multi_tenant_foundation
Create Date: 2026-06-30 01:00:00
"""

from __future__ import annotations

from collections.abc import Sequence
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision: str = "0030_master_data_org_scope"
down_revision: str | None = "0029_multi_tenant_foundation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DEFAULT_ORG_ID = UUID("01900000-0000-7000-8000-000000000001")

MASTER_TABLES = (
    "item_categories",
    "items",
    "inventory_categories",
    "inventory_items",
    "expense_items",
    "transfer_shops",
)


def _column_names(bind, table_name: str) -> set[str]:
    if table_name not in sa.inspect(bind).get_table_names():
        return set()
    return {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    for table_name in MASTER_TABLES:
        if "organization_id" in _column_names(bind, table_name):
            continue
        op.add_column(table_name, sa.Column("organization_id", sa.Uuid(as_uuid=True), nullable=True))
        op.create_foreign_key(
            f"fk_{table_name}_organization_id_organizations",
            table_name,
            "organizations",
            ["organization_id"],
            ["id"],
            ondelete="CASCADE",
        )
        op.create_index(f"ix_{table_name}_organization_id", table_name, ["organization_id"])

    if "items" in sa.inspect(bind).get_table_names():
        bind.execute(
            sa.text(
                "UPDATE items SET organization_id = :org_id "
                "WHERE organization_id IS NULL AND shop_id IS NULL"
            ),
            {"org_id": DEFAULT_ORG_ID},
        )
        bind.execute(
            sa.text(
                "UPDATE items SET organization_id = shops.organization_id "
                "FROM shops WHERE items.shop_id = shops.id AND items.organization_id IS NULL"
            )
        )

    for table_name in (
        "item_categories",
        "inventory_categories",
        "inventory_items",
        "expense_items",
        "transfer_shops",
    ):
        if table_name in sa.inspect(bind).get_table_names():
            bind.execute(
                sa.text(
                    f"UPDATE {table_name} SET organization_id = :org_id WHERE organization_id IS NULL"
                ),
                {"org_id": DEFAULT_ORG_ID},
            )

    for table_name in MASTER_TABLES:
        if table_name in sa.inspect(bind).get_table_names():
            if bind.dialect.name == "postgresql":
                op.alter_column(table_name, "organization_id", nullable=False)


def downgrade() -> None:
    bind = op.get_bind()
    for table_name in reversed(MASTER_TABLES):
        if "organization_id" not in _column_names(bind, table_name):
            continue
        op.drop_constraint(
            f"fk_{table_name}_organization_id_organizations", table_name, type_="foreignkey"
        )
        op.drop_index(f"ix_{table_name}_organization_id", table_name=table_name)
        op.drop_column(table_name, "organization_id")
