from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.models import BaseUnit, UnitType
from app.schemas.common import ORMModel

AnalyticsPeriod = Literal["date", "month", "week", "year"]


class ShopCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=8, max_length=128)


class ShopUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    username: str = Field(min_length=3, max_length=50)
    password: str | None = Field(default=None, min_length=8, max_length=128)


class ShopStatusUpdate(BaseModel):
    is_active: bool


class ShopRead(ORMModel):
    id: UUID
    name: str
    is_active: bool
    created_at: datetime
    username: str


class ItemCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    unit_type: UnitType
    base_unit: BaseUnit
    is_active: bool = True


class ItemUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    unit_type: UnitType
    base_unit: BaseUnit
    is_active: bool


class ItemRead(ORMModel):
    id: UUID
    name: str
    unit_type: UnitType
    base_unit: BaseUnit
    is_active: bool
    created_at: datetime
    image_path: str | None = None
    image_content_type: str | None = None


class ShopSalesSummary(BaseModel):
    shop_id: UUID
    shop_name: str
    total_sales: Decimal


class PaymentSplitSummary(BaseModel):
    shop_id: UUID
    shop_name: str
    cash_total: Decimal
    upi_total: Decimal


class ItemSalesSummary(BaseModel):
    item_id: UUID
    item_name: str
    base_unit: BaseUnit
    quantity_sold: Decimal
    total_amount: Decimal
    bill_count: int


class AdminBillSummary(BaseModel):
    bill_id: UUID
    bill_no: str
    shop_id: UUID
    shop_name: str
    total_amount: Decimal
    status: str
    created_at: datetime


class AdminBillShopStat(BaseModel):
    shop_id: UUID
    bill_count: int
    last_bill_at: datetime | None


class AdminBillPage(BaseModel):
    items: list[AdminBillSummary]
    limit: int
    has_more: bool
    total_count: int
    largest_bill: AdminBillSummary | None = None
    shop_stats: list[AdminBillShopStat]
    next_cursor_created_at: datetime | None = None
    next_cursor_id: UUID | None = None


class AdminDashboardBootstrap(BaseModel):
    shops: list[ShopRead]
    sales_summary: list[ShopSalesSummary]
    payment_summary: list[PaymentSplitSummary]
    bills: AdminBillPage
    item_sales: list[ItemSalesSummary]
