from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


def _require_trimmed(value: str, *, min_length: int, field_name: str) -> str:
    cleaned = " ".join(value.split())
    if len(cleaned) < min_length:
        raise ValueError(f"{field_name} must be at least {min_length} characters")
    return cleaned


class PurchaserCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    tamil_name: str = Field(min_length=1, max_length=120)
    shop_name: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=30)
    address: str | None = Field(default=None, max_length=500)
    is_active: bool = True

    @field_validator("name", "tamil_name", mode="before")
    @classmethod
    def strip_required_names(cls, value: object) -> object:
        if isinstance(value, str):
            return " ".join(value.split())
        return value


class PurchaserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    tamil_name: str | None = Field(default=None, min_length=1, max_length=120)
    shop_name: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=30)
    address: str | None = Field(default=None, max_length=500)
    is_active: bool | None = None

    @field_validator("name", "tamil_name", mode="before")
    @classmethod
    def strip_optional_names(cls, value: object) -> object:
        if isinstance(value, str):
            return " ".join(value.split())
        return value


class PurchaserRead(BaseModel):
    id: UUID
    name: str
    tamil_name: str
    shop_name: str | None = None
    phone: str | None = None
    address: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
