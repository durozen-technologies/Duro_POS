from app.db.storage.images import *  # noqa: F403
from app.db.storage.paths import (
    _delete_object_if_present,
    _get_storage_client,
    _is_missing_object_error,
    _items_table_has_legacy_image_data,
    _normalize_etag,
    _prepare_thumbnail,
    _upload_bytes,
    legacy_object_key,
)


def format_image_last_modified(last_modified: datetime | None) -> str | None:
    if last_modified is None:
        return None
    if last_modified.tzinfo is None:
        last_modified = last_modified.replace(tzinfo=UTC)
    return format_datetime(last_modified.astimezone(UTC), usegmt=True)


def image_response_headers(
    payload: StoredImagePayload | StoredImageStreamPayload,
) -> dict[str, str]:
    headers = {
        "Cache-Control": payload.cache_control,
        "ETag": payload.etag,
        "X-Content-Type-Options": "nosniff",
    }
    last_modified = format_image_last_modified(payload.last_modified)
    if last_modified:
        headers["Last-Modified"] = last_modified
    return headers


def iter_stored_image_stream(
    payload: StoredImageStreamPayload,
    *,
    chunk_size: int = 64 * 1024,
) -> Iterator[bytes]:
    body = payload.body
    read = getattr(body, "read")
    close = getattr(body, "close", None)
    try:
        while True:
            chunk = read(chunk_size)
            if not chunk:
                break
            yield chunk
    finally:
        if callable(close):
            close()


def close_stored_image_stream(payload: StoredImageStreamPayload) -> None:
    close = getattr(payload.body, "close", None)
    if callable(close):
        close()


async def _stream_object(
    object_key: str,
    *,
    fallback_content_type: str | None = None,
) -> StoredImageStreamPayload:
    if not settings.rustfs_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RustFS is not configured",
        )

    client = _get_storage_client()

    def _open_stream() -> StoredImageStreamPayload:
        response = client.get_object(
            Bucket=settings.rustfs_bucket_name,
            Key=object_key,
        )
        content_type = response.get("ContentType") or fallback_content_type or "image/jpeg"
        return StoredImageStreamPayload(
            body=response["Body"],
            content_type=content_type,
            object_key=object_key,
            etag=_normalize_etag(response.get("ETag"), object_key),
            last_modified=response.get("LastModified"),
            cache_control=PROXY_IMAGE_CACHE_CONTROL,
        )

    try:
        return await asyncio.to_thread(_open_stream)
    except (ConnectTimeoutError, EndpointConnectionError, ReadTimeoutError) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RustFS did not respond in time while downloading the image",
        ) from exc
    except ClientError as exc:
        if _is_missing_object_error(exc):
            raise StoredImageObjectNotFoundError(object_key) from exc
        raise


async def _stream_object_resilient(
    object_key: str,
    *,
    fallback_content_type: str | None = None,
) -> StoredImageStreamPayload:
    try:
        return await _stream_object(object_key, fallback_content_type=fallback_content_type)
    except StoredImageObjectNotFoundError:
        legacy_key = legacy_object_key(object_key)
        if legacy_key is None:
            raise
        return await _stream_object(legacy_key, fallback_content_type=fallback_content_type)


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


async def _download_object_resilient(
    object_key: str,
    *,
    fallback_content_type: str | None = None,
) -> StoredImagePayload:
    try:
        return await _download_object(object_key, fallback_content_type=fallback_content_type)
    except StoredImageObjectNotFoundError:
        legacy_key = legacy_object_key(object_key)
        if legacy_key is None:
            raise
        return await _download_object(legacy_key, fallback_content_type=fallback_content_type)


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
) -> StoredImagePayload | StoredImageStreamPayload:
    if item.image_thumbnail_object_key:
        try:
            return await _stream_object_resilient(
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
        original = await _download_object_resilient(
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Image not found"
        ) from exc
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
) -> StoredImagePayload | StoredImageStreamPayload:
    if variant == "thumb":
        return await _get_or_create_thumbnail_payload(db, item, request_id=request_id)
    if not item.image_object_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    try:
        return await _stream_object_resilient(
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Image not found"
        ) from exc


def _log_missing_inventory_image_object(
    *,
    item: InventoryItem,
    variant: ImageVariant,
    object_key: str,
    request_id: str | None,
) -> None:
    logger.warning(
        "RustFS inventory item image object missing item_id=%s variant=%s bucket=%s object_key=%s request_id=%s",
        item.id,
        variant,
        settings.rustfs_bucket_name,
        object_key,
        request_id or "",
    )


async def _commit_stale_inventory_image_metadata_cleanup(
    db: AsyncSession | None,
    item: InventoryItem,
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
            "Unable to clear stale inventory item image metadata item_id=%s request_id=%s",
            item.id,
            request_id or "",
            exc_info=True,
        )


