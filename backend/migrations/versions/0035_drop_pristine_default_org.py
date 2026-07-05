"""drop pristine default org placeholder

Revision ID: 0035_drop_pristine_default_org
Revises: 0034_public_schema_cutover
Create Date: 2026-07-02 12:00:00
"""

from __future__ import annotations

from collections.abc import Sequence
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision: str = "0035_drop_pristine_default_org"
down_revision: str | None = "0034_public_schema_cutover"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DEFAULT_ORG_ID = UUID("01900000-0000-7000-8000-000000000001")


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    row = bind.execute(
        sa.text(
            "SELECT id, schema_name FROM organizations WHERE id = :org_id AND slug = 'default'"
        ),
        {"org_id": DEFAULT_ORG_ID},
    ).one_or_none()
    if row is None:
        return

    org_id, schema_name = row

    has_auth_index = bind.execute(
        sa.text("SELECT 1 FROM user_auth_index WHERE organization_id = :org_id LIMIT 1"),
        {"org_id": org_id},
    ).scalar_one_or_none()
    if has_auth_index is not None:
        return

    has_tenant_users = bind.execute(
        sa.text("SELECT 1 FROM users WHERE organization_id = :org_id LIMIT 1"),
        {"org_id": org_id},
    ).scalar_one_or_none()
    if has_tenant_users is not None:
        return

    if schema_name:
        bind.execute(sa.text(f'DROP SCHEMA IF EXISTS "{schema_name}" CASCADE'))

    bind.execute(sa.text("DELETE FROM organizations WHERE id = :org_id"), {"org_id": org_id})


def downgrade() -> None:
    pass
