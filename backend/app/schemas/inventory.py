from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from ..models import BaseUnit, InventoryMovementType, UnitType
from .common import ORMModel


class InventoryCategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class InventoryCategoryUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class InventoryCategoryRead(ORMModel):
    id: UUID
    name: str
    created_at: datetime
    updated_at: datetime | None = None


class InventoryItemPurchaseRateHistoryRead(BaseModel):
    inventory_item_id: UUID
    purchase_rate: Decimal


class InventoryBillingItemMappingRead(BaseModel):
    inventory_category_id: UUID | None = None
    inventory_category_name: str | None = None
    billing_item_id: UUID
    billing_item_name: str
    billing_item_tamil_name: str | None = None


class InventoryBillingItemMappingWrite(BaseModel):
    inventory_category_id: UUID | None = None
    billing_item_id: UUID


class InventoryItemCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    tamil_name: str = Field(min_length=1, max_length=120)
    unit_type: UnitType
    base_unit: BaseUnit
    is_active: bool = True
    sort_order: int = 0
    category_ids: list[UUID] = Field(default_factory=list)
    billing_item_id: UUID | None = None
    billing_item_ids: list[UUID] = Field(default_factory=list)
    billing_mappings: list[InventoryBillingItemMappingWrite] = Field(default_factory=list)
    global_image_template_id: UUID | None = None
    use_global_image_template: bool | None = None

    @model_validator(mode="after")
    def validate_unit_pair(self) -> "InventoryItemCreate":
        if self.unit_type == UnitType.WEIGHT and self.base_unit != BaseUnit.KG:
            raise ValueError("Weight inventory items must use kg as the base unit")
        if self.unit_type == UnitType.COUNT and self.base_unit != BaseUnit.UNIT:
            raise ValueError("Count inventory items must use unit as the base unit")
        return self


class InventoryItemUpdate(InventoryItemCreate):
    pass


class InventoryItemPurchaseRateUpdate(BaseModel):
    purchase_rate: Decimal = Field(ge=0)


class InventoryPurchaseRatesConfirmRead(BaseModel):
    updated_count: int = 0


class InventoryItemRead(ORMModel):
    id: UUID
    name: str
    tamil_name: str
    unit_type: UnitType
    base_unit: BaseUnit
    is_active: bool
    sort_order: int = 0
    purchase_rate: Decimal = Decimal("0")
    billing_item_id: UUID | None = None
    billing_item_ids: list[UUID] = Field(default_factory=list)
    billing_items: list[InventoryBillingItemMappingRead] = Field(default_factory=list)
    category_ids: list[UUID] = Field(default_factory=list)
    category_billing_item_ids: dict[UUID, UUID] = Field(default_factory=dict)
    categories: list[InventoryCategoryRead] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime | None = None
    image_path: str | None = None
    image_thumb_path: str | None = None
    image_content_type: str | None = None
    global_image_template_id: UUID | None = None
    can_delete: bool = True


class InventoryItemRowsPage(BaseModel):
    items: list[InventoryItemRead]
    limit: int
    has_more: bool
    next_cursor_sort_order: int | None = None
    next_cursor_name: str | None = None
    next_cursor_id: UUID | None = None
    next_cursor_is_active: bool | None = None


class InventoryItemCounts(BaseModel):
    all: int = 0
    active: int = 0
    paused: int = 0


class InventoryItemImageRead(BaseModel):
    inventory_item_id: UUID
    inventory_item_name: str
    inventory_item_tamil_name: str | None = None
    image_path: str | None = None
    image_thumb_path: str | None = None
    image_content_type: str | None = None


class ShopInventoryAllocationBulkCreate(BaseModel):
    item_ids: list[UUID] = Field(min_length=1, max_length=100)


class ShopInventoryAllocationUpdate(BaseModel):
    item_id: UUID
    is_active: bool | None = None
    sort_order: int | None = None


class ShopInventoryAllocationBulkRead(BaseModel):
    item_ids: list[UUID]
    allocated_count: int = 0
    already_allocated_count: int = 0


class InventoryCategoryUsageRead(BaseModel):
    category_id: UUID
    category_name: str
    available_quantity: Decimal = Decimal("0")
    used_quantity: Decimal = Decimal("0")
    retailer_used_quantity: Decimal = Decimal("0")
    used_bird_count: int = 0
    retailer_used_bird_count: int = 0


