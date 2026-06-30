"""schema-per-tenant platform: schema_name on organizations, user_auth_index

Revision ID: 0031_schema_per_tenant_platform
Revises: 0030_master_data_org_scope
Create Date: 2026-06-30 12:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0031_schema_per_tenant_platform"
down_revision: str | None = "0030_master_data_org_scope"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _table_names(bind) -> set[str]:
    return set(sa.inspect(bind).get_table_names())


def upgrade() -> None:
    bind = op.get_bind()
    if "organizations" in _table_names(bind):
        cols = {c["name"] for c in sa.inspect(bind).get_columns("organizations")}
        if "schema_name" not in cols:
            op.add_column(
                "organizations",
                sa.Column("schema_name", sa.String(length=63), nullable=True),
            )
            op.create_index(
                op.f("ix_organizations_schema_name"),
                "organizations",
                ["schema_name"],
                unique=True,
            )

    if "user_auth_index" not in _table_names(bind):
        op.create_table(
            "user_auth_index",
            sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("username_lower", sa.String(length=50), nullable=False),
            sa.Column("organization_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("schema_name", sa.String(length=63), nullable=False),
            sa.Column("user_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["organization_id"],
                ["organizations.id"],
                name=op.f("fk_user_auth_index_organization_id_organizations"),
                ondelete="CASCADE",
            ),
        )
        op.create_index(
            op.f("ix_user_auth_index_username_lower"),
            "user_auth_index",
            ["username_lower"],
            unique=False,
        )
        op.create_index(
            op.f("ix_user_auth_index_organization_id"),
            "user_auth_index",
            ["organization_id"],
            unique=False,
        )
        op.create_index(
            op.f("ix_user_auth_index_user_id"),
            "user_auth_index",
            ["user_id"],
            unique=False,
        )
        op.create_index(
            "uq_user_auth_index_username_org",
            "user_auth_index",
            ["username_lower", "organization_id"],
            unique=True,
        )


def downgrade() -> None:
    bind = op.get_bind()
    if "user_auth_index" in _table_names(bind):
        op.drop_table("user_auth_index")
    if "organizations" in _table_names(bind):
        cols = {c["name"] for c in sa.inspect(bind).get_columns("organizations")}
        if "schema_name" in cols:
            op.drop_index(op.f("ix_organizations_schema_name"), table_name="organizations")
            op.drop_column("organizations", "schema_name")
