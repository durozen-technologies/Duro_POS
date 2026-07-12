from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    UniqueConstraint,
    desc,
    func,
    text,
)
from sqlalchemy import (
    Enum as SqlEnum,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.ids import UUID_SQL_TYPE, uuid7
from ..db.database import Base
from .base import BaseModelMixin
from .enums import BaseUnit, RetailerReceiptType, RetailerSaleStatus, UnitType


class Retailer(Base, BaseModelMixin):
    __tablename__ = "retailers"

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    shop_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    alternate_phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )
    credit_balance: Mapped[Decimal] = mapped_column(
        Numeric(10, 2),
        nullable=False,
        server_default=text("0.00"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        server_default=func.now(),
        nullable=False,
    )

    item_prices = relationship(
        "RetailerItemPrice", back_populates="retailer", cascade="all, delete-orphan"
    )
    shop_allocations = relationship(
        "ShopRetailerAllocation", back_populates="retailer", cascade="all, delete-orphan"
    )
    sales = relationship("RetailerSale", back_populates="retailer")


class ShopRetailerAllocation(Base, BaseModelMixin):
    __tablename__ = "shop_retailer_allocations"
    __table_args__ = (
        UniqueConstraint(
            "shop_id",
            "retailer_id",
            name="uq_shop_retailer_allocations_shop_retailer",
        ),
        Index("ix_shop_retailer_allocations_retailer", "retailer_id", "is_active", "shop_id"),
        Index("ix_shop_retailer_allocations_shop", "shop_id", "is_active", "retailer_id"),
    )

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    shop_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("shops.id", ondelete="CASCADE"), index=True, nullable=False
    )
    retailer_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("retailers.id", ondelete="CASCADE"), index=True, nullable=False
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        server_default=func.now(),
        nullable=False,
    )

    shop = relationship("Shop", back_populates="retailer_allocations")
    retailer = relationship("Retailer", back_populates="shop_allocations")


class ShopRetailerItemAllocation(Base, BaseModelMixin):
    __tablename__ = "shop_retailer_item_allocations"
    __table_args__ = (
        UniqueConstraint(
            "shop_id",
            "item_id",
            name="uq_shop_retailer_item_allocations_shop_item",
        ),
        Index("ix_shop_retailer_item_allocations_shop", "shop_id", "is_active", "item_id"),
    )

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    shop_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("shops.id", ondelete="CASCADE"), index=True, nullable=False
    )
    item_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("items.id", ondelete="CASCADE"), index=True, nullable=False
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        server_default=func.now(),
        nullable=False,
    )

    shop = relationship("Shop", back_populates="retailer_item_allocations")
    item = relationship("Item")


class RetailerItemPrice(Base):
    __tablename__ = "retailer_item_prices"
    __table_args__ = (
        UniqueConstraint(
            "retailer_id",
            "shop_id",
            "item_id",
            "effective_date",
            name="uq_retailer_item_prices_daily",
        ),
        Index(
            "ix_retailer_item_prices_shop_retailer",
            "shop_id",
            "retailer_id",
            "is_active",
        ),
        Index(
            "ix_retailer_item_prices_date",
            "retailer_id",
            "shop_id",
            "effective_date",
        ),
    )

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    retailer_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("retailers.id", ondelete="CASCADE"), index=True, nullable=False
    )
    shop_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("shops.id", ondelete="CASCADE"), index=True, nullable=False
    )
    item_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("items.id", ondelete="CASCADE"), index=True, nullable=False
    )
    effective_date: Mapped[date] = mapped_column(
        Date, nullable=False, server_default=func.current_date()
    )
    price_per_unit: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )

    retailer = relationship("Retailer", back_populates="item_prices")
    shop = relationship("Shop")
    item = relationship("Item")


