from app.db.storage.paths import *  # noqa: F403
from app.db.storage.paths import (
    _delete_object_if_present,
    _guess_content_type,
    _prepare_square_image_variants,
    _upload_bytes,
)


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
            organization_id=item.organization_id,
        )
        uploaded_thumbnail_object_key, thumbnail_content_type, _ = await _upload_bytes(
            item_id=item.id,
            filename=thumbnail_filename,
            content=thumbnail_content,
            content_type=thumbnail_content_type,
            variant="thumb",
            organization_id=item.organization_id,
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


async def save_inventory_item_image_content(
    db: AsyncSession,
    item: InventoryItem,
    *,
    filename: str,
    content: bytes,
    content_type: str | None = None,
    commit: bool = True,
) -> InventoryItemImageRead:
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
            prefix="inventory-items",
            organization_id=item.organization_id,
        )
        uploaded_thumbnail_object_key, thumbnail_content_type, _ = await _upload_bytes(
            item_id=item.id,
            filename=thumbnail_filename,
            content=thumbnail_content,
            content_type=thumbnail_content_type,
            variant="thumb",
            prefix="inventory-items",
            organization_id=item.organization_id,
        )
    except Exception as exc:
        await _delete_object_if_present(uploaded_object_key)
        await _delete_object_if_present(uploaded_thumbnail_object_key)
        logger.warning(
            "Unable to save inventory item image to RustFS item_id=%s bucket=%s endpoint=%s",
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

    return InventoryItemImageRead(
        inventory_item_id=item.id,
        inventory_item_name=item.name,
        inventory_item_tamil_name=item.tamil_name,
        image_path=build_inventory_item_image_path(
            item.id, item.image_object_key, item.image_content_type
        ),
        image_thumb_path=build_inventory_item_image_thumb_path(
            item.id,
            item.image_thumbnail_object_key,
            item.image_thumbnail_content_type,
            original_object_key=item.image_object_key,
        ),
        image_content_type=item.image_content_type,
    )


async def save_inventory_item_image_upload(
    db: AsyncSession,
    item: InventoryItem,
    file: UploadFile,
    *,
    commit: bool = True,
) -> InventoryItemImageRead:
    content = await file.read()
    return await save_inventory_item_image_content(
        db,
        item,
        filename=file.filename or "",
        content=content,
        content_type=file.content_type,
        commit=commit,
    )


async def delete_inventory_item_image(
    db: AsyncSession,
    item_id: UUID,
) -> InventoryItemImageRead:
    item = await db.scalar(
        select(InventoryItem).where(InventoryItem.id == item_id).with_for_update()
    )
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Inventory item not found"
        )

    previous_object_key = item.image_object_key
    previous_thumbnail_object_key = item.image_thumbnail_object_key
    item.image_object_key = None
    item.image_content_type = None
    item.image_thumbnail_object_key = None
    item.image_thumbnail_content_type = None
    await db.commit()
    await _delete_object_if_present(previous_object_key)
    await _delete_object_if_present(previous_thumbnail_object_key)
    return InventoryItemImageRead(
        inventory_item_id=item.id,
        inventory_item_name=item.name,
        inventory_item_tamil_name=item.tamil_name,
        image_path=None,
        image_thumb_path=None,
        image_content_type=None,
    )


async def save_expense_item_image_content(
    db: AsyncSession,
    item: ExpenseItem,
    *,
    filename: str,
    content: bytes,
    content_type: str | None = None,
    commit: bool = True,
) -> ExpenseItemImageRead:
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
            prefix="expense-items",
            organization_id=item.organization_id,
        )
        uploaded_thumbnail_object_key, thumbnail_content_type, _ = await _upload_bytes(
            item_id=item.id,
            filename=thumbnail_filename,
            content=thumbnail_content,
            content_type=thumbnail_content_type,
            variant="thumb",
            prefix="expense-items",
            organization_id=item.organization_id,
        )
    except Exception as exc:
        await _delete_object_if_present(uploaded_object_key)
        await _delete_object_if_present(uploaded_thumbnail_object_key)
        logger.warning(
            "Unable to save expense item image to RustFS item_id=%s bucket=%s endpoint=%s",
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

    return ExpenseItemImageRead(
        expense_item_id=item.id,
        expense_item_name=item.name,
        expense_item_tamil_name=item.tamil_name,
        image_path=build_expense_item_image_path(
            item.id, item.image_object_key, item.image_content_type
        ),
        image_thumb_path=build_expense_item_image_thumb_path(
            item.id,
            item.image_thumbnail_object_key,
            item.image_thumbnail_content_type,
            original_object_key=item.image_object_key,
        ),
        image_content_type=item.image_content_type,
    )


async def save_expense_item_image_upload(
    db: AsyncSession,
    item: ExpenseItem,
    file: UploadFile,
    *,
    commit: bool = True,
) -> ExpenseItemImageRead:
    content = await file.read()
    return await save_expense_item_image_content(
        db,
        item,
        filename=file.filename or "",
        content=content,
        content_type=file.content_type,
        commit=commit,
    )


async def delete_expense_item_image(
    db: AsyncSession,
    item_id: UUID,
) -> ExpenseItemImageRead:
    item = await db.scalar(select(ExpenseItem).where(ExpenseItem.id == item_id).with_for_update())
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Expense item not found")

    previous_object_key = item.image_object_key
    previous_thumbnail_object_key = item.image_thumbnail_object_key
    item.image_object_key = None
    item.image_content_type = None
    item.image_thumbnail_object_key = None
    item.image_thumbnail_content_type = None
    await db.commit()
    await _delete_object_if_present(previous_object_key)
    await _delete_object_if_present(previous_thumbnail_object_key)
    return ExpenseItemImageRead(
        expense_item_id=item.id,
        expense_item_name=item.name,
        expense_item_tamil_name=item.tamil_name,
        image_path=None,
        image_thumb_path=None,
        image_content_type=None,
    )


async def delete_item_image_storage(*object_keys: str | None) -> None:
    for object_key in object_keys:
        await _delete_object_if_present(object_key)
