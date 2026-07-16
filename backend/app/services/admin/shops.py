from uuid import UUID

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import contains_eager

from app.core.security import get_password_hash
from app.db.storage import (
    delete_item_image_storage,
    save_item_image_upload,
)
from app.db.tenant_schema import tenant_router
from app.models import (
    BaseUnit,
    Bill,
    BillItem,
    DailyPrice,
    InventoryItem,
    InventoryItemCategory,
    Item,
    Shop,
    ShopItemAllocation,
    UnitType,
    User,
    UserRole,
)
from app.schemas.admin import (
    ItemAssumptionUpdate,
    ItemCreate,
    ItemMetadataUpdate,
    ItemRead,
    ItemUpdate,
    ShopCreate,
    ShopRead,
    ShopUpdate,
)
from app.services.admin._shared import (
    _ensure_unique_item_name,
    _item_to_read,
    _item_to_read_async,
    _json_safe_item_state,
    _normalize_item_name,
    _normalize_tamil_item_name,
    _record_item_event,
    _resolve_item_category,
    _shop_to_read,
)
from app.services.session_invalidation import invalidate_user_sessions
from app.services.super_admin.organizations import assert_organization_can_add_branch
from app.services.global_image_templates import require_active_template
from app.services.tenant_query import resolve_organization_id
from app.services.user_auth_index import upsert_auth_index, username_is_globally_taken


async def create_shop_account(db: AsyncSession, payload: ShopCreate, actor: User) -> ShopRead:
    username = payload.username
    shop_name = payload.name.strip()

    if len(shop_name) < 2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Shop name is required"
        )
    if len(username) < 3:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Username is required"
        )

    if actor.organization_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant admin is not linked to an organization",
        )

    await assert_organization_can_add_branch(db, actor.organization_id)

    if await username_is_globally_taken(db, username):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")

    user = User(
        username=username,
        password_hash=get_password_hash(payload.password),
        role=UserRole.SHOP_ACCOUNT,
        organization_id=actor.organization_id,
        is_active=True,
    )
    shop = Shop(
        name=shop_name,
        owner=user,
        organization_id=actor.organization_id,
        is_active=True,
    )
    db.add_all([user, shop])
    await db.flush()
    schema_name = await tenant_router.resolve_schema(db, actor.organization_id)
    if schema_name:
        await upsert_auth_index(db, user=user, schema_name=schema_name)
    await db.commit()
    return _shop_to_read(shop)


async def update_shop_account(
    db: AsyncSession, shop_id: UUID, organization_id: UUID, payload: ShopUpdate
) -> ShopRead:
    """Update a shop's name, username, and optionally its password.

    Uses a single JOIN SELECT with ``with_for_update()`` to avoid the
    two-round-trip ``db.get`` + ``joinedload`` pattern and to prevent
    concurrent-edit races (lost-update).

    Length validation is intentionally omitted here — ``ShopUpdate`` already
    enforces ``min_length`` via Pydantic ``Field``, so the request is rejected
    before this function is ever called.
    """
    result = await db.execute(
        select(Shop)
        .join(Shop.owner)
        .options(contains_eager(Shop.owner))
        .where(Shop.id == shop_id, Shop.organization_id == organization_id)
        .with_for_update()
    )
    shop = result.scalar_one_or_none()
    if shop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shop not found")

    username = payload.username
    shop_name = payload.name.strip()
    new_password = payload.password

    has_changes = False
    username_changed = False

    if shop.name != shop_name:
        shop.name = shop_name
        has_changes = True

    if shop.owner.username != username:
        if await username_is_globally_taken(db, username, exclude_user_id=shop.owner.id):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Username already exists"
            )
        shop.owner.username = username
        has_changes = True
        username_changed = True

    if new_password is not None:
        shop.owner.password_hash = get_password_hash(new_password)
        await invalidate_user_sessions(shop.owner)
        has_changes = True

    if not has_changes:
        return _shop_to_read(shop)

    await db.flush()  # batch both UPDATEs before the commit
    if username_changed and shop.owner.organization_id is not None:
        schema_name = await tenant_router.resolve_schema(db, shop.owner.organization_id)
        if schema_name:
            await upsert_auth_index(db, user=shop.owner, schema_name=schema_name)
    await db.commit()
    return _shop_to_read(shop)


