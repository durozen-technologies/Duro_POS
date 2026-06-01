import asyncio
import json
import logging
import mimetypes
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import format_datetime
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from typing import Literal
from urllib.parse import quote
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

from ..core.config import get_settings
from ..core.ids import uuid7
from ..models import Item
from ..schemas.pricing import ItemImageRead

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


@lru_cache(maxsize=1)
def _get_storage_client():
    if not settings.rustfs_enabled:
        raise RuntimeError("RustFS is not configured")

    return boto3.client(
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
                        raise RuntimeError(
                            "RustFS rejected the bucket name. "
                            f"'{settings.rustfs_bucket_name}' is not a valid S3 bucket name. "
                            "Use lowercase letters, numbers, and hyphens only."
                        ) from exc
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
                            "Resource": [f"arn:aws:s3:::{settings.rustfs_bucket_name}/items/*"],
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


def _get_object_key(item_id: UUID, filename: str, *, variant: ImageVariant) -> str:
    suffix = Path(filename).suffix.lower() or ".bin"
    return f"items/{item_id}/{variant}/{uuid7().hex}{suffix}"


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
) -> tuple[str, str, str]:
    await ensure_bucket_exists()
    object_key = _get_object_key(item_id, filename, variant=variant)
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


async def save_item_image_content(
    db: AsyncSession,
    item: Item,
    *,
    filename: str,
    content: bytes,
    content_type: str | None = None,
    commit: bool = True,
) -> ItemImageRead:
    if not filename:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Image filename is required",
        )
    if not content:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Image file is empty",
        )
    if len(content) > settings.item_image_max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Image file exceeds {settings.item_image_max_bytes} bytes",
        )

    resolved_content_type = _guess_content_type(filename, content_type)
    if not resolved_content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Only image uploads are supported",
        )

    if not settings.rustfs_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RustFS is not configured. Image was not saved.",
        )
    (
        content,
        resolved_content_type,
        thumbnail_content,
        thumbnail_content_type,
    ) = _prepare_square_image_variants(content)
    filename = f"{Path(filename).stem or item.id}.jpg"
    thumbnail_filename = f"{Path(filename).stem or item.id}-thumb.jpg"

    previous_object_key = item.image_object_key
    previous_thumbnail_object_key = item.image_thumbnail_object_key
    uploaded_object_key: str | None = None
    uploaded_thumbnail_object_key: str | None = None

    try:
        uploaded_object_key, resolved_content_type, _ = await _upload_bytes(
            item_id=item.id,
            filename=filename,
            content=content,
            content_type=resolved_content_type,
            variant="original",
        )
        uploaded_thumbnail_object_key, thumbnail_content_type, _ = await _upload_bytes(
            item_id=item.id,
            filename=thumbnail_filename,
            content=thumbnail_content,
            content_type=thumbnail_content_type,
            variant="thumb",
        )
    except Exception as exc:
        await _delete_object_if_present(uploaded_object_key)
        await _delete_object_if_present(uploaded_thumbnail_object_key)
        logger.warning(
            "Unable to save item image to RustFS item_id=%s bucket=%s endpoint=%s",
            item.id,
            settings.rustfs_bucket_name,
            settings.rustfs_endpoint_url,
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RustFS is unavailable. Image was not saved.",
        ) from exc

    item.image_object_key = uploaded_object_key
    item.image_content_type = resolved_content_type
    item.image_thumbnail_object_key = uploaded_thumbnail_object_key
    item.image_thumbnail_content_type = thumbnail_content_type
    try:
        if commit:
            await db.commit()
        else:
            await db.flush()
    except Exception:
        if uploaded_object_key and uploaded_object_key != previous_object_key:
            await _delete_object_if_present(uploaded_object_key)
        if (
            uploaded_thumbnail_object_key
            and uploaded_thumbnail_object_key != previous_thumbnail_object_key
        ):
            await _delete_object_if_present(uploaded_thumbnail_object_key)
        raise

    if commit and previous_object_key and previous_object_key != item.image_object_key:
        await _delete_object_if_present(previous_object_key)
    if (
        commit
        and previous_thumbnail_object_key
        and previous_thumbnail_object_key != item.image_thumbnail_object_key
    ):
        await _delete_object_if_present(previous_thumbnail_object_key)

    return ItemImageRead(
        item_id=item.id,
        item_name=item.name,
        item_tamil_name=item.tamil_name,
        image_path=build_item_image_path(item.id, item.image_object_key, item.image_content_type),
        image_thumb_path=build_item_image_thumb_path(
            item.id,
            item.image_thumbnail_object_key,
            item.image_thumbnail_content_type,
            original_object_key=item.image_object_key,
        ),
        image_content_type=item.image_content_type,
    )


async def save_item_image_upload(
    db: AsyncSession,
    item: Item,
    file: UploadFile,
    *,
    commit: bool = True,
) -> ItemImageRead:
    content = await file.read()
    return await save_item_image_content(
        db,
        item,
        filename=file.filename or "",
        content=content,
        content_type=file.content_type,
        commit=commit,
    )


