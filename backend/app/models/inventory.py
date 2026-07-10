from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.ids import UUID_SQL_TYPE, uuid7
from ..db.database import Base
from .base import BaseModelMixin
from .enums import BaseUnit, InventoryMovementType, UnitType


class InventoryCategory(Base, BaseModelMixin):
    __tablename__ = "inventory_categories"

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

    item_links = relationship(
        "InventoryItemCategory",
        back_populates="category",
        cascade="all, delete-orphan",
    )
    movements = relationship("InventoryMovement", back_populates="category")

    __table_args__ = (
        CheckConstraint("length(trim(name)) >= 1", name="ck_inventory_categories_name_not_blank"),
        Index(
            "ix_inventory_categories_org_lower_name",
            "organization_id",
            func.lower(name),
            unique=True,
        ),
    )


class InventoryItem(Base, BaseModelMixin):
    __tablename__ = "inventory_items"

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    organization_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    tamil_name: Mapped[str] = mapped_column(String(120), nullable=False)
    unit_type: Mapped[UnitType] = mapped_column(Enum(UnitType), nullable=False)
    base_unit: Mapped[BaseUnit] = mapped_column(Enum(BaseUnit), nullable=False)
    sort_order: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    image_object_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    image_content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    image_thumbnail_object_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    image_thumbnail_content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )
    purchase_rate: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), default=Decimal("0.00"), server_default=text("0.00"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        server_default=text("CURRENT_TIMESTAMP"),
        nullable=False,
    )

    category_links = relationship(
        "InventoryItemCategory",
        back_populates="item",
        cascade="all, delete-orphan",
    )
    shop_allocations = relationship(
        "ShopInventoryAllocation",
        back_populates="item",
        cascade="all, delete-orphan",
    )
    movements = relationship("InventoryMovement", back_populates="item")
    billing_mappings = relationship(
        "InventoryItemBillingMapping",
        back_populates="inventory_item",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        CheckConstraint("length(trim(name)) >= 2", name="ck_inventory_items_name_not_blank"),
        CheckConstraint(
            "length(trim(tamil_name)) >= 1", name="ck_inventory_items_tamil_name_not_blank"
        ),
        CheckConstraint(
            "(unit_type = 'WEIGHT' AND base_unit = 'KG') OR "
            "(unit_type = 'COUNT' AND base_unit = 'UNIT')",
            name="ck_inventory_items_unit_pair",
        ),
        Index("ix_inventory_items_sort_name", "sort_order", "name", "id"),
        Index("ix_inventory_items_sort_lower_name", "sort_order", func.lower(name), "id"),
        Index(
            "ix_inventory_items_active_sort_name",
            "is_active",
            "sort_order",
            "name",
            "id",
        ),
        Index(
            "ix_inventory_items_active_sort_lower_name",
            "is_active",
            "sort_order",
            func.lower(name),
            "id",
        ),
        Index("ix_inventory_items_lower_name", func.lower(name), unique=True),
    )


class InventoryItemCategory(Base, BaseModelMixin):
    __tablename__ = "inventory_item_categories"
    __table_args__ = (
        UniqueConstraint(
            "inventory_item_id",
            "category_id",
            name="uq_inventory_item_categories_item_category",
        ),
        Index("ix_inventory_item_categories_category", "category_id", "inventory_item_id"),
    )

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    inventory_item_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("inventory_items.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    category_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("inventory_categories.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )

    item = relationship("InventoryItem", back_populates="category_links")
    category = relationship("InventoryCategory", back_populates="item_links")


class InventoryItemBillingMapping(Base, BaseModelMixin):
    __tablename__ = "inventory_item_billing_mappings"
    __table_args__ = (
        UniqueConstraint(
            "billing_item_id",
            name="uq_inventory_item_billing_map_billing",
        ),
        Index(
            "ux_inventory_item_billing_map_item_category",
            "inventory_item_id",
            "inventory_category_id",
            unique=True,
            postgresql_where=text("inventory_category_id IS NOT NULL"),
            sqlite_where=text("inventory_category_id IS NOT NULL"),
        ),
        Index(
            "ux_inventory_item_billing_map_item_uncategorized",
            "inventory_item_id",
            unique=True,
            postgresql_where=text("inventory_category_id IS NULL"),
            sqlite_where=text("inventory_category_id IS NULL"),
        ),
        Index(
            "ix_inventory_item_billing_mappings_billing_item",
            "billing_item_id",
            "inventory_item_id",
        ),
    )

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    inventory_item_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("inventory_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    inventory_category_id: Mapped[UUID | None] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("inventory_categories.id", ondelete="CASCADE"),
        nullable=True,
    )
    billing_item_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("items.id", ondelete="CASCADE"),
        nullable=False,
    )

    inventory_item = relationship("InventoryItem", back_populates="billing_mappings")
    inventory_category = relationship("InventoryCategory", foreign_keys=[inventory_category_id])
    billing_item = relationship("Item", foreign_keys=[billing_item_id])


