"""extend userrole enum for multi-tenant roles

Revision ID: 0028b_userrole_enum_values
Revises: b4c5d6e7f8a9
Create Date: 2026-06-30 12:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0028b_userrole_enum_values"
down_revision: str | None = "b4c5d6e7f8a9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    # ponytail: PG requires enum ADD VALUE committed before use; isolated revision
    # so autocommit does not break alembic_version updates in 0029.
    with op.get_context().autocommit_block():
        for value in ("SUPER_ADMIN", "TENANT_ADMIN"):
            op.execute(sa.text(f"ALTER TYPE userrole ADD VALUE IF NOT EXISTS '{value}'"))


def downgrade() -> None:
    pass