async def _get_or_create_inventory_thumbnail_payload(
    db: AsyncSession | None,
    item: InventoryItem,
    *,
    request_id: str | None = None,
) -> StoredImagePayload | StoredImageStreamPayload:
    if item.image_thumbnail_object_key:
        try:
            return await _stream_object_resilient(
                item.image_thumbnail_object_key,
                fallback_content_type=item.image_thumbnail_content_type,
            )
        except StoredImageObjectNotFoundError as exc:
            _log_missing_inventory_image_object(
                item=item,
                variant="thumb",
                object_key=exc.object_key,
                request_id=request_id,
            )
            await _commit_stale_inventory_image_metadata_cleanup(
                db,
                item,
                clear_original=False,
                clear_thumbnail=True,
                request_id=request_id,
            )

    if not item.image_object_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    try:
        original = await _download_object_resilient(
            item.image_object_key,
            fallback_content_type=item.image_content_type,
        )
    except StoredImageObjectNotFoundError as exc:
        _log_missing_inventory_image_object(
            item=item,
            variant="original",
            object_key=exc.object_key,
            request_id=request_id,
        )
        await _commit_stale_inventory_image_metadata_cleanup(
            db,
            item,
            clear_original=True,
            clear_thumbnail=True,
            request_id=request_id,
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Image not found"
        ) from exc
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
            prefix="inventory-items",
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


async def get_inventory_item_image_response_payload(
    item: InventoryItem,
    *,
    db: AsyncSession | None = None,
    variant: ImageVariant = "original",
    request_id: str | None = None,
) -> StoredImagePayload | StoredImageStreamPayload:
    if variant == "thumb":
        return await _get_or_create_inventory_thumbnail_payload(db, item, request_id=request_id)
    if not item.image_object_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    try:
        return await _stream_object_resilient(
            item.image_object_key,
            fallback_content_type=item.image_content_type,
        )
    except StoredImageObjectNotFoundError as exc:
        _log_missing_inventory_image_object(
            item=item,
            variant="original",
            object_key=exc.object_key,
            request_id=request_id,
        )
        await _commit_stale_inventory_image_metadata_cleanup(
            db,
            item,
            clear_original=True,
            clear_thumbnail=True,
            request_id=request_id,
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Image not found"
        ) from exc


def _log_missing_expense_image_object(
    *,
    item: ExpenseItem,
    variant: ImageVariant,
    object_key: str,
    request_id: str | None,
) -> None:
    logger.warning(
        "RustFS expense item image object missing item_id=%s variant=%s bucket=%s object_key=%s request_id=%s",
        item.id,
        variant,
        settings.rustfs_bucket_name,
        object_key,
        request_id or "",
    )


async def _commit_stale_expense_image_metadata_cleanup(
    db: AsyncSession | None,
    item: ExpenseItem,
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
            "Unable to clear stale expense item image metadata item_id=%s request_id=%s",
            item.id,
            request_id or "",
            exc_info=True,
        )


async def _get_or_create_expense_thumbnail_payload(
    db: AsyncSession | None,
    item: ExpenseItem,
    *,
    request_id: str | None = None,
) -> StoredImagePayload | StoredImageStreamPayload:
    if item.image_thumbnail_object_key:
        try:
            return await _stream_object_resilient(
                item.image_thumbnail_object_key,
                fallback_content_type=item.image_thumbnail_content_type,
            )
        except StoredImageObjectNotFoundError as exc:
            _log_missing_expense_image_object(
                item=item,
                variant="thumb",
                object_key=exc.object_key,
                request_id=request_id,
            )
            await _commit_stale_expense_image_metadata_cleanup(
                db,
                item,
                clear_original=False,
                clear_thumbnail=True,
                request_id=request_id,
            )

    if not item.image_object_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    try:
        original = await _download_object_resilient(
            item.image_object_key,
            fallback_content_type=item.image_content_type,
        )
    except StoredImageObjectNotFoundError as exc:
        _log_missing_expense_image_object(
            item=item,
            variant="original",
            object_key=exc.object_key,
            request_id=request_id,
        )
        await _commit_stale_expense_image_metadata_cleanup(
            db,
            item,
            clear_original=True,
            clear_thumbnail=True,
            request_id=request_id,
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Image not found"
        ) from exc
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
            prefix="expense-items",
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


async def get_expense_item_image_response_payload(
    item: ExpenseItem,
    *,
    db: AsyncSession | None = None,
    variant: ImageVariant = "original",
    request_id: str | None = None,
) -> StoredImagePayload | StoredImageStreamPayload:
    if variant == "thumb":
        return await _get_or_create_expense_thumbnail_payload(db, item, request_id=request_id)
    if not item.image_object_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    try:
        return await _stream_object_resilient(
            item.image_object_key,
            fallback_content_type=item.image_content_type,
        )
    except StoredImageObjectNotFoundError as exc:
        _log_missing_expense_image_object(
            item=item,
            variant="original",
            object_key=exc.object_key,
            request_id=request_id,
        )
        await _commit_stale_expense_image_metadata_cleanup(
            db,
            item,
            clear_original=True,
            clear_thumbnail=True,
            request_id=request_id,
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Image not found"
        ) from exc


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
