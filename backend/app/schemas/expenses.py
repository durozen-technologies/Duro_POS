from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from .common import ORMModel


class ExpenseItemCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    tamil_name: str = Field(min_length=1, max_length=120)
    sort_order: int = 0
    is_active: bool = True


class ExpenseItemUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    tamil_name: str = Field(min_length=1, max_length=120)
    sort_order: int = 0
    is_active: bool = True


class ExpenseItemRead(ORMModel):
    id: UUID
    name: str
    tamil_name: str
    sort_order: int = 0
    is_active: bool
    image_path: str | None = None
    image_thumb_path: str | None = None
    image_content_type: str | None = None
    created_at: datetime
    updated_at: datetime | None = None
    allocated_shop_count: int = 0
    entry_count: int = 0
    can_delete: bool = False


class ExpenseItemImageRead(BaseModel):
    expense_item_id: UUID
    expense_item_name: str
    expense_item_tamil_name: str | None = None
    image_path: str | None = None
    image_thumb_path: str | None = None
    image_content_type: str | None = None


class ShopExpenseItemRead(ExpenseItemRead):
    allocated: bool = False
    allocation_id: UUID | None = None
    allocation_is_active: bool = False
    allocation_sort_order: int = 0


class ExpenseItemRowsPage(BaseModel):
    items: list[ExpenseItemRead]
    limit: int
    has_more: bool
    next_cursor_sort_order: int | None = None
    next_cursor_name: str | None = None
    next_cursor_id: UUID | None = None


class ShopExpenseItemRowsPage(BaseModel):
    items: list[ShopExpenseItemRead]
    limit: int
    has_more: bool
    next_cursor_sort_order: int | None = None
    next_cursor_name: str | None = None
    next_cursor_id: UUID | None = None


class ExpenseItemCounts(BaseModel):
    all: int = 0
    active: int = 0
    paused: int = 0
    allocated: int = 0
    available: int = 0


class ShopExpenseAllocationBulkCreate(BaseModel):
    expense_item_ids: list[UUID] = Field(min_length=1, max_length=100)


class ShopExpenseAllocationBulkRead(BaseModel):
    expense_item_ids: list[UUID]
    allocated_count: int = 0
    already_allocated_count: int = 0


class ShopExpenseAllocationUpdate(BaseModel):
    is_active: bool | None = None
    sort_order: int | None = None


class ShopExpenseItemsOrderUpdate(BaseModel):
    expense_item_ids: list[UUID]


class ShopExpenseItemsOrderRead(BaseModel):
    expense_item_ids: list[UUID]


class ExpenseEntryCreate(BaseModel):
    expense_item_id: UUID
    amount: Decimal | None = Field(default=None, gt=0, max_digits=12, decimal_places=2)
    cash_amount: Decimal = Field(default=Decimal("0.00"), ge=0, max_digits=12, decimal_places=2)
    upi_amount: Decimal = Field(default=Decimal("0.00"), ge=0, max_digits=12, decimal_places=2)
    spent_at: datetime | None = None
    note: str | None = Field(default=None, max_length=255)


class ExpenseEntryUpdate(BaseModel):
    amount: Decimal | None = Field(default=None, gt=0, max_digits=12, decimal_places=2)
    cash_amount: Decimal = Field(default=Decimal("0.00"), ge=0, max_digits=12, decimal_places=2)
    upi_amount: Decimal = Field(default=Decimal("0.00"), ge=0, max_digits=12, decimal_places=2)
    spent_at: datetime
    note: str | None = Field(default=None, max_length=255)


class ExpenseEntryRead(ORMModel):
    id: UUID
    shop_id: UUID
    shop_name: str
    expense_item_id: UUID
    expense_name: str
    expense_tamil_name: str
    image_path: str | None = None
    image_thumb_path: str | None = None
    image_content_type: str | None = None
    cash_amount: Decimal = Decimal("0.00")
    upi_amount: Decimal = Decimal("0.00")
    amount: Decimal
    spent_at: datetime
    note: str | None = None
    created_at: datetime


class ExpenseEntryPage(BaseModel):
    items: list[ExpenseEntryRead]
    limit: int
    has_more: bool
    total_cash_amount: Decimal = Decimal("0.00")
    total_upi_amount: Decimal = Decimal("0.00")
    total_amount: Decimal = Decimal("0.00")
    next_cursor_spent_at: datetime | None = None
    next_cursor_id: UUID | None = None
