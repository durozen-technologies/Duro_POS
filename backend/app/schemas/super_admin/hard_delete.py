from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from app.schemas.auth import normalize_username, require_non_blank_password


class HardDeleteRequest(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("username", mode="before")
    @classmethod
    def validate_username_field(cls, username: object) -> str:
        return normalize_username(username)

    @field_validator("password")
    @classmethod
    def validate_password_field(cls, password: str) -> str:
        return require_non_blank_password(password)
