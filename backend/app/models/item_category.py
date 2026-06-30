from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.ids import UUID_SQL_TYPE, uuid7
from ..db.database import Base
from .base import BaseModelMixin


class ItemCategory(Base, BaseModelMixin):
    __tablename__ = "item_categories"

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    organization_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        server_default=text("CURRENT_TIMESTAMP"),
        nullable=False,
    )

    items = relationship("Item", back_populates="category_ref")

    __table_args__ = (
        CheckConstraint("length(trim(name)) >= 1", name="ck_item_categories_name_not_blank"),
        Index(
            "ix_item_categories_org_lower_name",
            "organization_id",
            func.lower(name),
            unique=True,
        ),
    )