class RetailerSale(Base, BaseModelMixin):
    __tablename__ = "retailer_sales"
    __table_args__ = (
        Index("ix_retailer_sales_shop_id_created_at", "shop_id", desc("created_at")),
        Index("ix_retailer_sales_retailer_id_created_at", "retailer_id", desc("created_at")),
        Index("ix_retailer_sales_retailer_id_status", "retailer_id", "status"),
    )

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    sale_no: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    retailer_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("retailers.id"), index=True, nullable=False
    )
    shop_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("shops.id"), index=True, nullable=False
    )
    retailer_name: Mapped[str] = mapped_column(String(120), nullable=False, server_default=text("''"))
    shop_name: Mapped[str] = mapped_column(String(120), nullable=False, server_default=text("''"))
    total_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    amount_paid_total: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    balance_due: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    status: Mapped[RetailerSaleStatus] = mapped_column(
        SqlEnum(
            RetailerSaleStatus,
            name="retailersalestatus",
            values_callable=lambda enum: [member.value for member in enum],
        ),
        nullable=False,
    )
    created_by_user_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("users.id"), index=True, nullable=False
    )

    retailer = relationship("Retailer", back_populates="sales")
    shop = relationship("Shop")
    created_by = relationship("User")
    items = relationship("RetailerSaleItem", back_populates="sale", cascade="all, delete-orphan")
    payments = relationship("RetailerPayment", back_populates="sale", cascade="all, delete-orphan")
    receipts = relationship(
        "RetailerSaleReceipt",
        back_populates="sale",
        cascade="all, delete-orphan",
        order_by="RetailerSaleReceipt.printed_at",
    )


class RetailerSaleItem(Base):
    __tablename__ = "retailer_sale_items"

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    retailer_sale_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("retailer_sales.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
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

    sale = relationship("RetailerSale", back_populates="items")
    item = relationship("Item")


class RetailerPayment(Base):
    __tablename__ = "retailer_payments"

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    retailer_sale_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("retailer_sales.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    cash_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    upi_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    wallet_amount: Mapped[Decimal] = mapped_column(
        Numeric(10, 2),
        nullable=False,
        server_default=text("0.00"),
    )
    total_paid: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    paid_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        nullable=False,
    )
    recorded_by_user_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("users.id"), index=True, nullable=False
    )
    retailer_inventory_purchase_id: Mapped[UUID | None] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("retailer_inventory_purchases.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )

    sale = relationship("RetailerSale", back_populates="payments")
    recorded_by = relationship("User")
    receipt = relationship(
        "RetailerSaleReceipt",
        back_populates="payment",
        uselist=False,
        cascade="all, delete-orphan",
    )


class RetailerSaleReceipt(Base):
    __tablename__ = "retailer_sale_receipts"
    __table_args__ = (
        Index("ix_retailer_sale_receipts_sale_id_printed_at", "retailer_sale_id", "printed_at"),
        UniqueConstraint("retailer_payment_id", name="uq_retailer_sale_receipts_payment_id"),
    )

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    retailer_sale_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("retailer_sales.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    retailer_payment_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("retailer_payments.id", ondelete="CASCADE"),
        nullable=False,
    )
    receipt_type: Mapped[RetailerReceiptType] = mapped_column(
        SqlEnum(
            RetailerReceiptType,
            name="retailerreceipttype",
            values_callable=lambda enum: [member.value for member in enum],
        ),
        nullable=False,
    )
    receipt_number: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    printed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        nullable=False,
    )
    opening_balance: Mapped[Decimal] = mapped_column(
        Numeric(10, 2),
        nullable=False,
        server_default=text("0.00"),
    )

    sale = relationship("RetailerSale", back_populates="receipts")
    payment = relationship("RetailerPayment", back_populates="receipt")


class RetailerWalletPayout(Base, BaseModelMixin):
    __tablename__ = "retailer_wallet_payouts"
    __table_args__ = (
        Index(
            "ix_retailer_wallet_payouts_retailer_id_created_at",
            "retailer_id",
            desc("created_at"),
        ),
    )

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    retailer_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("retailers.id", ondelete="CASCADE"), index=True, nullable=False
    )
    cash_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    upi_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    total_paid: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    credit_balance_before: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    credit_balance_after: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    recorded_by_user_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("users.id"), index=True, nullable=False
    )

    retailer = relationship("Retailer")
    recorded_by = relationship("User")


class MonthlyRetailerSaleSequence(Base):
    __tablename__ = "monthly_retailer_sale_sequences"

    month_year: Mapped[str] = mapped_column(String(7), primary_key=True)
    current_value: Mapped[int] = mapped_column(nullable=False, default=0)