async def upload_item_image(
    db: AsyncSession,
    item_id: UUID,
    file: UploadFile,
) -> ItemImageRead:
    item = await db.scalar(select(Item).where(Item.id == item_id).with_for_update())
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    return await save_item_image_upload(db, item, file)


async def delete_item_image(db: AsyncSession, item_id: UUID) -> ItemImageRead:
    item = await db.scalar(select(Item).where(Item.id == item_id).with_for_update())
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    previous_object_key = item.image_object_key
    previous_thumbnail_object_key = item.image_thumbnail_object_key
    item.image_object_key = None
    item.image_content_type = None
    item.image_thumbnail_object_key = None
    item.image_thumbnail_content_type = None
    await db.commit()
    await _delete_object_if_present(previous_object_key)
    await _delete_object_if_present(previous_thumbnail_object_key)
    return ItemImageRead(
        item_id=item.id,
        item_name=item.name,
        item_tamil_name=item.tamil_name,
        image_path=None,
        image_thumb_path=None,
        image_content_type=None,
    )


async def delete_item_image_storage(*object_keys: str | None) -> None:
    for object_key in object_keys:
        await _delete_object_if_present(object_key)


def _normalize_etag(etag: str | None, object_key: str) -> str:
    candidate = (etag or "").strip()
    if candidate.startswith('"') and candidate.endswith('"'):
        return candidate
    return f'"{candidate or object_key}"'


def format_image_last_modified(last_modified: datetime | None) -> str | None:
    if last_modified is None:
        return None
    if last_modified.tzinfo is None:
        last_modified = last_modified.replace(tzinfo=UTC)
    return format_datetime(last_modified.astimezone(UTC), usegmt=True)


def image_response_headers(payload: StoredImagePayload) -> dict[str, str]:
    headers = {
        "Cache-Control": payload.cache_control,
        "ETag": payload.etag,
        "X-Content-Type-Options": "nosniff",
    }
    last_modified = format_image_last_modified(payload.last_modified)
    if last_modified:
        headers["Last-Modified"] = last_modified
    return headers


async def _download_object(
    object_key: str,
    *,
    fallback_content_type: str | None = None,
) -> StoredImagePayload:
    if not settings.rustfs_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RustFS is not configured",
        )

    client = _get_storage_client()

    def _download() -> StoredImagePayload:
        response = client.get_object(
            Bucket=settings.rustfs_bucket_name,
            Key=object_key,
        )
        body = response["Body"]
        try:
            payload = body.read()
        finally:
            body.close()

        content_type = response.get("ContentType") or fallback_content_type or "image/jpeg"
        return StoredImagePayload(
            content=payload,
            content_type=content_type,
            object_key=object_key,
            etag=_normalize_etag(response.get("ETag"), object_key),
            last_modified=response.get("LastModified"),
            cache_control=PROXY_IMAGE_CACHE_CONTROL,
        )

    try:
        return await asyncio.to_thread(_download)
    except (ConnectTimeoutError, EndpointConnectionError, ReadTimeoutError) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RustFS did not respond in time while downloading the image",
        ) from exc
    except ClientError as exc:
        if _is_missing_object_error(exc):
            raise StoredImageObjectNotFoundError(object_key) from exc
        raise


def _log_missing_image_object(
    *,
    item: Item,
    variant: ImageVariant,
    object_key: str,
    request_id: str | None,
) -> None:
    logger.warning(
        "RustFS item image object missing item_id=%s variant=%s bucket=%s object_key=%s request_id=%s",
        item.id,
        variant,
        settings.rustfs_bucket_name,
        object_key,
        request_id or "",
    )


async def _commit_stale_image_metadata_cleanup(
    db: AsyncSession | None,
    item: Item,
    *,
    clear_original: bool,
    clear_thumbnail: bool,
    request_id: str | None,
) -> None:
    if clear_original:
        item.image_object_key = None
        item.image_content_type = None
    if clear_thumbnail or clear_original:
        item.image_thumbnail_object_key = None
        item.image_thumbnail_content_type = None
    if db is None:
        return

    try:
        await db.commit()
    except Exception:
        await db.rollback()
        logger.warning(
            "Unable to clear stale item image metadata item_id=%s request_id=%s",
            item.id,
            request_id or "",
            exc_info=True,
        )


