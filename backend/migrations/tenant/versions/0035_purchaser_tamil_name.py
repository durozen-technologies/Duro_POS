"""Add purchaser tamil_name and movement purchaser_tamil_name snapshot."""

from __future__ import annotations

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0035_purchaser_tamil_name"
down_revision: str | None = "0034_inventory_weight_loss"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


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
    from app.db.tenant_metadata import _safe_schema_name

    safe = _safe_schema_name(schema)
    inspector = sa.inspect(bind)

    if inspector.has_table("purchasers", schema=safe):
        columns = {c["name"] for c in inspector.get_columns("purchasers", schema=safe)}
        if "tamil_name" not in columns:
            op.add_column(
                "purchasers",
                sa.Column(
                    "tamil_name",
                    sa.String(length=120),
                    nullable=False,
                    server_default="",
                ),
                schema=safe,
            )
            bind.execute(
                sa.text(
                    f'UPDATE "{safe}".purchasers '
                    "SET tamil_name = name "
                    "WHERE length(trim(tamil_name)) = 0"
                )
            )
            op.create_check_constraint(
                "ck_purchasers_tamil_name_not_blank",
                "purchasers",
                "length(trim(tamil_name)) >= 1",
                schema=safe,
            )
            op.alter_column(
                "purchasers",
                "tamil_name",
                server_default=None,
                schema=safe,
            )

    if inspector.has_table("inventory_movements", schema=safe):
        columns = {
            c["name"] for c in inspector.get_columns("inventory_movements", schema=safe)
        }
        if "purchaser_tamil_name" not in columns:
            op.add_column(
                "inventory_movements",
                sa.Column("purchaser_tamil_name", sa.String(length=120), nullable=True),
                schema=safe,
            )


def downgrade() -> None:
    bind = op.get_bind()
    schema = _target_schema()
    _set_search_path(bind, schema)
    from app.db.tenant_metadata import _safe_schema_name

    safe = _safe_schema_name(schema)
    inspector = sa.inspect(bind)

    if inspector.has_table("inventory_movements", schema=safe):
        columns = {
            c["name"] for c in inspector.get_columns("inventory_movements", schema=safe)
        }
        if "purchaser_tamil_name" in columns:
            op.drop_column("inventory_movements", "purchaser_tamil_name", schema=safe)

    if inspector.has_table("purchasers", schema=safe):
        columns = {c["name"] for c in inspector.get_columns("purchasers", schema=safe)}
        if "tamil_name" in columns:
            op.drop_constraint(
                "ck_purchasers_tamil_name_not_blank",
                "purchasers",
                type_="check",
                schema=safe,
            )
            op.drop_column("purchasers", "tamil_name", schema=safe)
