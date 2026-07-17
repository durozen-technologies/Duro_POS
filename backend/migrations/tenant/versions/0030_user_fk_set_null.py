"""Relax user FKs so hard-deleting a user preserves transaction history.

retailer_sales.created_by_user_id, retailer_payments.recorded_by_user_id,
retailer_wallet_payouts.recorded_by_user_id become nullable with
ON DELETE SET NULL; bills.created_by_user_id gains ON DELETE SET NULL.
"""

from __future__ import annotations

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0030_user_fk_set_null"
down_revision: str | None = "0029_tenant_admin_shop_name"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TARGETS = (
    ("retailer_sales", "created_by_user_id"),
    ("retailer_payments", "recorded_by_user_id"),
    ("retailer_wallet_payouts", "recorded_by_user_id"),
    ("bills", "created_by_user_id"),
)


def _target_schema() -> str:
    schema = os.environ.get("TARGET_SCHEMA", "").strip()
    if not schema:
        raise RuntimeError("TARGET_SCHEMA environment variable is required for tenant migrations")
    return schema


def _set_search_path(bind, schema: str) -> None:
    from app.db.tenant_schema import assert_safe_schema_name

    safe = assert_safe_schema_name(schema)
    bind.execute(sa.text(f'SET search_path TO "{safe}", public'))


def upgrade() -> None:
    bind = op.get_bind()
    schema = _target_schema()
    _set_search_path(bind, schema)
    inspector = sa.inspect(bind)

    for table, column in _TARGETS:
        if not inspector.has_table(table, schema=schema):
            continue

        columns = {col["name"]: col for col in inspector.get_columns(table, schema=schema)}
        if column not in columns:
            continue

        if not columns[column]["nullable"]:
            op.alter_column(table, column, nullable=True)

        for fk in inspector.get_foreign_keys(table, schema=schema):
            if fk["constrained_columns"] != [column]:
                continue
            if (fk.get("options") or {}).get("ondelete") == "SET NULL":
                continue
            op.drop_constraint(fk["name"], table, type_="foreignkey")
            op.create_foreign_key(
                fk["name"],
                table,
                "users",
                [column],
                ["id"],
                ondelete="SET NULL",
            )


def downgrade() -> None:
    pass
