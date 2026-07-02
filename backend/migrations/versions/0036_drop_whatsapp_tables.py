"""drop whatsapp bot tables from tenant schemas

Revision ID: 0036_drop_whatsapp_tables
Revises: 0035_drop_pristine_default_org
Create Date: 2026-07-02 18:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0036_drop_whatsapp_tables"
down_revision: str | None = "0035_drop_pristine_default_org"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_WHATSAPP_TABLES = (
    "processed_whatsapp_messages",
    "whatsapp_conversations",
    "whatsapp_user_shops",
    "whatsapp_users",
)


def _drop_whatsapp_tables(bind, schema: str) -> None:
    for table_name in _WHATSAPP_TABLES:
        bind.execute(sa.text(f'DROP TABLE IF EXISTS "{schema}"."{table_name}" CASCADE'))


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    if "organizations" not in sa.inspect(bind).get_table_names(schema="public"):
        return

    schema_rows = bind.execute(
        sa.text("SELECT DISTINCT schema_name FROM organizations WHERE schema_name IS NOT NULL")
    ).all()
    for (schema_name,) in schema_rows:
        if not schema_name:
            continue
        _drop_whatsapp_tables(bind, schema_name)

    for table_name in _WHATSAPP_TABLES:
        bind.execute(sa.text(f'DROP TABLE IF EXISTS public."{table_name}" CASCADE'))


def downgrade() -> None:
    pass
