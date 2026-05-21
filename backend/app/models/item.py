from uuid import UUID

from sqlalchemy import Boolean, Enum, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.ids import UUID_SQL_TYPE, uuid7
from app.db.database import Base
from app.models.enums import BaseUnit, UnitType


class Item(Base):
    __tablename__ = "items"

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    unit_type: Mapped[UnitType] = mapped_column(Enum(UnitType), nullable=False)
    base_unit: Mapped[BaseUnit] = mapped_column(Enum(BaseUnit), nullable=False)
    image_data: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    image_object_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    image_content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    daily_prices = relationship("DailyPrice", back_populates="item")
    bill_items = relationship("BillItem", back_populates="item")
