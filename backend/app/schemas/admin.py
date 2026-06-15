from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from ..models import BaseUnit, ItemAssumptionStatus, UnitType
from .auth import normalize_username, require_non_blank_password
from .common import ORMModel

AnalyticsPeriod = Literal["date", "week", "month", "year", "range"]
AdminReportSection = Literal[
    "sales",
    "billing",
    "items",
    "inventory",
    "expenses",
    "over_report",
]
AdminReportDetailLevel = Literal["summary", "full"]
JsonScalar = str | int | float | bool | None
JsonObject = dict[str, JsonScalar]


class ShopCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("username", mode="before")
    @classmethod
    def normalize_create_username(cls, username: object) -> str:
        return normalize_username(username)

    @field_validator("password")
    @classmethod
    def validate_create_password(cls, password: str) -> str:
        return require_non_blank_password(password)


class ShopUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    username: str = Field(min_length=3, max_length=50)
    password: str | None = Field(default=None, min_length=8, max_length=128)

    @field_validator("username", mode="before")
    @classmethod
    def normalize_update_username(cls, username: object) -> str:
        return normalize_username(username)

    @field_validator("password", mode="before")
    @classmethod
    def empty_update_password_as_none(cls, password: object) -> object:
        if isinstance(password, str) and not password.strip():
            return None
        return password

    @field_validator("password")
    @classmethod
    def validate_update_password(cls, password: str | None) -> str | None:
        if password is None:
            return None
        return require_non_blank_password(password)


class ShopStatusUpdate(BaseModel):
    is_active: bool


class ShopRead(ORMModel):
    id: UUID
    name: str
    is_active: bool
    created_at: datetime
    username: str


class ItemCategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class ItemCategoryUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class ItemCategoryRead(ORMModel):
    id: UUID
    name: str
    created_at: datetime
    updated_at: datetime | None = None


class ItemCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    tamil_name: str = Field(min_length=1, max_length=120)
    unit_type: UnitType
    base_unit: BaseUnit
    is_active: bool = True
    sort_order: int = 0
    category_id: UUID | None = None
    category: str | None = Field(default=None, max_length=80)
    custom_attributes: JsonObject = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_unit_pair(self) -> "ItemCreate":
        if self.unit_type == UnitType.WEIGHT and self.base_unit != BaseUnit.KG:
            raise ValueError("Weight items must use kg as the base unit")
        if self.unit_type == UnitType.COUNT and self.base_unit != BaseUnit.UNIT:
            raise ValueError("Count items must use unit as the base unit")
        return self


class ItemUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    tamil_name: str = Field(min_length=1, max_length=120)
    unit_type: UnitType
    base_unit: BaseUnit
    is_active: bool
    sort_order: int = 0
    category_id: UUID | None = None
    category: str | None = Field(default=None, max_length=80)
    custom_attributes: JsonObject = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_unit_pair(self) -> "ItemUpdate":
        if self.unit_type == UnitType.WEIGHT and self.base_unit != BaseUnit.KG:
            raise ValueError("Weight items must use kg as the base unit")
        if self.unit_type == UnitType.COUNT and self.base_unit != BaseUnit.UNIT:
            raise ValueError("Count items must use unit as the base unit")
        return self


class ItemMetadataUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    tamil_name: str | None = Field(default=None, min_length=1, max_length=120)
    unit_type: UnitType | None = None
    base_unit: BaseUnit | None = None
    is_active: bool | None = None
    sort_order: int | None = None
    category_id: UUID | None = None
    category: str | None = Field(default=None, max_length=80)
    custom_attributes: JsonObject | None = None

    @model_validator(mode="after")
    def validate_unit_pair(self) -> "ItemMetadataUpdate":
        if self.unit_type is None and self.base_unit is None:
            return self
        if self.unit_type == UnitType.WEIGHT and self.base_unit != BaseUnit.KG:
            raise ValueError("Weight items must use kg as the base unit")
        if self.unit_type == UnitType.COUNT and self.base_unit != BaseUnit.UNIT:
            raise ValueError("Count items must use unit as the base unit")
        if self.unit_type is None or self.base_unit is None:
            raise ValueError("unit_type and base_unit must be updated together")
        return self


class ItemAssumptionUpdate(BaseModel):
    assumption_percent: Decimal | None = Field(default=None, gt=0, le=100)
    assumption_inventory_item_id: UUID | None = None
    assumption_inventory_category_id: UUID | None = None

    @model_validator(mode="after")
    def validate_complete_or_clear(self) -> "ItemAssumptionUpdate":
        if self.assumption_percent is None:
            if self.assumption_inventory_item_id is None and self.assumption_inventory_category_id is None:
                return self
            raise ValueError("Assumption inventory item and category require an assumption percent")
        if self.assumption_inventory_item_id is None and self.assumption_inventory_category_id is None:
            return self
        if self.assumption_inventory_item_id is not None and self.assumption_inventory_category_id is not None:
            return self
        raise ValueError("Assumption inventory item and category must be saved together")


class ItemRead(ORMModel):
    id: UUID
    shop_id: UUID | None = None
    name: str
    tamil_name: str | None = None
    unit_type: UnitType
    base_unit: BaseUnit
    is_active: bool
    sort_order: int = 0
    category_id: UUID | None = None
    category: str | None = None
    created_at: datetime
    updated_at: datetime | None = None
    custom_attributes: JsonObject = Field(default_factory=dict)
    assumption_percent: Decimal | None = None
    assumption_inventory_item_id: UUID | None = None
    assumption_inventory_category_id: UUID | None = None
    assumption_status: ItemAssumptionStatus = ItemAssumptionStatus.NOT_APPLICABLE
    image_path: str | None = None
    image_thumb_path: str | None = None
    image_content_type: str | None = None


