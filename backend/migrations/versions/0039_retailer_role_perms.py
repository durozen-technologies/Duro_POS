"""Platform no-op; tenant 0004 grants retailer RBAC per org.

Revision ID: 0039_retailer_role_perms
Revises: 0038_retailer_sale_status_enum
Create Date: 2026-07-03 00:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0039_retailer_role_perms"
down_revision: str | None = "0038_retailer_sale_status_enum"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ponytail: RBAC role rows live in tenant schemas after public cutover (0034).
    # Tenant migration 0004_retailer_role_perms applies grants per org.
    pass


def downgrade() -> None:
    pass
