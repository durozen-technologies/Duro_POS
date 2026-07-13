from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from ..common import ORMModel


class GlobalImageTemplateRead(ORMModel):
    id: UUID
    name: str
    category_id: UUID | None
    category_name: str | None = None
    sort_order: int
    is_active: bool
    image_path: str | None = None
    image_thumb_path: str | None = None
    image_content_type: str | None = None
    created_at: datetime
    updated_at: datetime


class GlobalImageTemplateCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    category_id: UUID | None = None
    sort_order: int = 0
    is_active: bool = True


class GlobalImageTemplateUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    category_id: UUID | None = None
    sort_order: int | None = None
    is_active: bool | None = None
    remove_image: bool = False
