from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Numeric,
    String,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.ids import UUID_SQL_TYPE, uuid7
from ..db.database import Base
from .base import BaseModelMixin
from .enums import RetailerInventoryPurchaseStatus


class RetailerInventoryUsage(Base, BaseModelMixin):
    __tablename__ = "retailer_inventory_usages"
    __table_args__ = (
        Index(
            "ix_retailer_inventory_usages_shop_item_occurred",
            "shop_id",
            "inventory_item_id",
            "occurred_at",
            "id",
        ),
        Index(
            "ix_retailer_inventory_usages_retailer_occurred",
            "retailer_id",
            "occurred_at",
            "id",
        ),
        Index(
            "ix_retailer_inventory_usages_shop_occurred",
            "shop_id",
            "occurred_at",
            "id",
        ),
        Index(
            "ix_retailer_inventory_usages_shop_item_category_occurred",
            "shop_id",
            "inventory_item_id",
            "category_id",
            "occurred_at",
            "id",
        ),
    )

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    shop_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("shops.id", ondelete="CASCADE"), index=True, nullable=False
    )
    retailer_id: Mapped[UUID | None] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("retailers.id", ondelete="RESTRICT"), index=True, nullable=True
    )
    inventory_item_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("inventory_items.id", ondelete="RESTRICT"),
        index=True,
        nullable=False,
    )
    category_id: Mapped[UUID | None] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("inventory_categories.id", ondelete="RESTRICT"),
        index=True,
        nullable=True,
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        nullable=False,
    )
    created_by_user_id: Mapped[UUID | None] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    adjustment_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)

    shop = relationship("Shop")
    retailer = relationship("Retailer")
    item = relationship("InventoryItem")
    category = relationship("InventoryCategory")
    created_by = relationship("User", foreign_keys=[created_by_user_id])


class RetailerInventoryPurchase(Base, BaseModelMixin):
    __tablename__ = "retailer_inventory_purchases"
    __table_args__ = (
        Index(
            "ix_retailer_inventory_purchases_shop_retailer_created",
            "shop_id",
            "retailer_id",
            "created_at",
            "id",
        ),
        Index(
            "ix_retailer_inventory_purchases_retailer_status",
            "retailer_id",
            "status",
        ),
    )

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    shop_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("shops.id", ondelete="CASCADE"), index=True, nullable=False
    )
    retailer_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("retailers.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    total_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    amount_applied_to_outstanding: Mapped[Decimal] = mapped_column(
        Numeric(10, 2),
        nullable=False,
        server_default=text("0.00"),
    )
    amount_deposited_to_wallet: Mapped[Decimal] = mapped_column(
        Numeric(10, 2),
        nullable=False,
        server_default=text("0.00"),
    )
    status: Mapped[RetailerInventoryPurchaseStatus] = mapped_column(
        Enum(
            RetailerInventoryPurchaseStatus,
            name="retailerinventorypurchasestatus",
            values_callable=lambda enum: [member.value for member in enum],
        ),
        nullable=False,
        server_default=text("'active'"),
    )
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_user_id: Mapped[UUID | None] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    voided_by_user_id: Mapped[UUID | None] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )

    shop = relationship("Shop")
    retailer = relationship("Retailer")
    created_by = relationship("User", foreign_keys=[created_by_user_id])
    voided_by = relationship("User", foreign_keys=[voided_by_user_id])
    lines = relationship(
        "RetailerInventoryPurchaseLine",
        back_populates="purchase",
        cascade="all, delete-orphan",
    )


class RetailerInventoryPurchaseLine(Base):
    __tablename__ = "retailer_inventory_purchase_lines"

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    purchase_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("retailer_inventory_purchases.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    inventory_item_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("inventory_items.id", ondelete="RESTRICT"),
        index=True,
        nullable=False,
    )
    inventory_movement_id: Mapped[UUID | None] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("inventory_movements.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    item_name: Mapped[str] = mapped_column(String(120), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    price_per_unit: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)

    purchase = relationship("RetailerInventoryPurchase", back_populates="lines")
    item = relationship("InventoryItem")
    inventory_movement = relationship("InventoryMovement")
