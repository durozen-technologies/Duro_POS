import json
import os
import re
from functools import lru_cache
from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

S3_BUCKET_NAME_PATTERN = re.compile(
    r"^(?!xn--)(?!.*\.\.)(?!.*\.$)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$"
)
ENV_FILE_PATH = Path(__file__).resolve().parents[2] / ".env"


def parse_list_setting(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return []
        if stripped.startswith("["):
            try:
                parsed = json.loads(stripped)
            except json.JSONDecodeError:
                inner = stripped.strip("[]")
                return [item.strip().strip('"') for item in inner.split(",") if item.strip()]
            if isinstance(parsed, list):
                return [str(item).strip() for item in parsed if str(item).strip()]
            return [str(parsed).strip()]
        return [item.strip() for item in stripped.split(",") if item.strip()]
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


class Settings(BaseSettings):
    app_name: str = "Duro POS API"
    api_v1_prefix: str = "/api/v1"
    database_url: str = "postgresql+asyncpg://postgres:root@localhost:5432/duro_pos"
    production: bool = False
    secret_key: str = ""
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 12 * 60
    shop_default_password: str = "ml123"
    allowed_hosts_raw: str = Field(default="*", validation_alias="ALLOWED_HOSTS")
    cors_origins_raw: str = Field(default="*", validation_alias="CORS_ORIGINS")
    cors_allow_credentials: bool = False
    db_pool_size: int = 5
    db_max_overflow: int = 10
    db_pool_timeout: int = 30
    db_pool_recycle: int = 1800
    rustfs_endpoint_url: str | None = None
    rustfs_access_key_id: str | None = None
    rustfs_secret_access_key: str | None = None
    rustfs_region_name: str = "us-east-1"
    rustfs_bucket_name: str = "pos-mlb-items"
    rustfs_server_domains_raw: str | None = Field(
        default=None, validation_alias="RUSTFS_SERVER_DOMAINS"
    )
    rustfs_s3_host_header: str | None = Field(
        default=None, validation_alias="RUSTFS_S3_HOST_HEADER"
    )
    rustfs_public_base_url: str | None = None
    rustfs_public_read_enabled: bool = False
    rustfs_connect_timeout_seconds: int = 5
    rustfs_read_timeout_seconds: int = 15
    item_image_max_bytes: int = 5 * 1024 * 1024
    item_image_thumbnail_size: int = 192
    item_image_full_max_size: int = 1024
    slow_request_threshold_seconds: float = 0.75

    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE_PATH),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        populate_by_name=True,
    )

    @property
    def allowed_hosts(self) -> list[str]:
        return parse_list_setting(self.allowed_hosts_raw)

    @property
    def cors_origins(self) -> list[str]:
        return parse_list_setting(self.cors_origins_raw)

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
        if self.item_image_thumbnail_size < 1:
            raise ValueError("ITEM_IMAGE_THUMBNAIL_SIZE must be greater than 0")
        if self.item_image_full_max_size < self.item_image_thumbnail_size:
            raise ValueError(
                "ITEM_IMAGE_FULL_MAX_SIZE must be greater than or equal to thumbnail size"
            )
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
            self.cors_origins_raw = ""
        if not self.allowed_hosts or self.allowed_hosts == ["*"]:
            if render_external_hostname:
                self.allowed_hosts_raw = render_external_hostname
            else:
                raise ValueError("ALLOWED_HOSTS must be explicitly set in production")
        if not self.rustfs_enabled:
            raise ValueError(
                "RustFS must be configured in production because item images are RustFS-only"
            )
        if self.shop_default_password == "ml123":
            raise ValueError("SHOP_DEFAULT_PASSWORD must be changed from the default in production")

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
