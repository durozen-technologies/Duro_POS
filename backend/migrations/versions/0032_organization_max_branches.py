"""organization max_branches for tenant branch limits

Revision ID: 0032_organization_max_branches
Revises: 0031_schema_per_tenant_platform
Create Date: 2026-06-30 22:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0032_organization_max_branches"
down_revision: str | None = "0031_schema_per_tenant_platform"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _table_names(bind) -> set[str]:
    return set(sa.inspect(bind).get_table_names())


def upgrade() -> None:
    bind = op.get_bind()
    if "organizations" not in _table_names(bind):
        return

    cols = {c["name"] for c in sa.inspect(bind).get_columns("organizations")}
    if "max_branches" not in cols:
        op.add_column(
            "organizations",
            sa.Column("max_branches", sa.Integer(), nullable=False, server_default="5"),
        )
        op.alter_column("organizations", "max_branches", server_default=None)

    if "shops" in _table_names(bind):
        op.execute(
            sa.text(
                """
                UPDATE organizations
                SET max_branches = CASE
                    WHEN (
                        SELECT COUNT(*) FROM shops
                        WHERE shops.organization_id = organizations.id
                    ) > max_branches
                    THEN (
                        SELECT COUNT(*) FROM shops
                        WHERE shops.organization_id = organizations.id
                    )
                    ELSE max_branches
                END
                """
            )
        )


def downgrade() -> None:
    bind = op.get_bind()
    if "organizations" not in _table_names(bind):
        return
    cols = {c["name"] for c in sa.inspect(bind).get_columns("organizations")}
    if "max_branches" in cols:
        op.drop_column("organizations", "max_branches")
