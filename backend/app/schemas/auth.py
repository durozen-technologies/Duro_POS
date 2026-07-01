import re
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, ValidationInfo, field_validator, model_validator

from ..models import UserRole
from .common import ORMModel

USERNAME_PATTERN = re.compile(r"^[a-z0-9._-]+$")


def normalize_username(value: object) -> str:
    username = str(value).strip().lower()
    if not username:
        raise ValueError("Username is required")
    if not USERNAME_PATTERN.fullmatch(username):
        raise ValueError(
            "Username may only contain letters, numbers, dots, hyphens, and underscores"
        )
    return username


def require_non_blank_password(value: str) -> str:
    if not value or not value.strip():
        raise ValueError("Password is required")
    return value


class LoginRequest(BaseModel):
    username: str
    password: str
    organization_slug: str | None = None

    @field_validator("username", mode="before")
    @classmethod
    def normalize_login_username(cls, username: object) -> str:
        return normalize_username(username)

    @field_validator("password")
    @classmethod
    def validate_login_password(cls, password: str) -> str:
        return require_non_blank_password(password)


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)

    @field_validator("username", mode="before")
    @classmethod
    def normalize_register_username(cls, username: object) -> str:
        return normalize_username(username)

    @field_validator("password")
    @classmethod
    def validate_register_password(cls, password: str) -> str:
        return require_non_blank_password(password)

    @field_validator("confirm_password")
    @classmethod
    def validate_password_match(cls, confirm_password: str, info: ValidationInfo) -> str:
        password = info.data.get("password")
        if password is not None and password != confirm_password:
            raise ValueError("Passwords do not match")
        return confirm_password


class PasswordResetRequest(BaseModel):
    id: UUID
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)

    @field_validator("username", mode="before")
    @classmethod
    def normalize_reset_username(cls, username: object) -> str:
        return normalize_username(username)

    @field_validator("password")
    @classmethod
    def validate_password(cls, password: str) -> str:
        return require_non_blank_password(password)

    @model_validator(mode="after")
    def validate_password_match(self) -> "PasswordResetRequest":
        if self.password != self.confirm_password:
            raise ValueError("Passwords do not match")
        return self


class PasswordResetResponse(ORMModel):
    id: UUID
    username: str
    role: UserRole
    is_active: bool
    password_reset: bool = True


class UserSession(ORMModel):
    id: UUID
    username: str
    role: UserRole
    is_active: bool
    created_at: datetime
    organization_id: UUID | None = None
    organization_name: str | None = None
    permissions: list[str] = Field(default_factory=list)
    shop_id: UUID | None = None
    shop_name: str | None = None
    requires_price_setup: bool = False
    next_screen: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserSession


class TokenPayload(BaseModel):
    sub: str
