from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import DateTime, Enum as SqlEnum, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.ids import UUID_SQL_TYPE, uuid7
from ..db.database import Base
from .enums import ReceiptStatus


class Receipt(Base):
    __tablename__ = "receipts"
    __table_args__ = (Index("ix_receipts_receipt_status", "receipt_status"),)

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    bill_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("bills.id"), unique=True, nullable=False
    )
    receipt_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    receipt_status: Mapped[ReceiptStatus] = mapped_column(
        SqlEnum(
            ReceiptStatus,
            name="receiptstatus",
            schema="public",
            create_type=False,
            values_callable=lambda enum: [member.value for member in enum],
        ),
        nullable=False,
        default=ReceiptStatus.PENDING,
        server_default=ReceiptStatus.PENDING.value,
    )
    print_attempts: Mapped[int] = mapped_column(nullable=False, default=0, server_default="0")
    last_print_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    printed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    bill = relationship("Bill", back_populates="receipt")
