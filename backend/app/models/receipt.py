from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.ids import UUID_SQL_TYPE, uuid7
from app.db.database import Base


class Receipt(Base):
    __tablename__ = "receipts"

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    bill_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("bills.id"), unique=True, nullable=False
    )
    receipt_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    printed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        nullable=False,
    )

    bill = relationship("Bill", back_populates="receipt")
