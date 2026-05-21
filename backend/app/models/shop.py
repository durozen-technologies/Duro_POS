from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.ids import UUID_SQL_TYPE, uuid7
from app.db.database import Base
from app.models.base import BaseModelMixin


class Shop(Base, BaseModelMixin):
    __tablename__ = "shops"

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    owner_user_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("users.id"),
        unique=True,
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    owner = relationship("User", back_populates="shop")
    daily_prices = relationship("DailyPrice", back_populates="shop")
    bills = relationship("Bill", back_populates="shop")
