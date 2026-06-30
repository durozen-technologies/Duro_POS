"""inventory management

Revision ID: 0015_inventory_management
Revises: 0014_admin_items_perf_indexes
Create Date: 2026-06-04 00:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0015_inventory_management"
down_revision: str | None = "0014_admin_items_perf_indexes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _table_names(bind) -> set[str]:
    return set(sa.inspect(bind).get_table_names())


def _index_names(bind, table_name: str) -> set[str]:
    if table_name not in _table_names(bind):
        return set()
    return {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def _create_index_if_missing(table_name: str, index_name: str, columns: list[str]) -> None:
    bind = op.get_bind()
    if table_name not in _table_names(bind):
        return
    if index_name in _index_names(bind, table_name):
        return
    op.create_index(index_name, table_name, columns)


def _enum_type(bind, name: str, values: Sequence[str]) -> sa.Enum:
    if bind.dialect.name == "postgresql":
        return postgresql.ENUM(*values, name=name, create_type=False)
    return sa.Enum(*values, name=name)


def _ensure_postgresql_enum(bind, name: str, values: Sequence[str]) -> None:
    if bind.dialect.name != "postgresql":
        return
    quoted_values = ", ".join(f"'{value}'" for value in values)
    op.execute(
        sa.text(
            f"""
            DO $$
            BEGIN
                CREATE TYPE {name} AS ENUM ({quoted_values});
            EXCEPTION
                WHEN duplicate_object THEN NULL;
            END
            $$;
            """
        )
    )


def upgrade() -> None:
    bind = op.get_bind()
    timestamp_default = sa.func.now()
    tables = _table_names(bind)
    unit_type_enum = _enum_type(bind, "unittype", ("WEIGHT", "COUNT"))
    base_unit_enum = _enum_type(bind, "baseunit", ("KG", "UNIT"))
    _ensure_postgresql_enum(bind, "inventorymovementtype", ("ADD", "USE"))
    movement_type_enum = _enum_type(bind, "inventorymovementtype", ("ADD", "USE"))

    if "inventory_categories" not in tables:
        op.create_table(
            "inventory_categories",
            sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("name", sa.String(length=80), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=timestamp_default,
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=timestamp_default,
                nullable=False,
            ),
            sa.CheckConstraint(
                "length(trim(name)) >= 1",
                name="ck_inventory_categories_name_not_blank",
            ),
            sa.PrimaryKeyConstraint("id"),
        )
    if "ix_inventory_categories_lower_name" not in _index_names(bind, "inventory_categories"):
        op.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_inventory_categories_lower_name "
            "ON inventory_categories (lower(name))"
        )

    if "inventory_items" not in tables:
        op.create_table(
            "inventory_items",
            sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("tamil_name", sa.String(length=120), nullable=False),
            sa.Column("unit_type", unit_type_enum, nullable=False),
            sa.Column("base_unit", base_unit_enum, nullable=False),
            sa.Column("sort_order", sa.Integer(), server_default=sa.text("0"), nullable=False),
            sa.Column("image_object_key", sa.String(length=255), nullable=True),
            sa.Column("image_content_type", sa.String(length=120), nullable=True),
            sa.Column("image_thumbnail_object_key", sa.String(length=255), nullable=True),
            sa.Column("image_thumbnail_content_type", sa.String(length=120), nullable=True),
            sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=timestamp_default,
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=timestamp_default,
                nullable=False,
            ),
            sa.CheckConstraint(
                "length(trim(name)) >= 2",
                name="ck_inventory_items_name_not_blank",
            ),
            sa.CheckConstraint(
                "length(trim(tamil_name)) >= 1",
                name="ck_inventory_items_tamil_name_not_blank",
            ),
            sa.CheckConstraint(
                "(unit_type = 'WEIGHT' AND base_unit = 'KG') OR "
                "(unit_type = 'COUNT' AND base_unit = 'UNIT')",
                name="ck_inventory_items_unit_pair",
            ),
            sa.PrimaryKeyConstraint("id"),
        )
    if "ix_inventory_items_lower_name" not in _index_names(bind, "inventory_items"):
        op.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_inventory_items_lower_name "
            "ON inventory_items (lower(name))"
        )
    _create_index_if_missing(
        "inventory_items",
        "ix_inventory_items_sort_name",
        ["sort_order", "name", "id"],
    )
    _create_index_if_missing(
        "inventory_items",
        "ix_inventory_items_active_sort_name",
        ["is_active", "sort_order", "name", "id"],
    )

    if "inventory_item_categories" not in tables:
        op.create_table(
            "inventory_item_categories",
            sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("inventory_item_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("category_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=timestamp_default,
                nullable=False,
            ),
            sa.ForeignKeyConstraint(
                ["category_id"], ["inventory_categories.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["inventory_item_id"], ["inventory_items.id"], ondelete="CASCADE"
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "inventory_item_id",
                "category_id",
                name="uq_inventory_item_categories_item_category",
            ),
        )
    _create_index_if_missing(
        "inventory_item_categories",
        "ix_inventory_item_categories_category",
        ["category_id", "inventory_item_id"],
    )

    if "shop_inventory_allocations" not in tables:
        op.create_table(
            "shop_inventory_allocations",
            sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("shop_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("inventory_item_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            sa.Column("sort_order", sa.Integer(), server_default=sa.text("0"), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=timestamp_default,
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=timestamp_default,
                nullable=False,
            ),
            sa.ForeignKeyConstraint(
                ["inventory_item_id"], ["inventory_items.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "shop_id",
                "inventory_item_id",
                name="uq_shop_inventory_allocations_shop_item",
            ),
        )
    _create_index_if_missing(
        "shop_inventory_allocations",
        "ix_shop_inventory_allocations_sort",
        ["shop_id", "is_active", "sort_order", "inventory_item_id"],
    )

    if "inventory_movements" not in tables:
        op.create_table(
            "inventory_movements",
            sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("shop_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("inventory_item_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("category_id", sa.Uuid(as_uuid=True), nullable=True),
            sa.Column(
                "movement_type",
                movement_type_enum,
                nullable=False,
            ),
            sa.Column("quantity", sa.Numeric(12, 3), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=timestamp_default,
                nullable=False,
            ),
            sa.CheckConstraint(
                "quantity > 0",
                name="ck_inventory_movements_quantity_positive",
            ),
            sa.CheckConstraint(
                "movement_type != 'USE' OR category_id IS NOT NULL",
                name="ck_inventory_movements_use_category_required",
            ),
            sa.ForeignKeyConstraint(
                ["category_id"], ["inventory_categories.id"], ondelete="RESTRICT"
            ),
            sa.ForeignKeyConstraint(
                ["inventory_item_id"], ["inventory_items.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_if_missing(
        "inventory_movements",
        "ix_inventory_movements_shop_item_created",
        ["shop_id", "inventory_item_id", "created_at", "id"],
    )
    _create_index_if_missing(
        "inventory_movements",
        "ix_inventory_movements_shop_category_created",
        ["shop_id", "category_id", "created_at", "id"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    for table_name in (
        "inventory_movements",
        "shop_inventory_allocations",
        "inventory_item_categories",
        "inventory_items",
        "inventory_categories",
    ):
        if table_name in _table_names(bind):
            op.drop_table(table_name)
