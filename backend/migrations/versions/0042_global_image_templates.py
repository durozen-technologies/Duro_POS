"""Add global image template tables to public schema."""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0042_global_image_templates"
down_revision: str | None = "0041_receipt_status_enum"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = set(inspector.get_table_names(schema="public"))

    if "global_image_template_categories" not in existing:
        op.create_table(
            "global_image_template_categories",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("name", sa.String(length=80), nullable=False),
            sa.Column("sort_order", sa.Integer(), server_default=sa.text("0"), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=False,
            ),
            sa.CheckConstraint(
                "length(trim(name)) >= 1",
                name="ck_global_image_template_categories_name_not_blank",
            ),
            sa.PrimaryKeyConstraint("id"),
            schema="public",
        )
        op.create_index(
            "ix_global_image_template_categories_sort_name",
            "global_image_template_categories",
            ["sort_order", "name", "id"],
            unique=False,
            schema="public",
        )

    if "global_image_templates" not in existing:
        op.create_table(
            "global_image_templates",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("category_id", sa.Uuid(), nullable=True),
            sa.Column("image_object_key", sa.String(length=255), nullable=True),
            sa.Column("image_content_type", sa.String(length=120), nullable=True),
            sa.Column("image_thumbnail_object_key", sa.String(length=255), nullable=True),
            sa.Column("image_thumbnail_content_type", sa.String(length=120), nullable=True),
            sa.Column("sort_order", sa.Integer(), server_default=sa.text("0"), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=False,
            ),
            sa.CheckConstraint(
                "length(trim(name)) >= 2",
                name="ck_global_image_templates_name_not_blank",
            ),
            sa.ForeignKeyConstraint(
                ["category_id"],
                ["public.global_image_template_categories.id"],
                ondelete="SET NULL",
            ),
            sa.PrimaryKeyConstraint("id"),
            schema="public",
        )
        op.create_index(
            "ix_global_image_templates_active_sort_name",
            "global_image_templates",
            ["is_active", "sort_order", "name", "id"],
            unique=False,
            schema="public",
        )
        op.create_index(
            op.f("ix_global_image_templates_category_id"),
            "global_image_templates",
            ["category_id"],
            unique=False,
            schema="public",
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = set(inspector.get_table_names(schema="public"))
    if "global_image_templates" in existing:
        op.drop_table("global_image_templates", schema="public")
    if "global_image_template_categories" in existing:
        op.drop_table("global_image_template_categories", schema="public")
