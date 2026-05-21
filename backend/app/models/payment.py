from decimal import Decimal
from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, Numeric
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.ids import UUID_SQL_TYPE, uuid7
from app.db.database import Base


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    bill_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("bills.id"), unique=True, nullable=False
    )
    cash_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    upi_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    total_paid: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    balance: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    is_settled: Mapped[bool] = mapped_column(Boolean, nullable=False)

    bill = relationship("Bill", back_populates="payment")
