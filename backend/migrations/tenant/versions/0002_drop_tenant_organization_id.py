"""Tenant schema revision after baseline (org_id columns kept for ORM/SQLite parity)."""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0002_drop_tenant_organization_id"
down_revision: str | None = "0001_tenant_baseline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ponytail: physical DROP organization_id deferred — SQLAlchemy models still emit the column;
    # hot-path services drop redundant filters instead (schema isolation is the boundary).
    pass


def downgrade() -> None:
    pass
