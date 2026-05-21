from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from app.models import BaseUnit, UnitType
from app.schemas.common import ORMModel


class DailyPriceEntry(BaseModel):
    item_id: UUID
    price_per_unit: Decimal = Field(gt=0)


class DailyPriceCreate(BaseModel):
    entries: list[DailyPriceEntry]


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
    unit_type: UnitType
    base_unit: BaseUnit
    current_price: Decimal | None = None
    image_path: str | None = None


class ItemImageRead(BaseModel):
    item_id: UUID
    item_name: str
    image_path: str | None = None
    image_content_type: str | None = None


class ShopBootstrapResponse(BaseModel):
    shop_id: UUID | None = None
    shop_name: str
    price_date: date
    prices_set: bool
    next_screen: str
    items: list[ItemPriceRead]
