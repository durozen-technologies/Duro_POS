"""Squashed tenant schema baseline — all operational tables per ADR-003.

Revision ID: 0001_tenant_baseline
Revises:
Create Date: 2026-06-30 12:00:00
"""

from __future__ import annotations

import os
from collections.abc import Sequence

from alembic import op

revision: str = "0001_tenant_baseline"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _target_schema() -> str:
    schema = os.environ.get("TARGET_SCHEMA", "").strip()
    if not schema:
        raise RuntimeError("TARGET_SCHEMA environment variable is required for tenant migrations")
    return schema


def upgrade() -> None:
    from app.db.tenant_metadata import create_tenant_tables

    create_tenant_tables(op.get_bind(), _target_schema())


def downgrade() -> None:
    from app.db.tenant_metadata import drop_tenant_tables

    drop_tenant_tables(op.get_bind(), _target_schema())
