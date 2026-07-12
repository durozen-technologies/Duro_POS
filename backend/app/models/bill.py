from decimal import Decimal
from uuid import UUID

from sqlalchemy import Enum as SqlEnum
from sqlalchemy import ForeignKey, Index, Numeric, String, desc
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.ids import UUID_SQL_TYPE, uuid7
from ..db.database import Base
from .base import BaseModelMixin
from .enums import BaseUnit, BillStatus, UnitType


class Bill(Base, BaseModelMixin):
    __tablename__ = "bills"
    __table_args__ = (
        Index("ix_bills_created_at_id_desc", desc("created_at"), desc("id")),
        Index("ix_bills_shop_id_created_at_id_desc", "shop_id", desc("created_at"), desc("id")),
        Index("ix_bills_created_at_total_amount_desc", desc("created_at"), desc("total_amount")),
    )

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    bill_no: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    shop_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("shops.id"), index=True, nullable=False
    )
    checkout_token: Mapped[str | None] = mapped_column(
        String(512), unique=True, index=True, nullable=True
    )
    created_by_user_id: Mapped[UUID | None] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("users.id"), index=True, nullable=True
    )
    item_count: Mapped[int] = mapped_column(nullable=False, default=0, server_default="0")
    total_quantity: Mapped[Decimal] = mapped_column(
        Numeric(10, 3), nullable=False, default=Decimal("0"), server_default="0"
    )
    total_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    status: Mapped[BillStatus] = mapped_column(
        SqlEnum(
            BillStatus,
            name="billstatus",
            values_callable=lambda enum: [member.name for member in enum],
        ),
        nullable=False,
    )

    shop = relationship("Shop", back_populates="bills")
    items = relationship("BillItem", back_populates="bill", cascade="all, delete-orphan")
    payment = relationship(
        "Payment", back_populates="bill", uselist=False, cascade="all, delete-orphan"
    )
    receipt = relationship(
        "Receipt", back_populates="bill", uselist=False, cascade="all, delete-orphan"
    )


class BillItem(Base):
    __tablename__ = "bill_items"

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    bill_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("bills.id"), index=True, nullable=False
    )
    item_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("items.id"), index=True, nullable=False
    )
    item_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    item_tamil_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    item_unit_type: Mapped[UnitType | None] = mapped_column(SqlEnum(UnitType), nullable=True)
    item_base_unit: Mapped[BaseUnit | None] = mapped_column(SqlEnum(BaseUnit), nullable=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(10, 3), nullable=False)
    unit: Mapped[BaseUnit] = mapped_column(SqlEnum(BaseUnit), nullable=False)
    price_per_unit: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)

    bill = relationship("Bill", back_populates="items")
    item = relationship("Item", back_populates="bill_items")


class MonthlyBillSequence(Base):
    __tablename__ = "monthly_bill_sequences"

    month_year: Mapped[str] = mapped_column(String(7), primary_key=True)
    current_value: Mapped[int] = mapped_column(nullable=False, default=0)