async def delete_shop_account(db: AsyncSession, shop_id: UUID, organization_id: UUID) -> None:
    """Delete a shop and its owner user in one transaction.

    Improvements over the previous version:
    - Single JOIN SELECT with ``with_for_update()`` instead of
      two-round-trip ``db.get`` + ``joinedload``.
    - Bills and prices guard checks are folded into one ``SELECT`` with
      two ``EXISTS`` predicates, avoiding an extra round-trip entirely.
    - Removed the no-op ``db.flush()`` before the deletes (no dirty
      ORM state exists at that point).
    """
    result = await db.execute(
        select(Shop)
        .join(Shop.owner)
        .options(contains_eager(Shop.owner))
        .where(Shop.id == shop_id, Shop.organization_id == organization_id)
        .with_for_update()
    )
    shop = result.scalar_one_or_none()
    if shop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shop not found")

    existence_row = (
        await db.execute(
            select(
                select(Bill.id).where(Bill.shop_id == shop_id).exists().label("has_bills"),
                select(DailyPrice.id)
                .where(DailyPrice.shop_id == shop_id)
                .exists()
                .label("has_prices"),
            )
        )
    ).one()
    has_bills, has_prices = existence_row

    if has_bills:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete a shop that already has billing history",
        )
    if has_prices:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete a shop that already has price history",
        )

    await db.delete(shop)
    await db.delete(shop.owner)
    await db.commit()


async def list_shops(db: AsyncSession, organization_id: UUID) -> list[ShopRead]:
    """Return all shops projected to ShopRead in a single flat query.

    Uses a column-level projection instead of ``joinedload`` so only the
    columns required by ``ShopRead`` are fetched from the DB — the full
    ``User`` row (including ``hashed_password``, ``role``, etc.) is never
    loaded into Python memory.
    """
    rows = await db.execute(
        select(
            Shop.id,
            Shop.name,
            Shop.is_active,
            Shop.created_at,
            User.username,
            User.last_login_at,
        )
        .join(Shop.owner)
        .where(Shop.organization_id == organization_id)
        .order_by(Shop.id.asc())
    )
    return [
        ShopRead(
            id=r["id"],
            name=r["name"],
            is_active=r["is_active"],
            created_at=r["created_at"],
            username=r["username"],
            last_active_at=r["last_login_at"],
        )
        for r in rows.mappings()
    ]


async def get_shop_by_id(db: AsyncSession, shop_id: UUID, organization_id: UUID) -> ShopRead:
    """Fetch a single shop by PK using a flat projection JOIN.

    One SQL JOIN selecting only the columns ShopRead needs — no ORM object
    instantiation, no secondary SELECT for the owner row.
    """
    row = await db.execute(
        select(
            Shop.id,
            Shop.name,
            Shop.is_active,
            Shop.created_at,
            User.username,
            User.last_login_at,
        )
        .join(Shop.owner)
        .where(Shop.id == shop_id, Shop.organization_id == organization_id)
    )
    result = row.mappings().one_or_none()
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shop not found")

    return ShopRead(
        id=result["id"],
        name=result["name"],
        is_active=result["is_active"],
        created_at=result["created_at"],
        username=result["username"],
        last_active_at=result["last_login_at"],
    )


