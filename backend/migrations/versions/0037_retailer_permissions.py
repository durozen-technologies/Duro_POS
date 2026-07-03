"""Add retailer RBAC permissions.

Revision ID: 0037_retailer_permissions
Revises: 0036_drop_whatsapp_tables
Create Date: 2026-07-03 00:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0037_retailer_permissions"
down_revision: str | None = "0036_drop_whatsapp_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PERMISSIONS = [
    ("retailers.read", "View retailers and sales", "retailers"),
    ("retailers.manage", "Manage retailers, prices, and payments", "retailers"),
]


def upgrade() -> None:
    bind = op.get_bind()
    for code, description, module in PERMISSIONS:
        bind.execute(
            sa.text(
                "INSERT INTO permissions (code, description, module) "
                "VALUES (:code, :description, :module) "
                "ON CONFLICT (code) DO NOTHING"
            ),
            {"code": code, "description": description, "module": module},
        )


def downgrade() -> None:
    bind = op.get_bind()
    for code, _, _ in PERMISSIONS:
        bind.execute(sa.text("DELETE FROM permissions WHERE code = :code"), {"code": code})
