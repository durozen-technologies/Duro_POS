from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.ids import UUID_SQL_TYPE, uuid7
from ..db.database import Base
from .base import BaseModelMixin


class ExpenseItem(Base, BaseModelMixin):
    __tablename__ = "expense_items"

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    organization_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    tamil_name: Mapped[str] = mapped_column(String(120), nullable=False)
    sort_order: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )
    image_object_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    image_content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    image_thumbnail_object_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    image_thumbnail_content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    global_image_template_id: Mapped[UUID | None] = mapped_column(
        UUID_SQL_TYPE,
        index=True,
        nullable=True,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        server_default=func.now(),
        nullable=False,
    )

    shop_allocations = relationship(
        "ShopExpenseAllocation", back_populates="expense_item", cascade="all, delete-orphan"
    )
    entries = relationship("ExpenseEntry", back_populates="expense_item")

    __table_args__ = (
        CheckConstraint("length(trim(name)) >= 2", name="ck_expense_items_name_not_blank"),
        CheckConstraint(
            "length(trim(tamil_name)) >= 1", name="ck_expense_items_tamil_name_not_blank"
        ),
        Index("ix_expense_items_sort_name", "sort_order", "name", "id"),
        Index("ix_expense_items_active_sort_name", "is_active", "sort_order", "name", "id"),
        Index("ix_expense_items_lower_name", func.lower(name), unique=True),
    )


class ShopExpenseAllocation(Base, BaseModelMixin):
    __tablename__ = "shop_expense_allocations"

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    shop_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("shops.id", ondelete="CASCADE"), index=True, nullable=False
    )
    expense_item_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("expense_items.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )
    sort_order: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        server_default=func.now(),
        nullable=False,
    )

    shop = relationship("Shop", back_populates="expense_allocations")
    expense_item = relationship("ExpenseItem", back_populates="shop_allocations")

    __table_args__ = (
        UniqueConstraint(
            "shop_id",
            "expense_item_id",
            name="uq_shop_expense_allocations_shop_item",
        ),
        Index(
            "ix_shop_expense_allocations_sort",
            "shop_id",
            "is_active",
            "sort_order",
            "expense_item_id",
        ),
        Index(
            "ix_shop_expense_allocations_shop_sort_item",
            "shop_id",
            "sort_order",
            "expense_item_id",
        ),
    )


class ExpenseEntry(Base, BaseModelMixin):
    __tablename__ = "expense_entries"

    id: Mapped[UUID] = mapped_column(UUID_SQL_TYPE, primary_key=True, index=True, default=uuid7)
    shop_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE, ForeignKey("shops.id", ondelete="CASCADE"), index=True, nullable=False
    )
    expense_item_id: Mapped[UUID] = mapped_column(
        UUID_SQL_TYPE,
        ForeignKey("expense_items.id", ondelete="RESTRICT"),
        index=True,
        nullable=False,
    )
    expense_name: Mapped[str] = mapped_column(String(120), nullable=False)
    expense_tamil_name: Mapped[str] = mapped_column(String(120), nullable=False)
    cash_amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0.00"), server_default=text("0")
    )
    upi_amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0.00"), server_default=text("0")
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    spent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        nullable=False,
    )
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)

    shop = relationship("Shop", back_populates="expense_entries")
    expense_item = relationship("ExpenseItem", back_populates="entries")

    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_expense_entries_amount_positive"),
        CheckConstraint("cash_amount >= 0", name="ck_expense_entries_cash_non_negative"),
        CheckConstraint("upi_amount >= 0", name="ck_expense_entries_upi_non_negative"),
        CheckConstraint(
            "(cash_amount + upi_amount) > 0",
            name="ck_expense_entries_split_positive",
        ),
        CheckConstraint(
            "length(trim(expense_name)) >= 2", name="ck_expense_entries_name_not_blank"
        ),
        CheckConstraint(
            "length(trim(expense_tamil_name)) >= 1",
            name="ck_expense_entries_tamil_name_not_blank",
        ),
        Index("ix_expense_entries_shop_spent", "shop_id", "spent_at", "id"),
        Index("ix_expense_entries_spent", "spent_at", "id"),
        Index("ix_expense_entries_item_spent", "expense_item_id", "spent_at", "id"),
    )
