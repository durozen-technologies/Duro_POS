"""public schema cutover: NOT NULL schema_name, drop tenant DDL from public

Revision ID: 0034_public_schema_cutover
Revises: 0033_global_username_unique
Create Date: 2026-06-30 23:30:00
"""

from __future__ import annotations

import re
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0034_public_schema_cutover"
down_revision: str | None = "0033_global_username_unique"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PUBLIC_ALLOWLIST = frozenset(
    {
        "organizations",
        "permissions",
        "user_auth_index",
        "users",
        "audit_logs",
        "alembic_version",
    }
)


def _derive_schema_name(slug: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "_", slug.strip().lower()).strip("_")
    if not normalized:
        raise ValueError("Cannot derive schema name from empty slug")
    return f"tenant_{normalized}"[:63]


def _public_tables(bind) -> set[str]:
    return set(sa.inspect(bind).get_table_names(schema="public"))


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    if "organizations" not in _public_tables(bind):
        return

    cols = {c["name"] for c in sa.inspect(bind).get_columns("organizations", schema="public")}
    if "schema_name" not in cols:
        return

    rows = bind.execute(
        sa.text("SELECT id, slug, schema_name FROM organizations WHERE schema_name IS NULL")
    ).all()
    for org_id, slug, _ in rows:
        schema_name = _derive_schema_name(slug)
        bind.execute(
            sa.text(
                "UPDATE organizations SET schema_name = :schema_name WHERE id = :org_id"
            ),
            {"schema_name": schema_name, "org_id": org_id},
        )

    for table_name in sorted(_public_tables(bind) - _PUBLIC_ALLOWLIST):
        op.execute(sa.text(f'DROP TABLE IF EXISTS public."{table_name}" CASCADE'))

    if "users" in _public_tables(bind):
        bind.execute(
            sa.text("DELETE FROM public.users WHERE organization_id IS NOT NULL")
        )

    if "audit_logs" in _public_tables(bind):
        bind.execute(
            sa.text("DELETE FROM public.audit_logs WHERE organization_id IS NOT NULL")
        )

    op.alter_column("organizations", "schema_name", nullable=False)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    if "organizations" not in _public_tables(bind):
        return
    op.alter_column("organizations", "schema_name", nullable=True)
