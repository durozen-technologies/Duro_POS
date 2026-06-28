from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
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
from .enums import BaseUnit


class TransferShop(Base, BaseModelMixin):
    __tablename__ = "transfer_shops"

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    tamil_name: Mapped[str] = mapped_column(String(120), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        server_default=text("CURRENT_TIMESTAMP"),
        nullable=False,
    )

    __table_args__ = (
        CheckConstraint("length(trim(name)) >= 2", name="ck_transfer_shops_name_not_blank"),
        CheckConstraint(
            "length(trim(tamil_name)) >= 1", name="ck_transfer_shops_tamil_name_not_blank"
        ),
    )


class InventoryTransfer(Base, BaseModelMixin):
    __tablename__ = "inventory_transfers"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_inventory_transfers_quantity_positive"),
        Index(
            "ix_inventory_transfers_shop_item_created",
            "source_shop_id",
            "inventory_item_id",
            "created_at",
            "id",
        ),
        Index(
            "ix_inventory_transfers_transfer_shop_created",
            "transfer_shop_id",
            "created_at",
            "id",
        ),
        Index(
            "ix_inventory_transfers_shop_item_occurred",
            "source_shop_id",
            "inventory_item_id",
            "occurred_at",
            "id",
        ),
    )

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    source_shop_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("shops.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    transfer_shop_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("transfer_shops.id", ondelete="RESTRICT"),
        index=True,
        nullable=False,
    )
    inventory_item_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("inventory_items.id", ondelete="RESTRICT"),
        index=True,
        nullable=False,
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        nullable=False,
    )
    unit: Mapped[BaseUnit] = mapped_column(Enum(BaseUnit), nullable=False)

    source_shop = relationship("Shop", foreign_keys=[source_shop_id])
    transfer_shop = relationship("TransferShop")
    inventory_item = relationship("InventoryItem")
