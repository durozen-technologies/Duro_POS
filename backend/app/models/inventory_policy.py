from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Integer, func, text
from sqlalchemy.orm import Mapped, mapped_column

from ..db.database import Base


class InventoryBackdatePolicy(Base):
    __tablename__ = "inventory_backdate_policy"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    allow_shop_backdated_inventory: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        server_default=text("false"),
        nullable=False,
    )
    shop_backdate_window_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        server_default=func.now(),
        nullable=False,
    )