async def create_item(
    db: AsyncSession,
    payload: ItemCreate,
    image: UploadFile | None = None,
    shop_id: UUID | None = None,
    organization_id: UUID | None = None,
    global_image_template_id: UUID | None = None,
    platform_db: AsyncSession | None = None,
) -> ItemRead:
    org_id = organization_id or await resolve_organization_id(db, shop_id=shop_id)
    item_name = _normalize_item_name(payload.name)
    await _ensure_unique_item_name(db, item_name, shop_id=shop_id, organization_id=org_id)
    item_category = await _resolve_item_category(
        db,
        category_id=payload.category_id,
        category_name=payload.category,
        organization_id=org_id,
    )

    item = Item(
        shop_id=shop_id,
        organization_id=org_id,
        name=item_name,
        tamil_name=_normalize_tamil_item_name(payload.tamil_name),
        unit_type=payload.unit_type,
        base_unit=payload.base_unit,
        sort_order=payload.sort_order,
        category_id=item_category.id if item_category is not None else None,
        category=item_category.name if item_category is not None else None,
        category_ref=item_category,
        is_active=payload.is_active,
        custom_attributes=dict(payload.custom_attributes),
    )
    uploaded_image_object_key: str | None = None
    uploaded_thumbnail_object_key: str | None = None

    try:
        db.add(item)
        await db.flush()
        if image is not None:
            await save_item_image_upload(db, item, image, commit=False)
            uploaded_image_object_key = item.image_object_key
            uploaded_thumbnail_object_key = item.image_thumbnail_object_key
        elif global_image_template_id is not None:
            if platform_db is None:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Platform database session is required for global image templates",
                )
            await require_active_template(platform_db, global_image_template_id)
            item.global_image_template_id = global_image_template_id
        _record_item_event(
            db,
            item_id=item.id,
            shop_id=shop_id,
            event_type="item.created",
            after=_json_safe_item_state(item),
        )
        await db.commit()
        return await _item_to_read_async(item, platform_db=platform_db)
    except IntegrityError:
        await db.rollback()
        await delete_item_image_storage(uploaded_image_object_key, uploaded_thumbnail_object_key)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Item name already exists",
        ) from None
    except Exception:
        await db.rollback()
        await delete_item_image_storage(uploaded_image_object_key, uploaded_thumbnail_object_key)
        raise


async def update_item(
    db: AsyncSession,
    item_id: UUID,
    payload: ItemUpdate,
    image: UploadFile | None = None,
    shop_id: UUID | None = None,
    remove_image: bool = False,
    global_image_template_id: UUID | None | object = ...,
    platform_db: AsyncSession | None = None,
) -> ItemRead:
    filters = [Item.id == item_id]
    if shop_id is not None:
        filters.append(Item.shop_id == shop_id)
    else:
        filters.append(Item.shop_id.is_(None))
    item = await db.scalar(select(Item).where(*filters).with_for_update())
    if item is None:
        if shop_id is None:
            shop_owned = await db.scalar(
                select(Item.id).where(Item.id == item_id, Item.shop_id.is_not(None))
            )
            if shop_owned is not None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=(
                        "Item not found in catalogue. "
                        "Use the shop item update endpoint for shop-owned items."
                    ),
                )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    item_name = _normalize_item_name(payload.name)
    tamil_name = _normalize_tamil_item_name(payload.tamil_name)
    item_category = await _resolve_item_category(
        db,
        category_id=payload.category_id,
        category_name=payload.category,
        organization_id=item.organization_id,
    )
    category_name = item_category.name if item_category is not None else None
    name_changed = item.name != item_name
    configuration_changed = (
        name_changed
        or item.tamil_name != tamil_name
        or item.unit_type != payload.unit_type
        or item.base_unit != payload.base_unit
        or item.sort_order != payload.sort_order
        or item.category_id != (item_category.id if item_category is not None else None)
        or item.category != category_name
        or item.is_active != payload.is_active
        or dict(item.custom_attributes or {}) != dict(payload.custom_attributes)
    )

    if name_changed and item.name.lower() != item_name.lower():
        await _ensure_unique_item_name(
            db,
            item_name,
            shop_id=shop_id,
            organization_id=item.organization_id,
            exclude_item_id=item_id,
        )

    should_remove_image = (
        remove_image
        and image is None
        and (
            bool(item.image_object_key or item.image_thumbnail_object_key)
            or item.global_image_template_id is not None
        )
    )
    template_selection_changed = global_image_template_id is not ...
    if not configuration_changed and image is None and not should_remove_image and not template_selection_changed:
        return await _item_to_read_async(item, platform_db=platform_db)

    if shop_id is None and item.is_active and not payload.is_active:
        from app.services.admin.catalogue import remove_catalogue_item_from_all_shop_billing

        await remove_catalogue_item_from_all_shop_billing(db, item_id)

    previous_image_object_key = item.image_object_key
    previous_thumbnail_object_key = item.image_thumbnail_object_key
    uploaded_image_object_key: str | None = None
    uploaded_thumbnail_object_key: str | None = None
    previous_state = _json_safe_item_state(item)

    try:
        item.name = item_name
        item.tamil_name = tamil_name
        item.unit_type = payload.unit_type
        item.base_unit = payload.base_unit
        item.sort_order = payload.sort_order
        item.category_ref = item_category
        item.category_id = item_category.id if item_category is not None else None
        item.category = category_name
        item.is_active = payload.is_active
        item.custom_attributes = dict(payload.custom_attributes)
        if should_remove_image:
            item.image_object_key = None
            item.image_content_type = None
            item.image_thumbnail_object_key = None
            item.image_thumbnail_content_type = None
            item.global_image_template_id = None
        elif template_selection_changed:
            if global_image_template_id is None:
                item.global_image_template_id = None
            else:
                if platform_db is None:
                    raise HTTPException(
                        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                        detail="Platform database session is required for global image templates",
                    )
                await require_active_template(platform_db, global_image_template_id)
                item.global_image_template_id = global_image_template_id
                item.image_object_key = None
                item.image_content_type = None
                item.image_thumbnail_object_key = None
                item.image_thumbnail_content_type = None
        await db.flush()
        if image is not None:
            await save_item_image_upload(db, item, image, commit=False)
            uploaded_image_object_key = item.image_object_key
            uploaded_thumbnail_object_key = item.image_thumbnail_object_key
        _record_item_event(
            db,
            item_id=item.id,
            shop_id=item.shop_id,
            event_type="item.updated",
            before=previous_state,
            after=_json_safe_item_state(item),
        )
        await db.commit()
        if (
            (image is not None or should_remove_image)
            and previous_image_object_key
            and previous_image_object_key != item.image_object_key
        ):
            await delete_item_image_storage(previous_image_object_key)
        if (
            (image is not None or should_remove_image)
            and previous_thumbnail_object_key
            and previous_thumbnail_object_key != item.image_thumbnail_object_key
        ):
            await delete_item_image_storage(previous_thumbnail_object_key)
        if template_selection_changed and global_image_template_id is not ...:
            await delete_item_image_storage(
                previous_image_object_key,
                previous_thumbnail_object_key,
            )
        return await _item_to_read_async(item, platform_db=platform_db)
    except Exception:
        await db.rollback()
        if uploaded_image_object_key and uploaded_image_object_key != previous_image_object_key:
            await delete_item_image_storage(uploaded_image_object_key)
        if (
            uploaded_thumbnail_object_key
            and uploaded_thumbnail_object_key != previous_thumbnail_object_key
        ):
            await delete_item_image_storage(uploaded_thumbnail_object_key)
        raise