class PriceStatus(str, Enum):
    MISSING = "missing"
    STALE = "stale"
    CURRENT = "current"


class ItemScope(str, Enum):
    GLOBAL = "global"
    SHOP = "shop"


class ShopItemRead(ItemRead):
    current_price: Decimal | None = None
    price_date: date | None = None
    latest_price_date: date | None = None
    price_status: PriceStatus = PriceStatus.MISSING
    scope: ItemScope
    allocated: bool = False
    available_for_billing: bool = False
    can_delete: bool = False
    can_deallocate: bool = False
    bill_count: int = 0
    price_count: int = 0
    allocated_shop_count: int = 0


class ShopItemAllocationUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=120)
    tamil_name: str | None = Field(default=None, max_length=120)
    is_active: bool | None = None
    sort_order: int | None = None
    custom_attributes: JsonObject = Field(default_factory=dict)


class ShopItemAllocationBulkCreate(BaseModel):
    item_ids: list[UUID] = Field(min_length=1, max_length=100)


class ShopItemAllocationBulkRead(BaseModel):
    item_ids: list[UUID]
    allocated_count: int = 0
    already_allocated_count: int = 0


class ShopSelectedItemsOrderUpdate(BaseModel):
    item_ids: list[UUID]


class ShopSelectedItemsOrderRead(BaseModel):
    item_ids: list[UUID]


class ShopItemCounts(BaseModel):
    all: int = 0
    allocated: int = 0
    available: int = 0
    catalogue: int = 0
    shop: int = 0
    priced: int = 0
    needs_price: int = 0
    stale_price: int = 0
    paused: int = 0


class ShopItemPage(BaseModel):
    items: list[ShopItemRead]
    limit: int
    total_count: int = 0
    counts: ShopItemCounts = Field(default_factory=ShopItemCounts)
    has_more: bool
    next_cursor_group: int | None = None
    next_cursor_sort_order: int | None = None
    next_cursor_name: str | None = None
    next_cursor_id: UUID | None = None


class AdminItemRowsPage(BaseModel):
    items: list[ShopItemRead]
    limit: int
    has_more: bool
    next_cursor_group: int | None = None
    next_cursor_sort_order: int | None = None
    next_cursor_name: str | None = None
    next_cursor_id: UUID | None = None


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
    item_tamil_name: str | None = None
    base_unit: BaseUnit
    quantity_sold: Decimal
    total_amount: Decimal
    bill_count: int


class OverallReportUnitSummary(BaseModel):
    unit: BaseUnit
    old_stock: Decimal = Decimal("0")
    adding_stock: Decimal = Decimal("0")
    total_available_stock: Decimal = Decimal("0")
    used_stock: Decimal = Decimal("0")
    remaining_stock: Decimal = Decimal("0")
    sales_quantity: Decimal = Decimal("0")
    assumption_quantity: Decimal = Decimal("0")
    difference_quantity: Decimal = Decimal("0")


class OverallReportBillingItem(BaseModel):
    billing_item_id: UUID
    item_name: str
    item_tamil_name: str | None = None
    category: str
    unit: BaseUnit
    assumption_percent: Decimal | None = None
    sales_quantity: Decimal = Decimal("0")
    assumption_quantity: Decimal = Decimal("0")
    difference_quantity: Decimal = Decimal("0")
    today_price: Decimal | None = None
    sales_amount: Decimal = Decimal("0")
    assumption_amount: Decimal = Decimal("0")
    difference_amount: Decimal = Decimal("0")


class OverallReportUsedStockBreakdown(BaseModel):
    category_id: UUID | None = None
    category_name: str | None = None
    label: str
    quantity: Decimal = Decimal("0")


class OverallReportInventoryItem(BaseModel):
    inventory_item_id: UUID
    item_name: str
    item_tamil_name: str | None = None
    category: str
    unit: BaseUnit
    old_stock: Decimal = Decimal("0")
    adding_stock: Decimal = Decimal("0")
    total_available_stock: Decimal = Decimal("0")
    used_stock: Decimal = Decimal("0")
    remaining_stock: Decimal = Decimal("0")
    sales_quantity: Decimal = Decimal("0")
    assumption_quantity: Decimal = Decimal("0")
    difference_quantity: Decimal = Decimal("0")
    sales_amount: Decimal = Decimal("0")
    assumption_amount: Decimal = Decimal("0")
    difference_amount: Decimal = Decimal("0")
    used_stock_breakdown: list[OverallReportUsedStockBreakdown] = Field(default_factory=list)
    billing_items: list[OverallReportBillingItem] = Field(default_factory=list)


class OverallReportStatement(BaseModel):
    shop_id: UUID
    shop_name: str
    start_date: date
    end_date: date
    period_label: str
    unit_summaries: list[OverallReportUnitSummary] = Field(default_factory=list)
    expense_amount: Decimal = Decimal("0")
    sales_amount: Decimal = Decimal("0")
    assumption_amount: Decimal = Decimal("0")
    difference_amount: Decimal = Decimal("0")
    sales_minus_expense_amount: Decimal = Decimal("0")
    sales_minus_assumption_amount: Decimal = Decimal("0")
    inventory_items: list[OverallReportInventoryItem] = Field(default_factory=list)


class OverallReportRead(BaseModel):
    period: AnalyticsPeriod
    detail_level: AdminReportDetailLevel
    period_label: str
    statements: list[OverallReportStatement] = Field(default_factory=list)


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
