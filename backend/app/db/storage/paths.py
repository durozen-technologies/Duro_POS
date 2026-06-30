import asyncio
import json
import logging
import mimetypes
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import format_datetime
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from typing import Literal
from urllib.parse import quote, urlparse
from uuid import UUID

import boto3
from botocore.client import Config
from botocore.exceptions import (
    ClientError,
    ConnectTimeoutError,
    EndpointConnectionError,
    ReadTimeoutError,
)
from fastapi import HTTPException, UploadFile, status
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import inspect, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import S3_BUCKET_NAME_PATTERN, get_settings
from app.core.ids import uuid7
from app.models import ExpenseItem, InventoryItem, Item
from app.schemas.expenses import ExpenseItemImageRead
from app.schemas.inventory import InventoryItemImageRead
from app.schemas.pricing import ItemImageRead

settings = get_settings()
logger = logging.getLogger(__name__)

_bucket_ready = False
_public_read_policy_ready = False
_bucket_init_lock: asyncio.Lock | None = None
IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable"
PROXY_IMAGE_CACHE_CONTROL = "public, max-age=3600"
ImageVariant = Literal["original", "thumb"]


@dataclass(frozen=True)
class StoredImagePayload:
    content: bytes
    content_type: str
    object_key: str
    etag: str
    last_modified: datetime | None
    cache_control: str


@dataclass(frozen=True)
class StoredImageStreamPayload:
    body: object
    content_type: str
    object_key: str
    etag: str
    last_modified: datetime | None
    cache_control: str


class StoredImageObjectNotFoundError(Exception):
    def __init__(self, object_key: str) -> None:
        super().__init__(f"Stored image object not found: {object_key}")
        self.object_key = object_key


def build_item_image_path(
    item_id: UUID,
    image_object_key: str | None,
    image_content_type: str | None = None,
    *,
    variant: ImageVariant = "original",
) -> str | None:
    if not image_object_key:
        return None
    public_url = _build_public_object_url(image_object_key)
    if public_url:
        return public_url

    if variant == "thumb":
        return f"{settings.api_v1_prefix}/catalog/items/{item_id}/image?variant=thumb"
    return f"{settings.api_v1_prefix}/catalog/items/{item_id}/image"


def build_item_image_thumb_path(
    item_id: UUID,
    thumbnail_object_key: str | None,
    thumbnail_content_type: str | None = None,
    *,
    original_object_key: str | None = None,
) -> str | None:
    if thumbnail_object_key:
        return build_item_image_path(
            item_id,
            thumbnail_object_key,
            thumbnail_content_type,
            variant="thumb",
        )
    if original_object_key:
        return f"{settings.api_v1_prefix}/catalog/items/{item_id}/image?variant=thumb"
    return None


def build_inventory_item_image_path(
    inventory_item_id: UUID,
    image_object_key: str | None,
    image_content_type: str | None = None,
    *,
    variant: ImageVariant = "original",
) -> str | None:
    if not image_object_key:
        return None
    public_url = _build_public_object_url(image_object_key)
    if public_url:
        return public_url

    if variant == "thumb":
        return f"{settings.api_v1_prefix}/catalog/inventory-items/{inventory_item_id}/image?variant=thumb"
    return f"{settings.api_v1_prefix}/catalog/inventory-items/{inventory_item_id}/image"


def build_inventory_item_image_thumb_path(
    inventory_item_id: UUID,
    thumbnail_object_key: str | None,
    thumbnail_content_type: str | None = None,
    *,
    original_object_key: str | None = None,
) -> str | None:
    if thumbnail_object_key:
        return build_inventory_item_image_path(
            inventory_item_id,
            thumbnail_object_key,
            thumbnail_content_type,
            variant="thumb",
        )
    if original_object_key:
        return f"{settings.api_v1_prefix}/catalog/inventory-items/{inventory_item_id}/image?variant=thumb"
    return None


