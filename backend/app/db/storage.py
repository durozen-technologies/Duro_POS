import asyncio
import logging
import mimetypes
from functools import lru_cache
from pathlib import Path
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
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Item
from app.schemas.pricing import ItemImageRead

settings = get_settings()
logger = logging.getLogger(__name__)

_bucket_ready = False
_bucket_init_lock: asyncio.Lock | None = None


def build_item_image_path(
    item_id: UUID,
    image_object_key: str | None,
    image_content_type: str | None = None,
) -> str | None:
    if not image_object_key and not image_content_type:
        return None
    return f"{settings.api_v1_prefix}/catalog/items/{item_id}/image"


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
    global _bucket_ready

    if _bucket_ready or not settings.rustfs_enabled:
        return

    async with _get_bucket_init_lock():
        if _bucket_ready:
            return

        client = _get_storage_client()

        def _ensure() -> None:
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

        try:
            await asyncio.to_thread(_ensure)
        except (ConnectTimeoutError, EndpointConnectionError, ReadTimeoutError) as exc:
            raise RuntimeError(
                "Unable to reach RustFS while checking/creating the bucket. "
                f"Endpoint: {settings.rustfs_endpoint_url}"
            ) from exc
        _bucket_ready = True


def _guess_content_type(filename: str, provided_content_type: str | None = None) -> str:
    if provided_content_type and provided_content_type.startswith("image/"):
        return provided_content_type

    guessed_content_type, _ = mimetypes.guess_type(filename)
    if guessed_content_type and guessed_content_type.startswith("image/"):
        return guessed_content_type

    return "application/octet-stream"


def _get_object_key(item_id: UUID, filename: str) -> str:
    suffix = Path(filename).suffix.lower() or ".bin"
    return f"items/{item_id}/image{suffix}"


async def _upload_bytes(
    *,
    item_id: UUID,
    filename: str,
    content: bytes,
    content_type: str,
) -> tuple[str, str]:
    await ensure_bucket_exists()
    object_key = _get_object_key(item_id, filename)
    resolved_content_type = _guess_content_type(filename, content_type)
    client = _get_storage_client()

    try:
        await asyncio.to_thread(
            client.put_object,
            Bucket=settings.rustfs_bucket_name,
            Key=object_key,
            Body=content,
            ContentType=resolved_content_type,
        )
    except (ConnectTimeoutError, EndpointConnectionError, ReadTimeoutError) as exc:
        raise RuntimeError(
            "Unable to upload image to RustFS. "
            f"Endpoint: {settings.rustfs_endpoint_url}, bucket: {settings.rustfs_bucket_name}"
        ) from exc
    return object_key, resolved_content_type


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

    previous_object_key = item.image_object_key
    stored_content_type = resolved_content_type
    object_key: str | None = None

    if settings.rustfs_enabled:
        try:
            object_key, stored_content_type = await _upload_bytes(
                item_id=item.id,
                filename=filename,
                content=content,
                content_type=resolved_content_type,
            )
        except Exception:
            logger.warning(
                "Unable to mirror image for item %s to RustFS; keeping database copy only.",
                item.id,
                exc_info=True,
            )

    item.image_data = content
    item.image_object_key = object_key
    item.image_content_type = stored_content_type
    if commit:
        await db.commit()
    else:
        await db.flush()

    if commit and previous_object_key and previous_object_key != object_key:
        await _delete_object_if_present(previous_object_key)

    return ItemImageRead(
        item_id=item.id,
        item_name=item.name,
        image_path=build_item_image_path(item.id, item.image_object_key, item.image_content_type),
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


async def delete_item_image_storage(object_key: str | None) -> None:
    await _delete_object_if_present(object_key)


async def get_item_image_response_payload(item: Item) -> tuple[bytes, str]:
    if item.image_data:
        return item.image_data, item.image_content_type or "image/jpeg"

    if not item.image_object_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    if not settings.rustfs_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    client = _get_storage_client()

    def _download() -> tuple[bytes, str]:
        response = client.get_object(
            Bucket=settings.rustfs_bucket_name,
            Key=item.image_object_key,
        )
        body = response["Body"]
        try:
            payload = body.read()
        finally:
            body.close()

        content_type = response.get("ContentType") or item.image_content_type or "image/jpeg"
        return payload, content_type

    try:
        return await asyncio.to_thread(_download)
    except (ConnectTimeoutError, EndpointConnectionError, ReadTimeoutError) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RustFS did not respond in time while downloading the image",
        ) from exc
    except ClientError as exc:
        error_code = str(exc.response.get("Error", {}).get("Code", "")).strip()
        if error_code in {"404", "NoSuchKey", "NotFound"}:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Image not found"
            ) from exc
        raise
