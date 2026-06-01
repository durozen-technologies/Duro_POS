"""add shop scoped items

Revision ID: 0003_add_shop_scoped_items
Revises: 0002_drop_legacy_item_image_data
Create Date: 2026-05-29 00:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_add_shop_scoped_items"
down_revision: str | None = "0002_drop_legacy_item_image_data"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _table_names(bind) -> set[str]:
    return set(sa.inspect(bind).get_table_names())


def _column_names(bind, table_name: str) -> set[str]:
    if table_name not in _table_names(bind):
        return set()
    return {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def _index_names(bind, table_name: str) -> set[str]:
    if table_name not in _table_names(bind):
        return set()
    return {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def _unique_constraint_names_for_columns(bind, table_name: str, columns: set[str]) -> set[str]:
    if table_name not in _table_names(bind):
        return set()
    return {
        constraint["name"]
        for constraint in sa.inspect(bind).get_unique_constraints(table_name)
        if set(constraint["column_names"]) == columns and constraint["name"]
    }


def _constraint_names(bind, table_name: str) -> set[str]:
    if table_name not in _table_names(bind):
        return set()
    inspector = sa.inspect(bind)
    names = set()
    for collection in (
        inspector.get_check_constraints(table_name),
        inspector.get_unique_constraints(table_name),
        inspector.get_foreign_keys(table_name),
    ):
        names.update(item["name"] for item in collection if item.get("name"))
    return names


def upgrade() -> None:
    bind = op.get_bind()
    if "shop_id" not in _column_names(bind, "items"):
        op.add_column("items", sa.Column("shop_id", sa.Uuid(as_uuid=True), nullable=True))

    if bind.dialect.name == "sqlite":
        unique_names = _unique_constraint_names_for_columns(bind, "items", {"name"})
        if unique_names:
            with op.batch_alter_table("items", recreate="always") as batch_op:
                for constraint_name in unique_names:
                    batch_op.drop_constraint(constraint_name, type_="unique")
    else:
        for constraint_name in _unique_constraint_names_for_columns(bind, "items", {"name"}):
            op.drop_constraint(constraint_name, "items", type_="unique")

    if bind.dialect.name != "sqlite" and "fk_items_shop_id_shops" not in _constraint_names(
        bind, "items"
    ):
        op.create_foreign_key(
            "fk_items_shop_id_shops",
            "items",
            "shops",
            ["shop_id"],
            ["id"],
            ondelete="CASCADE",
        )

    if "ix_items_shop_id" not in _index_names(bind, "items"):
        op.create_index("ix_items_shop_id", "items", ["shop_id"])
    if "ux_items_global_name_lower" not in _index_names(bind, "items"):
        op.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_items_global_name_lower "
            "ON items (lower(name)) WHERE shop_id IS NULL"
        )
    if "ux_items_shop_name_lower" not in _index_names(bind, "items"):
        op.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_items_shop_name_lower "
            "ON items (shop_id, lower(name)) WHERE shop_id IS NOT NULL"
        )


def downgrade() -> None:
    bind = op.get_bind()
    if "ux_items_shop_name_lower" in _index_names(bind, "items"):
        op.drop_index("ux_items_shop_name_lower", table_name="items")
    if "ux_items_global_name_lower" in _index_names(bind, "items"):
        op.drop_index("ux_items_global_name_lower", table_name="items")

    if "ix_items_shop_id" in _index_names(bind, "items"):
        op.drop_index("ix_items_shop_id", table_name="items")

    if bind.dialect.name != "sqlite" and "fk_items_shop_id_shops" in _constraint_names(
        bind, "items"
    ):
        op.drop_constraint("fk_items_shop_id_shops", "items", type_="foreignkey")

    if "shop_id" in _column_names(bind, "items"):
        op.drop_column("items", "shop_id")
