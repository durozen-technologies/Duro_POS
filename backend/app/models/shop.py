from datetime import date
from uuid import UUID

from sqlalchemy import Boolean, Date, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.ids import UUID_SQL_TYPE, uuid7
from ..db.database import Base
from .base import BaseModelMixin


class Shop(Base, BaseModelMixin):
    __tablename__ = "shops"
    __table_args__ = (Index("ix_shops_org_active", "organization_id", "is_active"),)

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    organization_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("organizations.id", ondelete="RESTRICT"),
        index=True,
        nullable=False,
    )
    owner_user_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("users.id"),
        unique=True,
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    daily_prices_published_on: Mapped[date | None] = mapped_column(Date, nullable=True)

    organization = relationship("Organization", back_populates="shops")
    owner = relationship("User", back_populates="shop")
    items = relationship("Item", back_populates="shop")
    daily_prices = relationship("DailyPrice", back_populates="shop")
    bills = relationship("Bill", back_populates="shop")
    item_allocations = relationship(
        "ShopItemAllocation", back_populates="shop", cascade="all, delete-orphan"
    )
    inventory_allocations = relationship(
        "ShopInventoryAllocation", back_populates="shop", cascade="all, delete-orphan"
    )
    inventory_movements = relationship(
        "InventoryMovement", back_populates="shop", cascade="all, delete-orphan"
    )
    expense_allocations = relationship(
        "ShopExpenseAllocation", back_populates="shop", cascade="all, delete-orphan"
    )
    retailer_allocations = relationship(
        "ShopRetailerAllocation", back_populates="shop", cascade="all, delete-orphan"
    )
    retailer_item_allocations = relationship(
        "ShopRetailerItemAllocation", back_populates="shop", cascade="all, delete-orphan"
    )
    expense_entries = relationship(
        "ExpenseEntry", back_populates="shop", cascade="all, delete-orphan"
    )
