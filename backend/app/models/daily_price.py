from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Date, Enum, ForeignKey, Index, Numeric, UniqueConstraint, desc
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.ids import UUID_SQL_TYPE, uuid7
from ..db.database import Base
from .base import BaseModelMixin
from .enums import BaseUnit


class DailyPrice(Base, BaseModelMixin):
    __tablename__ = "daily_prices"
    __table_args__ = (
        UniqueConstraint("shop_id", "item_id", "price_date", name="uq_daily_price_shop_item_date"),
        Index(
            "ix_daily_prices_shop_item_latest",
            "shop_id",
            "item_id",
            desc("price_date"),
            desc("created_at"),
            desc("id"),
        ),
        Index(
            "ix_daily_prices_item_latest",
            "item_id",
            desc("price_date"),
            desc("created_at"),
            desc("id"),
        ),
        Index("ix_daily_prices_shop_date_item", "shop_id", "price_date", "item_id"),
    )

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    shop_id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, ForeignKey("shops.id"), nullable=False)
    item_id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, ForeignKey("items.id"), nullable=False)
    price_per_unit: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    unit: Mapped[BaseUnit] = mapped_column(Enum(BaseUnit), nullable=False)
    price_date: Mapped[date] = mapped_column(Date, nullable=False)

    shop = relationship("Shop", back_populates="daily_prices")
    item = relationship("Item", back_populates="daily_prices")