async def update_item_metadata(
    db: AsyncSession,
    item_id: UUID,
    payload: ItemMetadataUpdate,
    *,
    shop_id: UUID | None = None,
    platform_db: AsyncSession | None = None,
) -> ItemRead:
    filters = [Item.id == item_id]
    if shop_id is not None:
        # Shop-owned item must match the shop path.
        filters.append(Item.shop_id == shop_id)
    else:
        # Catalogue metadata path only updates global catalogue rows.
        filters.append(Item.shop_id.is_(None))
    item = await db.scalar(select(Item).where(*filters).with_for_update())
    if item is None:
        # ponytail: clearer hint when wrong endpoint is used for shop-owned items
        if shop_id is None:
            shop_owned = await db.scalar(
                select(Item.id).where(Item.id == item_id, Item.shop_id.is_not(None))
            )
            if shop_owned is not None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=(
                        "Item not found in catalogue. "
                        "Use the shop item metadata endpoint for shop-owned items."
                    ),
                )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    previous_state = _json_safe_item_state(item)
    next_name = _normalize_item_name(payload.name) if payload.name is not None else item.name
    next_tamil_name = (
        _normalize_tamil_item_name(payload.tamil_name)
        if payload.tamil_name is not None
        else item.tamil_name
    )
    category_fields_set = (
        "category_id" in payload.model_fields_set or "category" in payload.model_fields_set
    )
    next_category = (
        await _resolve_item_category(
            db,
            category_id=payload.category_id,
            category_name=payload.category,
            organization_id=item.organization_id,
        )
        if category_fields_set
        else None
    )
    next_category_id = (
        (next_category.id if next_category is not None else None)
        if category_fields_set
        else item.category_id
    )
    next_category_name = (
        (next_category.name if next_category is not None else None)
        if category_fields_set
        else item.category
    )
    next_unit_type = payload.unit_type if payload.unit_type is not None else item.unit_type
    next_base_unit = payload.base_unit if payload.base_unit is not None else item.base_unit
    next_is_active = payload.is_active if payload.is_active is not None else item.is_active
    next_sort_order = payload.sort_order if payload.sort_order is not None else item.sort_order
    next_custom_attributes = (
        dict(payload.custom_attributes)
        if payload.custom_attributes is not None
        else dict(item.custom_attributes or {})
    )

    if next_unit_type == UnitType.WEIGHT and next_base_unit != BaseUnit.KG:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Weight items must use kg as the base unit",
        )
    if next_unit_type == UnitType.COUNT and next_base_unit != BaseUnit.UNIT:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Count items must use unit as the base unit",
        )

    if next_name.lower() != item.name.lower():
        await _ensure_unique_item_name(
            db,
            next_name,
            shop_id=shop_id,
            organization_id=item.organization_id,
            exclude_item_id=item_id,
        )

    configuration_changed = (
        item.name != next_name
        or item.tamil_name != next_tamil_name
        or item.unit_type != next_unit_type
        or item.base_unit != next_base_unit
        or item.category_id != next_category_id
        or item.category != next_category_name
        or item.is_active != next_is_active
        or item.sort_order != next_sort_order
        or dict(item.custom_attributes or {}) != next_custom_attributes
    )
    template_selection_changed = "use_global_image_template" in payload.model_fields_set
    if not configuration_changed and not template_selection_changed:
        return await _item_to_read_async(item, platform_db=platform_db)

    if shop_id is None and item.is_active and not next_is_active:
        from app.services.admin.catalogue import remove_catalogue_item_from_all_shop_billing

        await remove_catalogue_item_from_all_shop_billing(db, item_id)

    if configuration_changed:
        item.name = next_name
        item.tamil_name = next_tamil_name
        item.unit_type = next_unit_type
        item.base_unit = next_base_unit
        item.is_active = next_is_active
        item.sort_order = next_sort_order
        if category_fields_set:
            item.category_ref = next_category
            item.category_id = next_category_id
            item.category = next_category_name
        item.custom_attributes = next_custom_attributes

    if template_selection_changed:
        if not payload.use_global_image_template:
            pass
        elif payload.global_image_template_id is None:
            item.global_image_template_id = None
        else:
            if platform_db is None:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Platform database session is required for global image templates",
                )
            await require_active_template(platform_db, payload.global_image_template_id)
            item.global_image_template_id = payload.global_image_template_id
            item.image_object_key = None
            item.image_content_type = None
            item.image_thumbnail_object_key = None
            item.image_thumbnail_content_type = None

    await db.flush()
    _record_item_event(
        db,
        item_id=item.id,
        shop_id=item.shop_id,
        event_type="item.metadata_updated",
        before=previous_state,
        after=_json_safe_item_state(item),
    )
    await db.commit()
    return await _item_to_read_async(item, platform_db=platform_db)


