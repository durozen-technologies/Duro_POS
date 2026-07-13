from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.ids import UUID_SQL_TYPE, uuid7
from ..db.database import Base
from .base import BaseModelMixin


class GlobalImageTemplateCategory(Base, BaseModelMixin):
    __tablename__ = "global_image_template_categories"
    __table_args__ = (
        CheckConstraint(
            "length(trim(name)) >= 1",
            name="ck_global_image_template_categories_name_not_blank",
        ),
        Index("ix_global_image_template_categories_sort_name", "sort_order", "name", "id"),
    )

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    sort_order: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        server_default=text("CURRENT_TIMESTAMP"),
        nullable=False,
    )

    templates = relationship("GlobalImageTemplate", back_populates="category_ref")


class GlobalImageTemplate(Base, BaseModelMixin):
    __tablename__ = "global_image_templates"
    __table_args__ = (
        CheckConstraint(
            "length(trim(name)) >= 2",
            name="ck_global_image_templates_name_not_blank",
        ),
        Index("ix_global_image_templates_active_sort_name", "is_active", "sort_order", "name", "id"),
    )

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    category_id: Mapped[UUID | None] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("global_image_template_categories.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    image_object_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    image_content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    image_thumbnail_object_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    image_thumbnail_content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    sort_order: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        server_default=text("CURRENT_TIMESTAMP"),
        nullable=False,
    )

    category_ref = relationship("GlobalImageTemplateCategory", back_populates="templates")