def build_expense_item_image_path(
    expense_item_id: UUID,
    image_object_key: str | None,
    image_content_type: str | None = None,
    *,
    variant: ImageVariant = "original",
) -> str | None:
    if not image_object_key:
        return None
    public_url = _build_public_object_url(image_object_key)
    if public_url:
        return public_url

    if variant == "thumb":
        return f"{settings.api_v1_prefix}/catalog/expense-items/{expense_item_id}/image?variant=thumb"
    return f"{settings.api_v1_prefix}/catalog/expense-items/{expense_item_id}/image"


def build_expense_item_image_thumb_path(
    expense_item_id: UUID,
    thumbnail_object_key: str | None,
    thumbnail_content_type: str | None = None,
    *,
    original_object_key: str | None = None,
) -> str | None:
    if thumbnail_object_key:
        return build_expense_item_image_path(
            expense_item_id,
            thumbnail_object_key,
            thumbnail_content_type,
            variant="thumb",
        )
    if original_object_key:
        return f"{settings.api_v1_prefix}/catalog/expense-items/{expense_item_id}/image?variant=thumb"
    return None


def _build_public_object_url(object_key: str | None) -> str | None:
    if not object_key or not settings.rustfs_public_read_enabled:
        return None
    public_base_url = (settings.rustfs_public_base_url or "").strip().rstrip("/")
    if not public_base_url:
        return None
    return (
        f"{public_base_url}/{quote(settings.rustfs_bucket_name.strip(), safe='')}/"
        f"{quote(object_key, safe='/')}"
    )


def _get_bucket_init_lock() -> asyncio.Lock:
    global _bucket_init_lock
    if _bucket_init_lock is None:
        _bucket_init_lock = asyncio.Lock()
    return _bucket_init_lock


def _parse_rustfs_server_domains() -> list[str]:
    raw = (settings.rustfs_server_domains_raw or "").strip()
    if not raw:
        return []
    return [part.strip() for part in raw.split(",") if part.strip()]


def _resolve_rustfs_s3_host_header() -> str | None:
    override = (settings.rustfs_s3_host_header or "").strip()
    if override:
        return override

    for domain in _parse_rustfs_server_domains():
        if domain.endswith(":9000"):
            return domain

    for domain in _parse_rustfs_server_domains():
        if domain.endswith(":9001"):
            host = domain.rsplit(":", 1)[0]
            if host:
                return f"{host}:9000"

    return None


def _effective_rustfs_host_header() -> str:
    return _resolve_rustfs_s3_host_header() or _rustfs_endpoint_host_header()


def _inject_rustfs_s3_host_header(request, **kwargs) -> None:
    host_header = _resolve_rustfs_s3_host_header()
    if host_header:
        request.headers["Host"] = host_header


@lru_cache(maxsize=1)
def _get_storage_client():
    if not settings.rustfs_enabled:
        raise RuntimeError("RustFS is not configured")

    client = boto3.client(
        "s3",
        endpoint_url=settings.rustfs_endpoint_url,
        aws_access_key_id=settings.rustfs_access_key_id,
        aws_secret_access_key=settings.rustfs_secret_access_key,
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
            connect_timeout=settings.rustfs_connect_timeout_seconds,
            read_timeout=settings.rustfs_read_timeout_seconds,
            retries={"max_attempts": 1},
        ),
        region_name=settings.rustfs_region_name,
    )
    if _resolve_rustfs_s3_host_header():
        client.meta.events.register("before-sign.s3.*", _inject_rustfs_s3_host_header)
    return client


def _rustfs_endpoint_host_header() -> str:
    endpoint = (settings.rustfs_endpoint_url or "").strip()
    if not endpoint:
        return ""
    parsed = urlparse(endpoint)
    if parsed.hostname:
        if parsed.port:
            return f"{parsed.hostname}:{parsed.port}"
        return parsed.hostname
    return endpoint.removeprefix("http://").removeprefix("https://").rstrip("/")


