from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from ..models import BaseUnit, UnitType
from .admin import PriceStatus
from .common import ORMModel


class DailyPriceEntry(BaseModel):
    item_id: UUID
    price_per_unit: Decimal = Field(gt=0)


class DailyPriceCreate(BaseModel):
    entries: list[DailyPriceEntry]


class DailyPriceUpdate(BaseModel):
    price_per_unit: Decimal = Field(gt=0)


class DailyPriceRead(ORMModel):
    id: UUID
    item_id: UUID
    price_per_unit: Decimal
    unit: BaseUnit
    price_date: date
    created_at: datetime


class ItemPriceRead(BaseModel):
    item_id: UUID
    item_name: str
    item_tamil_name: str | None = None
    unit_type: UnitType
    base_unit: BaseUnit
    current_price: Decimal | None = None
    latest_price_date: date | None = None
    price_status: PriceStatus = PriceStatus.MISSING
    sort_order: int = 0
    category_id: UUID | None = None
    category: str | None = None
    image_path: str | None = None
    image_thumb_path: str | None = None


class ItemImageRead(BaseModel):
    item_id: UUID
    item_name: str
    item_tamil_name: str | None = None
    image_path: str | None = None
    image_thumb_path: str | None = None
    image_content_type: str | None = None


class ShopBootstrapResponse(BaseModel):
    shop_id: UUID | None = None
    shop_name: str
    price_date: date
    prices_set: bool
    next_screen: str
    items: list[ItemPriceRead]
