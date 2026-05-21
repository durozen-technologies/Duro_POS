import json
import os
import re
from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

S3_BUCKET_NAME_PATTERN = re.compile(
    r"^(?!xn--)(?!.*\.\.)(?!.*\.$)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$"
)
ENV_FILE_PATH = Path(__file__).resolve().parents[2] / ".env"


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
    trusted_proxies: list[str] = Field(default_factory=list)
    trusted_proxy_depth: int = 1
    trust_x_forwarded_proto: bool = False
    enable_penetration_detection: bool = True
    security_passive_mode: bool = False
    rustfs_endpoint_url: str | None = None
    rustfs_access_key_id: str | None = None
    rustfs_secret_access_key: str | None = None
    rustfs_region_name: str = "us-east-1"
    rustfs_bucket_name: str = "pos-mlb-items"
    rustfs_connect_timeout_seconds: int = 5
    rustfs_read_timeout_seconds: int = 15
    item_image_max_bytes: int = 5 * 1024 * 1024

    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE_PATH),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @field_validator(
        "cors_origins",
        "allowed_hosts",
        "rate_limit_exempt_paths",
        "trusted_proxies",
        mode="before",
    )
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
        rustfs_connection_values = [
            self.rustfs_endpoint_url,
            self.rustfs_access_key_id,
            self.rustfs_secret_access_key,
        ]
        configured_connection_values = [
            value for value in rustfs_connection_values if value and value.strip()
        ]
        if configured_connection_values and len(configured_connection_values) != len(
            rustfs_connection_values
        ):
            raise ValueError(
                "RUSTFS_ENDPOINT_URL, RUSTFS_ACCESS_KEY_ID, "
                "RUSTFS_SECRET_ACCESS_KEY, and RUSTFS_BUCKET_NAME must be set together"
            )
        if configured_connection_values and not self.rustfs_bucket_name.strip():
            raise ValueError(
                "RUSTFS_ENDPOINT_URL, RUSTFS_ACCESS_KEY_ID, "
                "RUSTFS_SECRET_ACCESS_KEY, and RUSTFS_BUCKET_NAME must be set together"
            )
        if self.rustfs_bucket_name and not S3_BUCKET_NAME_PATTERN.fullmatch(
            self.rustfs_bucket_name
        ):
            raise ValueError(
                "RUSTFS_BUCKET_NAME must be a valid S3 bucket name: 3-63 chars, lowercase "
                "letters/numbers, and may include hyphens or periods only"
            )
        if self.item_image_max_bytes < 1:
            raise ValueError("ITEM_IMAGE_MAX_BYTES must be greater than 0")
        if self.rustfs_connect_timeout_seconds < 1:
            raise ValueError("RUSTFS_CONNECT_TIMEOUT_SECONDS must be greater than 0")
        if self.rustfs_read_timeout_seconds < 1:
            raise ValueError("RUSTFS_READ_TIMEOUT_SECONDS must be greater than 0")

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
        if self.trusted_proxy_depth < 1:
            raise ValueError("TRUSTED_PROXY_DEPTH must be greater than 0")

        return self

    @property
    def rustfs_enabled(self) -> bool:
        return bool(
            self.rustfs_endpoint_url
            and self.rustfs_access_key_id
            and self.rustfs_secret_access_key
            and self.rustfs_bucket_name
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