class InventoryItemStockRead(InventoryItemRead):
    allocated: bool = False
    allocation_active: bool = False
    allocation_sort_order: int = 0
    available_quantity: Decimal = Decimal("0")
    added_quantity: Decimal = Decimal("0")
    used_quantity: Decimal = Decimal("0")
    transfer_stock: Decimal = Decimal("0")
    retailer_used_quantity: Decimal = Decimal("0")
    available_bird_count: int = 0
    added_bird_count: int = 0
    used_bird_count: int = 0
    transfer_bird_count: int = 0
    retailer_used_bird_count: int = 0
    stock_last_updated_at: datetime | None = None
    category_usage: list[InventoryCategoryUsageRead] = Field(default_factory=list)


class InventorySummaryRead(BaseModel):
    shop_id: UUID
    shop_name: str
    items: list[InventoryItemStockRead]
    categories: list[InventoryCategoryUsageRead]
    total_transfer_stock: Decimal = Decimal("0")
    total_used_stock: Decimal = Decimal("0")
    total_retailer_used_stock: Decimal = Decimal("0")
    total_transfer_bird_count: int = 0
    total_used_bird_count: int = 0
    total_retailer_used_bird_count: int = 0


class InventoryStockRowsPage(BaseModel):
    shop_id: UUID
    shop_name: str
    items: list[InventoryItemStockRead]
    limit: int
    has_more: bool
    next_cursor_sort_order: int | None = None
    next_cursor_name: str | None = None
    next_cursor_id: UUID | None = None
    total_transfer_stock: Decimal = Decimal("0")
    total_used_stock: Decimal = Decimal("0")
    total_retailer_used_stock: Decimal = Decimal("0")
    total_transfer_bird_count: int = 0
    total_used_bird_count: int = 0
    total_retailer_used_bird_count: int = 0


class InventoryMovementRead(BaseModel):
    id: UUID
    shop_id: UUID
    shop_name: str | None = None
    inventory_item_id: UUID
    inventory_item_name: str
    inventory_item_tamil_name: str | None = None
    category_id: UUID | None = None
    category_name: str | None = None
    movement_type: InventoryMovementType
    quantity: Decimal
    bird_count: int = 0
    unit: BaseUnit
    driver_name: str | None = None
    vehicle_number: str | None = None
    occurred_at: datetime
    created_at: datetime


class InventoryMovementPage(BaseModel):
    items: list[InventoryMovementRead]
    limit: int
    has_more: bool


class InventoryAddRequest(BaseModel):
    quantity: Decimal = Field(gt=0)
    bird_count: int = Field(default=0, ge=0)
    driver_name: str = Field(min_length=1, max_length=100)
    vehicle_number: str = Field(min_length=2, max_length=120)
    occurred_at: datetime | None = None

    @field_validator("driver_name", "vehicle_number", mode="before")
    @classmethod
    def normalize_transport_text(cls, value: object) -> object:
        if isinstance(value, str):
            return " ".join(value.split())
        return value


class InventoryUseRequest(BaseModel):
    category_id: UUID | None = None
    quantity: Decimal = Field(gt=0)
    bird_count: int = Field(default=0, ge=0)
    occurred_at: datetime | None = None


class InventoryUseSplitLine(BaseModel):
    category_id: UUID
    quantity: Decimal = Field(ge=0)
    bird_count: int = Field(default=0, ge=0)


class InventoryUseSplitRequest(BaseModel):
    total_quantity: Decimal = Field(gt=0)
    categories: list[InventoryUseSplitLine] = Field(min_length=1)
    occurred_at: datetime | None = None


class InventoryStockAdjustRequest(BaseModel):
    available_quantity: Decimal | None = Field(default=None, ge=0)
    available_bird_count: int | None = Field(default=None, ge=0)
    used_quantity: Decimal | None = Field(default=None, ge=0)
    used_bird_count: int | None = Field(default=None, ge=0)
    transfer_quantity: Decimal | None = Field(default=None, ge=0)
    transfer_bird_count: int | None = Field(default=None, ge=0)
    category_id: UUID | None = None
    occurred_at: datetime | None = None


class InventoryMovementCreateResult(BaseModel):
    movement: InventoryMovementRead
    item: InventoryItemStockRead
    summary: InventorySummaryRead | None = None


class InventoryMovementSplitCreateResult(BaseModel):
    movements: list[InventoryMovementRead]
    item: InventoryItemStockRead
    summary: InventorySummaryRead | None = None


def _is_whole_decimal(value: Decimal) -> bool:
    return value == value.to_integral_value()


class InventoryQuantityMixin(BaseModel):
    quantity: Decimal

    @field_validator("quantity")
    @classmethod
    def normalize_quantity(cls, quantity: Decimal) -> Decimal:
        return quantity.quantize(Decimal("0.001"))


def validate_inventory_quantity_for_unit(unit: BaseUnit, quantity: Decimal) -> None:
    if unit == BaseUnit.UNIT and not _is_whole_decimal(quantity):
        raise ValueError("Unit inventory quantities must be whole numbers")
