import json
import os
from functools import lru_cache

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Meat Billing System API"
    api_v1_prefix: str = "/api/v1"
    database_url: str = "postgresql+asyncpg://postgres:root@localhost:5432/meat_billing"
    production: bool = False
    secret_key: str = ""
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 12 * 60
    shop_default_password: str = "ml123"
    cors_origins: list[str] = Field(default_factory=lambda: ["*"])
    allowed_hosts: list[str] = Field(default_factory=lambda: ["*"])
    cors_allow_credentials: bool = False
    db_pool_size: int = 5
    db_max_overflow: int = 10
    db_pool_timeout: int = 30
    db_pool_recycle: int = 1800
    enable_request_logging: bool = True
    enable_rate_limit: bool = True
    rate_limit_requests: int = 120
    rate_limit_window_seconds: int = 60
    rate_limit_exempt_paths: list[str] = Field(
        default_factory=lambda: [
            "/api/v1/health",
            "/docs",
            "/docs/oauth2-redirect",
            "/redoc",
            "/openapi.json",
            "/api/v1/openapi.json",
        ]
    )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @field_validator("cors_origins", "allowed_hosts", "rate_limit_exempt_paths", mode="before")
    @classmethod
    def parse_list_settings(cls, value: object) -> object:
        if value is None:
            return []
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return []
            if stripped.startswith("["):
                return json.loads(stripped)
            return [item.strip() for item in stripped.split(",") if item.strip()]
        return value

    @model_validator(mode="after")
    def validate_production_settings(self) -> "Settings":
        if not self.production:
            return self

        render_external_hostname = os.getenv("RENDER_EXTERNAL_HOSTNAME", "").strip()

        if (
            not self.secret_key
            or self.secret_key == "replace-this-in-production"
            or len(self.secret_key) < 32
        ):
            raise ValueError(
                "SECRET_KEY must be set to a strong value with at least 32 characters in production"
            )
        if not self.database_url:
            raise ValueError("DATABASE_URL must be set in production")
        if self.cors_origins == ["*"]:
            self.cors_origins = []
        if not self.allowed_hosts or self.allowed_hosts == ["*"]:
            if render_external_hostname:
                self.allowed_hosts = [render_external_hostname]
            else:
                raise ValueError("ALLOWED_HOSTS must be explicitly set in production")
        if self.rate_limit_requests < 1:
            raise ValueError("RATE_LIMIT_REQUESTS must be greater than 0")
        if self.rate_limit_window_seconds < 1:
            raise ValueError("RATE_LIMIT_WINDOW_SECONDS must be greater than 0")

        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