def _raise_rustfs_head_bucket_error(exc: ClientError) -> None:
    status_code = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
    if status_code != 400:
        raise exc

    bucket_name = settings.rustfs_bucket_name
    if not S3_BUCKET_NAME_PATTERN.fullmatch(bucket_name):
        raise RuntimeError(
            "RustFS rejected the bucket name. "
            f"'{bucket_name}' is not a valid S3 bucket name. "
            "Use lowercase letters, numbers, and hyphens only."
        ) from exc

    host_header = _effective_rustfs_host_header()
    raise RuntimeError(
        "RustFS rejected the S3 request Host header. "
        f"Endpoint: {settings.rustfs_endpoint_url}, "
        f"Host header sent: {host_header or '(unknown)'}. "
        "Set RUSTFS_SERVER_DOMAINS to include a :9000 entry (or RUSTFS_S3_HOST_HEADER) "
        "and recreate the rustfs container so virtual-host mode accepts it."
    ) from exc


async def ensure_bucket_exists() -> None:
    global _bucket_ready, _public_read_policy_ready

    if not settings.rustfs_enabled:
        return
    if _bucket_ready and (not settings.rustfs_public_read_enabled or _public_read_policy_ready):
        return

    async with _get_bucket_init_lock():
        if _bucket_ready and (not settings.rustfs_public_read_enabled or _public_read_policy_ready):
            return

        client = _get_storage_client()

        def _ensure() -> None:
            if not _bucket_ready:
                try:
                    client.head_bucket(Bucket=settings.rustfs_bucket_name)
                except ClientError as exc:
                    error_code = str(exc.response.get("Error", {}).get("Code", "")).strip()
                    status_code = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
                    if status_code == 400:
                        _raise_rustfs_head_bucket_error(exc)
                    if error_code not in {"404", "NoSuchBucket", "NotFound"}:
                        raise
                    client.create_bucket(Bucket=settings.rustfs_bucket_name)
            if settings.rustfs_public_read_enabled and not _public_read_policy_ready:
                policy = {
                    "Version": "2012-10-17",
                    "Statement": [
                        {
                            "Effect": "Allow",
                            "Principal": "*",
                            "Action": ["s3:GetObject"],
                            "Resource": [
                                f"arn:aws:s3:::{settings.rustfs_bucket_name}/orgs/*",
                                f"arn:aws:s3:::{settings.rustfs_bucket_name}/items/*",
                                f"arn:aws:s3:::{settings.rustfs_bucket_name}/inventory-items/*",
                                f"arn:aws:s3:::{settings.rustfs_bucket_name}/expense-items/*",
                            ],
                        }
                    ],
                }
                client.put_bucket_policy(
                    Bucket=settings.rustfs_bucket_name,
                    Policy=json.dumps(policy),
                )

        try:
            await asyncio.to_thread(_ensure)
        except (ConnectTimeoutError, EndpointConnectionError, ReadTimeoutError) as exc:
            raise RuntimeError(
                "Unable to reach RustFS while checking/creating the bucket. "
                f"Endpoint: {settings.rustfs_endpoint_url}"
            ) from exc
        _bucket_ready = True
        if settings.rustfs_public_read_enabled:
            _public_read_policy_ready = True


def _guess_content_type(filename: str, provided_content_type: str | None = None) -> str:
    if provided_content_type and provided_content_type.startswith("image/"):
        return provided_content_type

    guessed_content_type, _ = mimetypes.guess_type(filename)
    if guessed_content_type and guessed_content_type.startswith("image/"):
        return guessed_content_type

    return "application/octet-stream"


def legacy_object_key(object_key: str) -> str | None:
    """ponytail: strip orgs/{id}/ prefix for pre-migration RustFS keys."""
    if not object_key.startswith("orgs/"):
        return None
    parts = object_key.split("/", 2)
    if len(parts) == 3 and parts[2]:
        return parts[2]
    return None


def _get_object_key(
    item_id: UUID,
    filename: str,
    *,
    variant: ImageVariant,
    prefix: str = "items",
    organization_id: UUID | None = None,
) -> str:
    suffix = Path(filename).suffix.lower() or ".bin"
    leaf = f"{prefix}/{item_id}/{variant}/{uuid7().hex}{suffix}"
    if organization_id is not None:
        return f"orgs/{organization_id}/{leaf}"
    return leaf