async def update_item_assumption(
    db: AsyncSession,
    item_id: UUID,
    payload: ItemAssumptionUpdate,
) -> ItemRead:
    item = await db.scalar(
        select(Item).where(Item.id == item_id, Item.shop_id.is_(None)).with_for_update()
    )
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    is_clear = (
        payload.assumption_percent is None
        and payload.assumption_inventory_item_id is None
        and payload.assumption_inventory_category_id is None
    )
    previous_state = _json_safe_item_state(item)

    if is_clear:
        if (
            item.assumption_percent is None
            and item.assumption_inventory_item_id is None
            and item.assumption_inventory_category_id is None
        ):
            return _item_to_read(item)
        item.assumption_percent = None
        item.assumption_inventory_item_id = None
        item.assumption_inventory_category_id = None
        await db.flush()
        _record_item_event(
            db,
            item_id=item.id,
            shop_id=item.shop_id,
            event_type="item.assumption_cleared",
            before=previous_state,
            after=_json_safe_item_state(item),
        )
        await db.commit()
        return _item_to_read(item)

    if item.base_unit != BaseUnit.KG or item.unit_type != UnitType.WEIGHT:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Assumptions can only be configured for kg items",
        )

    if payload.assumption_inventory_item_id is not None:
        inventory_item = await db.get(InventoryItem, payload.assumption_inventory_item_id)
        if inventory_item is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Inventory item not found",
            )
        if inventory_item.base_unit != BaseUnit.KG or inventory_item.unit_type != UnitType.WEIGHT:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Assumption inventory item must be a kg item",
            )

        category_link = await db.scalar(
            select(InventoryItemCategory.id).where(
                InventoryItemCategory.inventory_item_id == inventory_item.id,
                InventoryItemCategory.category_id == payload.assumption_inventory_category_id,
            )
        )
        if category_link is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Inventory category is not linked to this item",
            )

    changed = (
        item.assumption_percent != payload.assumption_percent
        or item.assumption_inventory_item_id != payload.assumption_inventory_item_id
        or item.assumption_inventory_category_id != payload.assumption_inventory_category_id
    )
    if not changed:
        return _item_to_read(item)

    item.assumption_percent = payload.assumption_percent
    item.assumption_inventory_item_id = payload.assumption_inventory_item_id
    item.assumption_inventory_category_id = payload.assumption_inventory_category_id
    await db.flush()
    _record_item_event(
        db,
        item_id=item.id,
        shop_id=item.shop_id,
        event_type="item.assumption_updated",
        before=previous_state,
        after=_json_safe_item_state(item),
    )
    await db.commit()
    return _item_to_read(item)