async def _get_or_create_thumbnail_payload(
    db: AsyncSession | None,
    item: Item,
    *,
    request_id: str | None = None,
) -> StoredImagePayload:
    if item.image_thumbnail_object_key:
        try:
            return await _download_object(
                item.image_thumbnail_object_key,
                fallback_content_type=item.image_thumbnail_content_type,
            )
        except StoredImageObjectNotFoundError as exc:
            _log_missing_image_object(
                item=item,
                variant="thumb",
                object_key=exc.object_key,
                request_id=request_id,
            )
            await _commit_stale_image_metadata_cleanup(
                db,
                item,
                clear_original=False,
                clear_thumbnail=True,
                request_id=request_id,
            )

    if not item.image_object_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    try:
        original = await _download_object(
            item.image_object_key,
            fallback_content_type=item.image_content_type,
        )
    except StoredImageObjectNotFoundError as exc:
        _log_missing_image_object(
            item=item,
            variant="original",
            object_key=exc.object_key,
            request_id=request_id,
        )
        await _commit_stale_image_metadata_cleanup(
            db,
            item,
            clear_original=True,
            clear_thumbnail=True,
            request_id=request_id,
        )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found") from exc
    thumbnail_content, thumbnail_content_type = _prepare_thumbnail(original.content)
    uploaded_thumbnail_object_key: str | None = None

    if db is None:
        transient_key = f"{item.image_object_key}:thumb"
        return StoredImagePayload(
            content=thumbnail_content,
            content_type=thumbnail_content_type,
            object_key=transient_key,
            etag=_normalize_etag(None, transient_key),
            last_modified=datetime.now(UTC),
            cache_control=PROXY_IMAGE_CACHE_CONTROL,
        )

    try:
        uploaded_thumbnail_object_key, thumbnail_content_type, thumbnail_etag = await _upload_bytes(
            item_id=item.id,
            filename=f"{item.id}-thumb.jpg",
            content=thumbnail_content,
            content_type=thumbnail_content_type,
            variant="thumb",
        )
        item.image_thumbnail_object_key = uploaded_thumbnail_object_key
        item.image_thumbnail_content_type = thumbnail_content_type
        try:
            await db.commit()
        except Exception:
            await db.rollback()
            raise
    except Exception:
        await _delete_object_if_present(uploaded_thumbnail_object_key)
        raise

    return StoredImagePayload(
        content=thumbnail_content,
        content_type=thumbnail_content_type,
        object_key=uploaded_thumbnail_object_key,
        etag=thumbnail_etag,
        last_modified=datetime.now(UTC),
        cache_control=PROXY_IMAGE_CACHE_CONTROL,
    )


async def get_item_image_response_payload(
    item: Item,
    *,
    db: AsyncSession | None = None,
    variant: ImageVariant = "original",
    request_id: str | None = None,
) -> StoredImagePayload:
    if variant == "thumb":
        return await _get_or_create_thumbnail_payload(db, item, request_id=request_id)
    if not item.image_object_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    try:
        return await _download_object(
            item.image_object_key,
            fallback_content_type=item.image_content_type,
        )
    except StoredImageObjectNotFoundError as exc:
        _log_missing_image_object(
            item=item,
            variant="original",
            object_key=exc.object_key,
            request_id=request_id,
        )
        await _commit_stale_image_metadata_cleanup(
            db,
            item,
            clear_original=True,
            clear_thumbnail=True,
            request_id=request_id,
        )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found") from exc


async def backfill_item_image_thumbnails(db: AsyncSession, *, limit: int = 50) -> int:
    if limit < 1:
        raise ValueError("limit must be greater than 0")
    if not settings.rustfs_enabled:
        return 0

    items = (
        await db.scalars(
            select(Item)
            .where(
                Item.image_object_key.is_not(None),
                Item.image_thumbnail_object_key.is_(None),
            )
            .order_by(Item.created_at.asc(), Item.id.asc())
            .limit(limit)
        )
    ).all()
    processed_count = 0
    for item in items:
        try:
            await get_item_image_response_payload(item, db=db, variant="thumb")
        except HTTPException:
            logger.warning("Unable to backfill thumbnail for item %s.", item.id, exc_info=True)
            continue
        processed_count += 1
    return processed_count


async def migrate_item_image_data_to_rustfs(db: AsyncSession) -> int:
    if not settings.rustfs_enabled:
        return 0

    if not await _items_table_has_legacy_image_data(db):
        return 0

    rows = await db.execute(
        text(
            """
            SELECT id, image_data, image_object_key, image_content_type
            FROM items
            WHERE image_data IS NOT NULL
            """
        )
    )
    processed_count = 0
    uploaded_object_keys: list[str] = []

    for row in rows.mappings().all():
        existing_object_key = row["image_object_key"]
        image_data = bytes(row["image_data"] or b"")
        object_key = existing_object_key
        content_type = row["image_content_type"] or "application/octet-stream"

        if not object_key and image_data:
            try:
                object_key, content_type, _ = await _upload_bytes(
                    item_id=row["id"],
                    filename=f"{row['id']}{mimetypes.guess_extension(row['image_content_type'] or '') or '.bin'}",
                    content=image_data,
                    content_type=content_type,
                )
            except Exception:
                logger.warning(
                    "Unable to migrate database image for item %s to RustFS.",
                    row["id"],
                    exc_info=True,
                )
                continue
            uploaded_object_keys.append(object_key)

        await db.execute(
            text(
                """
                UPDATE items
                SET image_object_key = :image_object_key,
                    image_content_type = :image_content_type,
                    image_data = NULL
                WHERE id = :item_id
                """
            ),
            {
                "image_object_key": object_key,
                "image_content_type": content_type,
                "item_id": row["id"],
            },
        )
        processed_count += 1

    if processed_count:
        try:
            await db.commit()
        except SQLAlchemyError:
            for object_key in uploaded_object_keys:
                await _delete_object_if_present(object_key)
            raise

    return processed_count
