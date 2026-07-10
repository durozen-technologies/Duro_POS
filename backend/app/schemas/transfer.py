from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from ..models import BaseUnit
from .common import ORMModel


class TransferShopCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    tamil_name: str = Field(min_length=1, max_length=120)
    is_active: bool = True


class TransferShopUpdate(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=120)
    tamil_name: str | None = Field(None, min_length=1, max_length=120)
    is_active: bool | None = None


class TransferShopRead(ORMModel):
    id: UUID
    name: str
    tamil_name: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


class InventoryTransferCreate(BaseModel):
    transfer_shop_id: UUID
    quantity: Decimal = Field(gt=0)
    bird_count: int = Field(default=0, ge=0)
    occurred_at: datetime | None = None


class InventoryTransferRead(ORMModel):
    id: UUID
    source_shop_id: UUID
    transfer_shop_id: UUID
    inventory_item_id: UUID
    quantity: Decimal
    bird_count: int = 0
    unit: BaseUnit
    occurred_at: datetime
    created_at: datetime

    # These will be populated from joins in the service
    source_shop_name: str | None = None
    transfer_shop_name: str | None = None
    inventory_item_name: str | None = None
    inventory_item_tamil_name: str | None = None


class InventoryTransferPage(BaseModel):
    items: list[InventoryTransferRead]
    limit: int
    has_more: bool
