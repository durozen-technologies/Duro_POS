from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.models import UserRole
from app.schemas.auth import normalize_username, require_non_blank_password
from app.schemas.common import ORMModel


class TenantAdminCreate(BaseModel):
    organization_id: UUID
    username: str = Field(min_length=3, max_length=50)
    shop_name: str | None = Field(default=None, min_length=1, max_length=120)
    password: str = Field(min_length=8, max_length=128)
    role_ids: list[UUID] = Field(default_factory=list)

    @field_validator("username", mode="before")
    @classmethod
    def validate_username_field(cls, username: object) -> str:
        return normalize_username(username)

    @field_validator("password")
    @classmethod
    def validate_password_field(cls, password: str) -> str:
        return require_non_blank_password(password)


class TenantAdminStatusUpdate(BaseModel):
    is_active: bool


class TenantAdminRolesUpdate(BaseModel):
    role_ids: list[UUID] = Field(min_length=1)


class TenantAdminPasswordReset(BaseModel):
    password: str = Field(min_length=8, max_length=128)

    @field_validator("password")
    @classmethod
    def validate_password_field(cls, password: str) -> str:
        return require_non_blank_password(password)


class TenantAdminRead(ORMModel):
    id: UUID
    username: str
    shop_name: str | None = None
    role: UserRole
    organization_id: UUID
    organization_name: str
    is_active: bool
    role_ids: list[UUID] = Field(default_factory=list)
    created_at: datetime
    last_login_at: datetime | None = None


class TenantAdminRowsPage(BaseModel):
    items: list[TenantAdminRead]
    limit: int
    has_more: bool
    next_cursor_created_at: datetime | None = None
    next_cursor_id: UUID | None = None


class TenantAdminCounts(BaseModel):
    all: int = 0
    active: int = 0
    inactive: int = 0