class ShopInventoryAllocation(Base, BaseModelMixin):
    __tablename__ = "shop_inventory_allocations"
    __table_args__ = (
        UniqueConstraint(
            "shop_id",
            "inventory_item_id",
            name="uq_shop_inventory_allocations_shop_item",
        ),
        Index(
            "ix_shop_inventory_allocations_sort",
            "shop_id",
            "is_active",
            "sort_order",
            "inventory_item_id",
        ),
    )

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    shop_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("shops.id", ondelete="CASCADE"), index=True, nullable=False
    )
    inventory_item_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("inventory_items.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )
    sort_order: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        server_default=text("CURRENT_TIMESTAMP"),
        nullable=False,
    )

    shop = relationship("Shop", back_populates="inventory_allocations")
    item = relationship("InventoryItem", back_populates="shop_allocations")


class InventoryMovement(Base, BaseModelMixin):
    __tablename__ = "inventory_movements"
    __table_args__ = (
        Index(
            "ix_inventory_movements_shop_item_created",
            "shop_id",
            "inventory_item_id",
            "created_at",
            "id",
        ),
        Index(
            "ix_inventory_movements_shop_category_created",
            "shop_id",
            "category_id",
            "created_at",
            "id",
        ),
        Index(
            "ix_inventory_movements_shop_item_type",
            "shop_id",
            "inventory_item_id",
            "movement_type",
        ),
        Index(
            "ix_inventory_movements_shop_item_category_created",
            "shop_id",
            "inventory_item_id",
            "category_id",
            "created_at",
            "id",
        ),
        Index(
            "ix_inventory_movements_shop_item_occurred",
            "shop_id",
            "inventory_item_id",
            "occurred_at",
            "id",
        ),
        Index(
            "ix_inventory_movements_shop_category_occurred",
            "shop_id",
            "category_id",
            "occurred_at",
            "id",
        ),
        Index(
            "ix_inventory_movements_shop_item_category_occurred",
            "shop_id",
            "inventory_item_id",
            "category_id",
            "occurred_at",
            "id",
        ),
        Index(
            "ix_inventory_movements_shop_category_type",
            "shop_id",
            "category_id",
            "movement_type",
        ),
    )

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    shop_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("shops.id", ondelete="CASCADE"), index=True, nullable=False
    )
    inventory_item_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("inventory_items.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    category_id: Mapped[UUID | None] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("inventory_categories.id", ondelete="RESTRICT"),
        index=True,
        nullable=True,
    )
    movement_type: Mapped[InventoryMovementType] = mapped_column(
        Enum(InventoryMovementType), nullable=False
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    bird_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        nullable=False,
    )
    driver_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    vehicle_number: Mapped[str | None] = mapped_column(String(120), nullable=True)

    shop = relationship("Shop", back_populates="inventory_movements")
    item = relationship("InventoryItem", back_populates="movements")
    category = relationship("InventoryCategory", back_populates="movements")
    splits = relationship(
        "InventoryMovementSplit", back_populates="movement", cascade="all, delete-orphan"
    )


class InventoryMovementSplit(Base, BaseModelMixin):
    __tablename__ = "inventory_movement_splits"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_inventory_movement_splits_quantity_positive"),
    )

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    movement_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("inventory_movements.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    category_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("inventory_categories.id", ondelete="RESTRICT"),
        index=True,
        nullable=False,
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    bird_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))

    movement = relationship("InventoryMovement", back_populates="splits")
    category = relationship("InventoryCategory")


class InventoryItemPurchaseRateHistory(Base, BaseModelMixin):
    __tablename__ = "inventory_item_purchase_rate_history"
    __table_args__ = (
        UniqueConstraint(
            "inventory_item_id",
            "date",
            name="uq_inventory_item_purchase_rate_history_item_date",
        ),
        Index("ix_inventory_item_purchase_rate_history_date", "date"),
    )

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    inventory_item_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("inventory_items.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    purchase_rate: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        server_default=text("CURRENT_TIMESTAMP"),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        server_default=text("CURRENT_TIMESTAMP"),
        nullable=False,
    )

    item = relationship("InventoryItem")
