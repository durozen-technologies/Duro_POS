from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from ..models import BaseUnit
from .inventory import InventorySummaryRead


class RetailerInventoryUsageLine(BaseModel):
    inventory_item_id: UUID
    category_id: UUID | None = None
    quantity: Decimal = Field(gt=0)
    bird_count: int = Field(default=0, ge=0)


class RetailerInventoryUsageBulkCreate(BaseModel):
    retailer_id: UUID
    lines: list[RetailerInventoryUsageLine] = Field(min_length=1)
    occurred_at: datetime | None = None


class RetailerInventoryUsageRead(BaseModel):
    id: UUID
    shop_id: UUID
    shop_name: str | None = None
    retailer_id: UUID | None = None
    retailer_name: str | None = None
    inventory_item_id: UUID
    inventory_item_name: str
    inventory_item_tamil_name: str | None = None
    category_id: UUID | None = None
    category_name: str | None = None
    quantity: Decimal
    bird_count: int = 0
    unit: BaseUnit
    occurred_at: datetime
    created_at: datetime
    created_by_user_id: UUID | None = None
    created_by_name: str | None = None
    adjustment_reason: str | None = None


class RetailerInventoryUsagePage(BaseModel):
    items: list[RetailerInventoryUsageRead]
    limit: int
    has_more: bool


class RetailerStockAdjustRequest(BaseModel):
    retailer_used_quantity: Decimal | None = Field(default=None, ge=0)
    retailer_used_bird_count: int | None = Field(default=None, ge=0)
    category_id: UUID | None = None
    retailer_id: UUID | None = None
    occurred_at: datetime | None = None
    adjustment_reason: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def require_quantity_or_bird_target(self) -> "RetailerStockAdjustRequest":
        if self.retailer_used_quantity is None and self.retailer_used_bird_count is None:
            raise ValueError("retailer_used_quantity or retailer_used_bird_count is required")
        return self


class RetailerInventoryUsageBulkResult(BaseModel):
    usages: list[RetailerInventoryUsageRead]
    summary: InventorySummaryRead | None = None


class RetailerInventoryPurchaseLineInput(BaseModel):
    inventory_item_id: UUID
    quantity: Decimal = Field(gt=0)
    bird_count: int = Field(default=0, ge=0)
    price_per_unit: Decimal = Field(gt=0)


class RetailerInventoryPurchaseCreate(BaseModel):
    retailer_id: UUID
    lines: list[RetailerInventoryPurchaseLineInput] = Field(min_length=1)
    occurred_at: datetime | None = None
    notes: str | None = Field(default=None, max_length=500)


class RetailerInventoryPurchaseLineRead(BaseModel):
    id: UUID
    inventory_item_id: UUID
    item_name: str
    quantity: Decimal
    bird_count: int = 0
    price_per_unit: Decimal
    line_total: Decimal


class RetailerInventoryPurchaseRead(BaseModel):
    id: UUID
    shop_id: UUID
    shop_name: str | None = None
    retailer_id: UUID
    retailer_name: str | None = None
    total_amount: Decimal
    amount_applied_to_outstanding: Decimal = Decimal("0.00")
    amount_deposited_to_wallet: Decimal = Decimal("0.00")
    status: str
    notes: str | None = None
    created_at: datetime
    voided_at: datetime | None = None
    lines: list[RetailerInventoryPurchaseLineRead]


class RetailerInventoryPurchasePage(BaseModel):
    items: list[RetailerInventoryPurchaseRead]
    limit: int
    has_more: bool
