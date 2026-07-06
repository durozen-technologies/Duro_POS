from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.ids import UUID_SQL_TYPE, uuid7
from ..db.database import Base
from .base import BaseModelMixin


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
