from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class PurchaserCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    shop_name: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=30)
    address: str | None = Field(default=None, max_length=500)
    is_active: bool = True


class PurchaserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    shop_name: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=30)
    address: str | None = Field(default=None, max_length=500)
    is_active: bool | None = None


class PurchaserRead(BaseModel):
    id: UUID
    name: str
    shop_name: str | None = None
    phone: str | None = None
    address: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
