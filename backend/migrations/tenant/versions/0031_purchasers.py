"""Add purchasers table and inventory_movements purchaser fields."""

from __future__ import annotations

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0031_purchasers"
down_revision: str | None = "0030_user_fk_set_null"
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
    from app import models as _models  # noqa: F401
    from app.db.database import Base
    from app.db.tenant_metadata import _safe_schema_name

    bind = op.get_bind()
    schema = _target_schema()
    safe = _safe_schema_name(schema)
    _set_search_path(bind, schema)
    inspector = sa.inspect(bind)

    if not inspector.has_table("purchasers", schema=safe):
        table = Base.metadata.tables["purchasers"]
        table.create(bind, checkfirst=False)

    if inspector.has_table("inventory_movements", schema=safe):
        columns = {
            column["name"]
            for column in inspector.get_columns("inventory_movements", schema=safe)
        }
        if "purchaser_id" not in columns:
            op.add_column(
                "inventory_movements",
                sa.Column("purchaser_id", sa.Uuid(), nullable=True),
            )
            op.create_index(
                "ix_inventory_movements_purchaser_id",
                "inventory_movements",
                ["purchaser_id"],
                unique=False,
            )
            op.create_foreign_key(
                "fk_inventory_movements_purchaser_id_purchasers",
                "inventory_movements",
                "purchasers",
                ["purchaser_id"],
                ["id"],
                ondelete="SET NULL",
            )
        if "purchaser_name" not in columns:
            op.add_column(
                "inventory_movements",
                sa.Column("purchaser_name", sa.String(length=120), nullable=True),
            )


def downgrade() -> None:
    from app.db.tenant_metadata import _safe_schema_name

    bind = op.get_bind()
    schema = _target_schema()
    safe = _safe_schema_name(schema)
    _set_search_path(bind, schema)
    inspector = sa.inspect(bind)

    if inspector.has_table("inventory_movements", schema=safe):
        columns = {
            column["name"]
            for column in inspector.get_columns("inventory_movements", schema=safe)
        }
        fks = {
            fk["name"]
            for fk in inspector.get_foreign_keys("inventory_movements", schema=safe)
            if fk.get("name")
        }
        if "fk_inventory_movements_purchaser_id_purchasers" in fks:
            op.drop_constraint(
                "fk_inventory_movements_purchaser_id_purchasers",
                "inventory_movements",
                type_="foreignkey",
            )
        indexes = {
            idx["name"]
            for idx in inspector.get_indexes("inventory_movements", schema=safe)
            if idx.get("name")
        }
        if "ix_inventory_movements_purchaser_id" in indexes:
            op.drop_index("ix_inventory_movements_purchaser_id", table_name="inventory_movements")
        if "purchaser_name" in columns:
            op.drop_column("inventory_movements", "purchaser_name")
        if "purchaser_id" in columns:
            op.drop_column("inventory_movements", "purchaser_id")

    if inspector.has_table("purchasers", schema=safe):
        op.drop_table("purchasers")
