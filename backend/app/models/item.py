from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    text,
)
from sqlalchemy.ext.mutable import MutableDict
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.ids import UUID_SQL_TYPE, uuid7
from ..db.database import Base
from .base import BaseModelMixin
from .enums import BaseUnit, UnitType


class Item(Base, BaseModelMixin):
    __tablename__ = "items"
    __table_args__ = (
        CheckConstraint("length(trim(name)) >= 2", name="ck_items_name_not_blank"),
        CheckConstraint("length(trim(tamil_name)) >= 1", name="ck_items_tamil_name_not_blank"),
        CheckConstraint(
            "(unit_type = 'WEIGHT' AND base_unit = 'KG') OR "
            "(unit_type = 'COUNT' AND base_unit = 'UNIT')",
            name="ck_items_unit_pair",
        ),
        Index("ix_items_sort_name", "sort_order", "name", "id"),
        Index(
            "ix_items_global_active_import_sort",
            "shop_id",
            "is_active",
            "sort_order",
            "name",
            "id",
        ),
        Index("ix_items_shop_sort_name_id", "shop_id", "sort_order", "name", "id"),
    )

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    shop_id: Mapped[UUID | None] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("shops.id", ondelete="CASCADE"), index=True, nullable=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    tamil_name: Mapped[str] = mapped_column(String(120), nullable=False)
    unit_type: Mapped[UnitType] = mapped_column(Enum(UnitType), nullable=False)
    base_unit: Mapped[BaseUnit] = mapped_column(Enum(BaseUnit), nullable=False)
    sort_order: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    category: Mapped[str | None] = mapped_column(String(80), nullable=True)
    category_id: Mapped[UUID | None] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("item_categories.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    image_object_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    image_content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    image_thumbnail_object_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    image_thumbnail_content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    custom_attributes: Mapped[dict[str, object | None]] = mapped_column(
        MutableDict.as_mutable(JSON),
        default=dict,
        server_default=text("'{}'"),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        server_default=text("CURRENT_TIMESTAMP"),
        nullable=False,
    )

    daily_prices = relationship("DailyPrice", back_populates="item")
    bill_items = relationship("BillItem", back_populates="item")
    shop = relationship("Shop", back_populates="items")
    category_ref = relationship("ItemCategory", back_populates="items")
    shop_allocations = relationship(
        "ShopItemAllocation", back_populates="item", cascade="all, delete-orphan"
    )
