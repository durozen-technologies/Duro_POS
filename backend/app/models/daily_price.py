from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Date, Enum, ForeignKey, Numeric, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.ids import UUID_SQL_TYPE, uuid7
from app.db.database import Base
from app.models.base import BaseModelMixin
from app.models.enums import BaseUnit


class DailyPrice(Base, BaseModelMixin):
    __tablename__ = "daily_prices"
    __table_args__ = (
        UniqueConstraint("shop_id", "item_id", "price_date", name="uq_daily_price_shop_item_date"),
    )

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    shop_id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, ForeignKey("shops.id"), nullable=False)
    item_id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, ForeignKey("items.id"), nullable=False)
    price_per_unit: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    unit: Mapped[BaseUnit] = mapped_column(Enum(BaseUnit), nullable=False)
    price_date: Mapped[date] = mapped_column(Date, nullable=False)

    shop = relationship("Shop", back_populates="daily_prices")
    item = relationship("Item", back_populates="daily_prices")
