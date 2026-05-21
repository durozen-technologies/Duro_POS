from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, ValidationInfo, field_validator

from app.models import UserRole
from app.schemas.common import ORMModel


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)

    @field_validator("confirm_password")
    @classmethod
    def validate_password_match(cls, confirm_password: str, info: ValidationInfo) -> str:
        password = info.data.get("password")
        if password is not None and password != confirm_password:
            raise ValueError("Passwords do not match")
        return confirm_password


class UserSession(ORMModel):
    id: UUID
    username: str
    role: UserRole
    is_active: bool
    created_at: datetime
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