async def delete_item(db: AsyncSession, item_id: UUID, shop_id: UUID | None = None) -> None:
    filters = [Item.id == item_id]
    if shop_id is not None:
        filters.append(Item.shop_id == shop_id)
    else:
        filters.append(Item.shop_id.is_(None))
    item = await db.scalar(select(Item).where(*filters).with_for_update())
    if item is None:
        if shop_id is None:
            shop_owned = await db.scalar(
                select(Item.id).where(Item.id == item_id, Item.shop_id.is_not(None))
            )
            if shop_owned is not None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=(
                        "Item not found in catalogue. "
                        "Use the shop item delete endpoint for shop-owned items."
                    ),
                )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    existence_row = (
        await db.execute(
            select(
                select(BillItem.id)
                .where(BillItem.item_id == item_id)
                .exists()
                .label("has_bill_items"),
                select(DailyPrice.id)
                .where(DailyPrice.item_id == item_id)
                .exists()
                .label("has_prices"),
                select(ShopItemAllocation.id)
                .where(ShopItemAllocation.item_id == item_id)
                .exists()
                .label("has_allocations"),
            )
        )
    ).one()
    has_bill_items, has_prices, has_allocations = existence_row

    if item.shop_id is None and has_allocations:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete a catalogue item that is allocated to shops",
        )
    if has_bill_items:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete an item that already has billing history",
        )
    if has_prices:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete an item that already has price history",
        )

    image_object_key = item.image_object_key
    image_thumbnail_object_key = item.image_thumbnail_object_key
    _record_item_event(
        db,
        item_id=item.id,
        shop_id=item.shop_id,
        event_type="item.deleted",
        before=_json_safe_item_state(item),
    )
    await db.delete(item)
    await db.commit()
    await delete_item_image_storage(image_object_key, image_thumbnail_object_key)


async def set_shop_active_state(
    db: AsyncSession, shop_id: UUID, organization_id: UUID, is_active: bool
) -> ShopRead:
    """Toggle is_active on both Shop and its owner User in one transaction.

    Uses a single JOIN SELECT with ``with_for_update()`` to prevent a
    lost-update race when two admins toggle the same shop concurrently.
    """
    result = await db.execute(
        select(Shop)
        .join(Shop.owner)
        .options(contains_eager(Shop.owner))
        .where(Shop.id == shop_id, Shop.organization_id == organization_id)
        .with_for_update()
    )
    shop = result.scalar_one_or_none()
    if shop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shop not found")

    shop.is_active = is_active
    shop.owner.is_active = is_active
    if not is_active:
        await invalidate_user_sessions(shop.owner)
    await db.flush()  # batch both UPDATEs before the commit
    await db.commit()
    return _shop_to_read(shop)
