from __future__ import annotations

import re
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import ORMModel

_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def slugify_name(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    if not slug:
        raise ValueError("Slug cannot be empty")
    if not _SLUG_RE.fullmatch(slug):
        raise ValueError("Slug may only contain lowercase letters, numbers, and hyphens")
    return slug[:80]


class OrganizationCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    slug: str | None = Field(default=None, min_length=2, max_length=80)
    max_branches: int = Field(default=5, ge=1, le=500)

    @field_validator("slug", mode="before")
    @classmethod
    def normalize_slug(cls, value: object) -> str | None:
        if value is None or str(value).strip() == "":
            return None
        return slugify_name(str(value))


class OrganizationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    max_branches: int | None = Field(default=None, ge=1, le=500)
    settings: dict[str, object] | None = None


class OrganizationStatusUpdate(BaseModel):
    is_active: bool


class OrganizationRead(ORMModel):
    id: UUID
    name: str
    slug: str
    is_active: bool
    max_branches: int
    branch_count: int = 0
    remaining_branches: int = 0
    settings: dict[str, object]
    created_at: datetime
    updated_at: datetime


class OrganizationRowsPage(BaseModel):
    items: list[OrganizationRead]
    limit: int
    has_more: bool
    next_cursor_created_at: datetime | None = None
    next_cursor_id: UUID | None = None


class OrganizationCounts(BaseModel):
    all: int = 0
    active: int = 0
    inactive: int = 0


class AdminRoleRead(ORMModel):
    id: UUID
    name: str
    is_system: bool