def _encode_jpeg(image: Image.Image, *, size: int | None, quality: int) -> bytes:
    target = image
    if size is not None and target.size != (size, size):
        target = target.resize((size, size), Image.Resampling.LANCZOS)
    elif size is None and max(target.size) > settings.item_image_full_max_size:
        target = target.resize(
            (settings.item_image_full_max_size, settings.item_image_full_max_size),
            Image.Resampling.LANCZOS,
        )

    output = BytesIO()
    target.save(output, format="JPEG", quality=quality, optimize=True)
    return output.getvalue()


def _prepare_square_image_variants(content: bytes) -> tuple[bytes, str, bytes, str]:
    try:
        with Image.open(BytesIO(content)) as image:
            image = ImageOps.exif_transpose(image)
            width, height = image.size
            if width != height:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="Item image must use a 1:1 square ratio",
                )
            normalized = image.convert("RGB")
            original = _encode_jpeg(normalized, size=None, quality=88)
            thumbnail = _encode_jpeg(
                normalized,
                size=settings.item_image_thumbnail_size,
                quality=82,
            )
            return original, "image/jpeg", thumbnail, "image/jpeg"
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Uploaded file is not a valid image",
        ) from exc


def _prepare_thumbnail(content: bytes) -> tuple[bytes, str]:
    try:
        with Image.open(BytesIO(content)) as image:
            image = ImageOps.exif_transpose(image)
            width, height = image.size
            if width != height:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="Item image must use a 1:1 square ratio",
                )
            normalized = image.convert("RGB")
            return (
                _encode_jpeg(
                    normalized,
                    size=settings.item_image_thumbnail_size,
                    quality=82,
                ),
                "image/jpeg",
            )
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Stored item image is not a valid image",
        ) from exc


async def _items_table_has_legacy_image_data(db: AsyncSession) -> bool:
    def has_column(sync_session) -> bool:
        connection = sync_session.connection()
        table_names = set(inspect(connection).get_table_names())
        if "items" not in table_names:
            return False
        column_names = {column["name"] for column in inspect(connection).get_columns("items")}
        return "image_data" in column_names

    return await db.run_sync(has_column)


async def _upload_bytes(
    *,
    item_id: UUID,
    filename: str,
    content: bytes,
    content_type: str,
    variant: ImageVariant = "original",
    prefix: str = "items",
    organization_id: UUID | None = None,
) -> tuple[str, str, str]:
    await ensure_bucket_exists()
    object_key = _get_object_key(
        item_id,
        filename,
        variant=variant,
        prefix=prefix,
        organization_id=organization_id,
    )
    resolved_content_type = _guess_content_type(filename, content_type)
    client = _get_storage_client()

    try:
        response = await asyncio.to_thread(
            client.put_object,
            Bucket=settings.rustfs_bucket_name,
            Key=object_key,
            Body=content,
            ContentType=resolved_content_type,
            CacheControl=IMAGE_CACHE_CONTROL,
        )
    except (ConnectTimeoutError, EndpointConnectionError, ReadTimeoutError) as exc:
        raise RuntimeError(
            "Unable to upload image to RustFS. "
            f"Endpoint: {settings.rustfs_endpoint_url}, bucket: {settings.rustfs_bucket_name}"
        ) from exc
    return object_key, resolved_content_type, _normalize_etag(response.get("ETag"), object_key)


async def _delete_object_if_present(object_key: str | None) -> None:
    if not object_key or not settings.rustfs_enabled:
        return

    client = _get_storage_client()
    try:
        await asyncio.to_thread(
            client.delete_object,
            Bucket=settings.rustfs_bucket_name,
            Key=object_key,
        )
    except ClientError:
        logger.warning("Unable to delete stale RustFS object %s", object_key, exc_info=True)
    except (ConnectTimeoutError, EndpointConnectionError, ReadTimeoutError):
        logger.warning("Timed out deleting stale RustFS object %s", object_key, exc_info=True)


def _is_missing_object_error(exc: ClientError) -> bool:
    error_code = str(exc.response.get("Error", {}).get("Code", "")).strip()
    status_code = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
    return status_code == 404 or error_code in {"404", "NoSuchKey", "NotFound"}
