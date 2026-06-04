import json
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import and_, case, cast, distinct, func, null, or_, select, text, union_all
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import contains_eager, selectinload

from app.core.security import get_password_hash
from app.db.storage import (
    build_item_image_path,
    build_item_image_thumb_path,
    delete_item_image_storage,
    save_item_image_upload,
)
from app.models import (
    BaseUnit,
    Bill,
    BillItem,
    DailyPrice,
    Item,
    ItemCategory,
    ItemChangeEvent,
    Payment,
    Shop,
    ShopItemAllocation,
    UnitType,
    User,
    UserRole,
)
from app.schemas.admin import (
    AdminBillPage,
    AdminBillShopStat,
    AdminBillSummary,
    AdminDashboardBootstrap,
    AdminItemRowsPage,
    AnalyticsPeriod,
    ItemCategoryCreate,
    ItemCategoryRead,
    ItemCategoryUpdate,
    ItemCreate,
    ItemMetadataUpdate,
    ItemRead,
    ItemSalesSummary,
    ItemScope,
    ItemUpdate,
    PaymentSplitSummary,
    PriceStatus,
    ShopCreate,
    ShopItemAllocationBulkRead,
    ShopItemAllocationUpdate,
    ShopItemCounts,
    ShopItemPage,
    ShopItemRead,
    ShopRead,
    ShopSalesSummary,
    ShopSelectedItemsOrderRead,
    ShopUpdate,
)
from app.schemas.billing import BillLineRead, BillRead, PaymentRead, ReceiptRead


def _shop_to_read(shop: Shop) -> ShopRead:
    return ShopRead(
        id=shop.id,
        name=shop.name,
        is_active=shop.is_active,
        created_at=shop.created_at,
        username=shop.owner.username,
    )


def _item_to_read(item: Item) -> ItemRead:
    loaded_category = item.__dict__.get("category_ref")
    return ItemRead(
        id=item.id,
        shop_id=item.shop_id,
        name=item.name,
        tamil_name=item.tamil_name,
        unit_type=item.unit_type,
        base_unit=item.base_unit,
        sort_order=item.sort_order,
        category_id=item.category_id,
        category=loaded_category.name if loaded_category is not None else item.category,
        is_active=item.is_active,
        created_at=item.created_at,
        updated_at=item.updated_at,
        custom_attributes=item.custom_attributes or {},
        image_path=build_item_image_path(item.id, item.image_object_key, item.image_content_type),
        image_thumb_path=build_item_image_thumb_path(
            item.id,
            item.image_thumbnail_object_key,
            item.image_thumbnail_content_type,
            original_object_key=item.image_object_key,
        ),
        image_content_type=item.image_content_type,
    )


def _merge_custom_attributes(
    item_attributes: dict[str, object | None] | str | None,
    allocation_attributes: dict[str, object | None] | str | None,
    *,
    is_allocated: bool,
) -> dict[str, object | None]:
    attributes = _custom_attributes_dict(item_attributes)
    if is_allocated:
        attributes.update(_custom_attributes_dict(allocation_attributes))
    return attributes


def _custom_attributes_dict(value: dict[str, object | None] | str | None) -> dict[str, object | None]:
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str) and value.strip():
        try:
            decoded = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return dict(decoded) if isinstance(decoded, dict) else {}
    return {}


def _coalesce_text(*values: str | None) -> str | None:
    for value in values:
        if value is not None and value.strip():
            return value.strip()
    return None


def _price_status_for(price_date: date | None, *, is_required: bool) -> PriceStatus:
    if not is_required or price_date is None:
        return PriceStatus.MISSING
    return PriceStatus.CURRENT if price_date == date.today() else PriceStatus.STALE


def _zero_if_null(value: object) -> int:
    return int(value or 0)


async def _count_query_rows(db: AsyncSession, query) -> int:
    return int(await db.scalar(select(func.count()).select_from(query.subquery())) or 0)


def _sum_if(condition):
    return func.coalesce(func.sum(case((condition, 1), else_=0)), 0)


def _json_safe_item_state(item: Item | None) -> dict[str, object | None]:
    if item is None:
        return {}
    return {
        "id": str(item.id),
        "shop_id": str(item.shop_id) if item.shop_id else None,
        "name": item.name,
        "tamil_name": item.tamil_name,
        "unit_type": item.unit_type.value,
        "base_unit": item.base_unit.value,
        "sort_order": item.sort_order,
        "category_id": str(item.category_id) if item.category_id else None,
        "category": item.category,
        "is_active": item.is_active,
        "custom_attributes": dict(item.custom_attributes or {}),
        "image_object_key": item.image_object_key,
        "image_content_type": item.image_content_type,
        "image_thumbnail_object_key": item.image_thumbnail_object_key,
        "image_thumbnail_content_type": item.image_thumbnail_content_type,
    }


def _record_item_event(
    db: AsyncSession,
    *,
    item_id: UUID | None,
    shop_id: UUID | None,
    event_type: str,
    before: dict[str, object | None] | None = None,
    after: dict[str, object | None] | None = None,
) -> None:
    db.add(
        ItemChangeEvent(
            item_id=item_id,
            shop_id=shop_id,
            event_type=event_type,
            before=before or {},
            after=after or {},
        )
    )


def _shop_item_visibility_filter(shop_id: UUID):
    return or_(Item.shop_id.is_(None), Item.shop_id == shop_id)


def _normalize_item_name(raw_name: str) -> str:
    item_name = raw_name.strip()
    if len(item_name) < 2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Item name is required",
        )
    return item_name


def _normalize_tamil_item_name(raw_name: str) -> str:
    item_name = raw_name.strip()
    if not item_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Tamil item name is required",
        )
    return item_name


async def _ensure_unique_item_name(
    db: AsyncSession,
    item_name: str,
    *,
    shop_id: UUID | None = None,
    exclude_item_id: UUID | None = None,
) -> None:
    filters = [func.lower(Item.name) == item_name.lower()]
    if shop_id is not None:
        filters.append(Item.shop_id == shop_id)
    else:
        filters.append(Item.shop_id.is_(None))
    if exclude_item_id is not None:
        filters.append(Item.id != exclude_item_id)

    existing_item = await db.scalar(select(Item.id).where(*filters).limit(1))
    if existing_item is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Item name already exists")


def _normalize_category_name(raw_name: str) -> str:
    category_name = raw_name.strip()
    if not category_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Category name is required",
        )
    return category_name


async def list_item_categories(db: AsyncSession) -> list[ItemCategoryRead]:
    rows = await db.scalars(select(ItemCategory).order_by(func.lower(ItemCategory.name), ItemCategory.id))
    return [ItemCategoryRead.model_validate(category) for category in rows.all()]


async def create_item_category(
    db: AsyncSession, payload: ItemCategoryCreate
) -> ItemCategoryRead:
    category_name = _normalize_category_name(payload.name)
    existing = await db.scalar(
        select(ItemCategory).where(func.lower(ItemCategory.name) == category_name.lower())
    )
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Category already exists")

    category = ItemCategory(name=category_name)
    db.add(category)
    await db.flush()
    await db.commit()
    return ItemCategoryRead.model_validate(category)


async def update_item_category(
    db: AsyncSession, category_id: UUID, payload: ItemCategoryUpdate
) -> ItemCategoryRead:
    category_name = _normalize_category_name(payload.name)
    category = await db.scalar(select(ItemCategory).where(ItemCategory.id == category_id).with_for_update())
    if category is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    if category.name == category_name:
        return ItemCategoryRead.model_validate(category)

    category_key = category_name.lower()
    if category.name.lower() != category_key:
        existing = await db.scalar(
            select(ItemCategory.id)
            .where(func.lower(ItemCategory.name) == category_key)
            .limit(1)
        )
        if existing is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Category already exists")

    category.name = category_name
    await db.execute(
        Item.__table__.update()
        .where(
            Item.category_id == category_id,
            or_(Item.category.is_(None), Item.category != category_name),
        )
        .values(category=category_name)
    )
    await db.commit()
    return ItemCategoryRead.model_validate(category)


async def delete_item_category(db: AsyncSession, category_id: UUID) -> None:
    category = await db.scalar(select(ItemCategory).where(ItemCategory.id == category_id).with_for_update())
    if category is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    await db.execute(
        Item.__table__.update()
        .where(Item.category_id == category_id)
        .values(category_id=None, category=None)
    )
    await db.delete(category)
    await db.commit()


async def _find_or_create_item_category(
    db: AsyncSession, category_name: str
) -> ItemCategory:
    normalized_name = _normalize_category_name(category_name)
    category = await db.scalar(
        select(ItemCategory).where(func.lower(ItemCategory.name) == normalized_name.lower())
    )
    if category is not None:
        return category
    category = ItemCategory(name=normalized_name)
    db.add(category)
    return category


async def _resolve_item_category(
    db: AsyncSession,
    *,
    category_id: UUID | None,
    category_name: str | None,
) -> ItemCategory | None:
    if category_id is not None:
        category = await db.scalar(select(ItemCategory).where(ItemCategory.id == category_id))
        if category is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
        return category
    normalized_name = _coalesce_text(category_name)
    if normalized_name is None:
        return None
    return await _find_or_create_item_category(db, normalized_name)


async def list_shop_items(
    db: AsyncSession,
    shop: Shop,
    *,
    q: str | None = None,
    scope: ItemScope | None = None,
    allocated: bool | None = None,
    priced: bool | None = None,
    price_status: PriceStatus | None = None,
    active: bool | None = None,
    limit: int = 500,
    cursor_group: int | None = None,
    cursor_sort_order: int | None = None,
    cursor_name: str | None = None,
    cursor_id: UUID | None = None,
    item_id: UUID | None = None,
) -> ShopItemPage:
    today = date.today()
    if scope is not None:
        scope = ItemScope(scope)
    if price_status is not None:
        price_status = PriceStatus(price_status)

    latest_prices = (
        select(
            DailyPrice.item_id.label("item_id"),
            DailyPrice.price_per_unit.label("price_per_unit"),
            DailyPrice.price_date.label("price_date"),
            func.row_number()
            .over(
                partition_by=DailyPrice.item_id,
                order_by=(
                    DailyPrice.price_date.desc(),
                    DailyPrice.created_at.desc(),
                    DailyPrice.id.desc(),
                ),
            )
            .label("rn"),
        )
        .where(DailyPrice.shop_id == shop.id)
        .subquery()
    )
    bill_counts = (
        select(BillItem.item_id.label("item_id"), func.count(BillItem.id).label("bill_count"))
        .group_by(BillItem.item_id)
        .subquery()
    )
    price_counts = (
        select(DailyPrice.item_id.label("item_id"), func.count(DailyPrice.id).label("price_count"))
        .group_by(DailyPrice.item_id)
        .subquery()
    )
    allocation_counts = (
        select(
            ShopItemAllocation.item_id.label("item_id"),
            func.count(ShopItemAllocation.id).label("allocated_shop_count"),
        )
        .group_by(ShopItemAllocation.item_id)
        .subquery()
    )
    is_shop_item_expr = Item.shop_id == shop.id
    is_allocated_expr = or_(is_shop_item_expr, ShopItemAllocation.id.is_not(None))
    effective_active_expr = and_(
        Item.is_active.is_(True),
        or_(ShopItemAllocation.id.is_(None), ShopItemAllocation.is_active.is_(True)),
    )
    sort_group_expr = case((is_allocated_expr, 0), else_=1)
    effective_sort_order_expr = func.coalesce(ShopItemAllocation.sort_order, Item.sort_order)
    sort_name_expr = func.lower(func.coalesce(ShopItemAllocation.display_name, Item.name))

    base_query = (
        select(
            Item.id,
            Item.shop_id,
            Item.name,
            Item.tamil_name,
            Item.unit_type,
            Item.base_unit,
            Item.sort_order,
            Item.category_id,
            Item.category,
            Item.is_active,
            Item.created_at,
            Item.updated_at,
            Item.custom_attributes,
            Item.image_object_key,
            Item.image_content_type,
            Item.image_thumbnail_object_key,
            Item.image_thumbnail_content_type,
            ShopItemAllocation.id.label("allocation_id"),
            ShopItemAllocation.display_name.label("allocation_display_name"),
            ShopItemAllocation.tamil_name.label("allocation_tamil_name"),
            ShopItemAllocation.is_active.label("allocation_is_active"),
            ShopItemAllocation.sort_order.label("allocation_sort_order"),
            ShopItemAllocation.custom_attributes.label("allocation_custom_attributes"),
            latest_prices.c.price_per_unit,
            latest_prices.c.price_date,
            func.coalesce(bill_counts.c.bill_count, 0).label("bill_count"),
            func.coalesce(price_counts.c.price_count, 0).label("price_count"),
            func.coalesce(allocation_counts.c.allocated_shop_count, 0).label(
                "allocated_shop_count"
            ),
        )
        .outerjoin(latest_prices, and_(latest_prices.c.item_id == Item.id, latest_prices.c.rn == 1))
        .outerjoin(bill_counts, bill_counts.c.item_id == Item.id)
        .outerjoin(price_counts, price_counts.c.item_id == Item.id)
        .outerjoin(allocation_counts, allocation_counts.c.item_id == Item.id)
        .outerjoin(
            ShopItemAllocation,
            and_(
                ShopItemAllocation.item_id == Item.id,
                ShopItemAllocation.shop_id == shop.id,
            ),
        )
        .where(_shop_item_visibility_filter(shop.id))
    )

    search = q.strip() if q else ""
    if search:
        like_search = f"%{search.lower()}%"
        base_query = base_query.where(
            or_(
                func.lower(Item.name).like(like_search),
                func.lower(func.coalesce(Item.tamil_name, "")).like(like_search),
                func.lower(func.coalesce(ShopItemAllocation.display_name, "")).like(like_search),
                func.lower(func.coalesce(ShopItemAllocation.tamil_name, "")).like(like_search),
            )
        )

    count_source = base_query.subquery()
    count_is_shop_item = count_source.c.shop_id == shop.id
    count_is_allocated = or_(count_is_shop_item, count_source.c.allocation_id.is_not(None))
    count_is_active = and_(
        count_source.c.is_active.is_(True),
        or_(
            count_source.c.allocation_id.is_(None),
            count_source.c.allocation_is_active.is_(True),
        ),
    )
    count_is_available = and_(count_is_active, count_is_allocated)
    count_row = (
        await db.execute(
            select(
                func.count().label("all"),
                _sum_if(~count_is_shop_item).label("catalogue"),
                _sum_if(count_is_shop_item).label("shop"),
                _sum_if(count_is_allocated).label("allocated"),
                _sum_if(and_(~count_is_allocated, ~count_is_shop_item)).label("available"),
                _sum_if(
                    and_(
                        count_is_available,
                        count_source.c.price_date == today,
                    )
                ).label("priced"),
                _sum_if(
                    and_(
                        count_is_available,
                        count_source.c.price_date.is_(None),
                    )
                ).label("needs_price"),
                _sum_if(
                    and_(
                        count_is_available,
                        count_source.c.price_date.is_not(None),
                        count_source.c.price_date != today,
                    )
                ).label("stale_price"),
                _sum_if(~count_is_active).label("paused"),
            ).select_from(count_source)
        )
    ).mappings().one()
    counts = ShopItemCounts(
        all=_zero_if_null(count_row["all"]),
        catalogue=_zero_if_null(count_row["catalogue"]),
        shop=_zero_if_null(count_row["shop"]),
        allocated=_zero_if_null(count_row["allocated"]),
        available=_zero_if_null(count_row["available"]),
        priced=_zero_if_null(count_row["priced"]),
        needs_price=_zero_if_null(count_row["needs_price"]),
        stale_price=_zero_if_null(count_row["stale_price"]),
        paused=_zero_if_null(count_row["paused"]),
    )

    query = base_query
    if scope == ItemScope.GLOBAL:
        query = query.where(Item.shop_id.is_(None))
    elif scope == ItemScope.SHOP:
        query = query.where(Item.shop_id == shop.id)

    if allocated is not None:
        query = query.where(is_allocated_expr if allocated else ~is_allocated_expr)

    if priced is not None:
        query = query.where(
            and_(
                effective_active_expr,
                is_allocated_expr,
                latest_prices.c.price_date == today,
            )
            if priced
            else and_(
                effective_active_expr,
                is_allocated_expr,
                or_(
                    latest_prices.c.price_per_unit.is_(None),
                    latest_prices.c.price_date != today,
                ),
            )
        )
    if price_status is not None:
        if price_status == PriceStatus.CURRENT:
            query = query.where(
                and_(
                    effective_active_expr,
                    is_allocated_expr,
                    latest_prices.c.price_date == today,
                )
            )
        elif price_status == PriceStatus.STALE:
            query = query.where(
                and_(
                    effective_active_expr,
                    is_allocated_expr,
                    latest_prices.c.price_per_unit.is_not(None),
                    latest_prices.c.price_date != today,
                )
            )
        else:
            query = query.where(
                and_(
                    effective_active_expr,
                    is_allocated_expr,
                    latest_prices.c.price_per_unit.is_(None),
                )
            )

    if active is not None:
        query = query.where(effective_active_expr if active else ~effective_active_expr)

    if item_id is not None:
        query = query.where(Item.id == item_id)

    filtered_total_count = await _count_query_rows(db, query)

    if cursor_group is not None and cursor_name is not None and cursor_id is not None:
        if cursor_sort_order is None:
            query = query.where(
                or_(
                    sort_group_expr > cursor_group,
                    and_(sort_group_expr == cursor_group, sort_name_expr > cursor_name.lower()),
                    and_(
                        sort_group_expr == cursor_group,
                        sort_name_expr == cursor_name.lower(),
                        Item.id > cursor_id,
                    ),
                )
            )
        else:
            query = query.where(
                or_(
                    sort_group_expr > cursor_group,
                    and_(
                        sort_group_expr == cursor_group,
                        effective_sort_order_expr > cursor_sort_order,
                    ),
                    and_(
                        sort_group_expr == cursor_group,
                        effective_sort_order_expr == cursor_sort_order,
                        sort_name_expr > cursor_name.lower(),
                    ),
                    and_(
                        sort_group_expr == cursor_group,
                        effective_sort_order_expr == cursor_sort_order,
                        sort_name_expr == cursor_name.lower(),
                        Item.id > cursor_id,
                    ),
                )
            )

    rows = await db.execute(
        query.order_by(
            sort_group_expr.asc(),
            effective_sort_order_expr.asc(),
            sort_name_expr.asc(),
            Item.id.asc(),
        ).limit(limit + 1)
    )
    result_rows = rows.all()
    page_rows = result_rows[:limit]
    has_more = len(result_rows) > limit
    items: list[ShopItemRead] = []
    for row in page_rows:
        is_shop_item = row.shop_id == shop.id
        is_allocated = is_shop_item or row.allocation_id is not None
        effective_active = row.is_active and (row.allocation_id is None or row.allocation_is_active)
        available_for_billing = effective_active and is_allocated
        effective_name = _coalesce_text(row.allocation_display_name, row.name) or row.name
        effective_tamil_name = _coalesce_text(row.allocation_tamil_name, row.tamil_name)
        effective_sort_order = (
            row.allocation_sort_order if row.allocation_sort_order is not None else row.sort_order
        )
        price_status = _price_status_for(row.price_date, is_required=available_for_billing)
        bill_count = int(row.bill_count or 0)
        price_count = int(row.price_count or 0)
        items.append(
            ShopItemRead(
                id=row.id,
                shop_id=row.shop_id,
                name=effective_name,
                tamil_name=effective_tamil_name,
                unit_type=row.unit_type,
                base_unit=row.base_unit,
                sort_order=effective_sort_order,
                category_id=row.category_id,
                category=row.category,
                is_active=effective_active,
                created_at=row.created_at,
                updated_at=row.updated_at,
                custom_attributes=_merge_custom_attributes(
                    row.custom_attributes,
                    row.allocation_custom_attributes,
                    is_allocated=is_allocated,
                ),
                image_path=build_item_image_path(
                    row.id, row.image_object_key, row.image_content_type
                ),
                image_thumb_path=build_item_image_thumb_path(
                    row.id,
                    row.image_thumbnail_object_key,
                    row.image_thumbnail_content_type,
                    original_object_key=row.image_object_key,
                ),
                image_content_type=row.image_content_type,
                current_price=row.price_per_unit if is_allocated else None,
                price_date=row.price_date if is_allocated else None,
                latest_price_date=row.price_date if is_allocated else None,
                price_status=price_status,
                scope=ItemScope.SHOP if is_shop_item else ItemScope.GLOBAL,
                allocated=is_allocated,
                available_for_billing=available_for_billing,
                can_delete=(
                    bill_count == 0
                    and price_count == 0
                    and (is_shop_item or int(row.allocated_shop_count or 0) == 0)
                ),
                can_deallocate=not is_shop_item and is_allocated,
                bill_count=bill_count,
                price_count=price_count,
                allocated_shop_count=int(row.allocated_shop_count or 0),
            )
        )

    next_cursor_group = next_cursor_sort_order = next_cursor_name = next_cursor_id = None
    if has_more and page_rows:
        last_row = page_rows[-1]
        last_is_shop_item = last_row.shop_id == shop.id
        last_is_allocated = last_is_shop_item or last_row.allocation_id is not None
        next_cursor_group = 0 if last_is_allocated else 1
        next_cursor_sort_order = (
            last_row.allocation_sort_order
            if last_row.allocation_sort_order is not None
            else last_row.sort_order
        )
        next_cursor_name = (
            _coalesce_text(last_row.allocation_display_name, last_row.name) or last_row.name
        ).lower()
        next_cursor_id = last_row.id

    return ShopItemPage(
        items=items,
        limit=limit,
        total_count=filtered_total_count,
        counts=counts,
        has_more=has_more,
        next_cursor_group=next_cursor_group,
        next_cursor_sort_order=next_cursor_sort_order,
        next_cursor_name=next_cursor_name,
        next_cursor_id=next_cursor_id,
    )


async def get_shop_item(db: AsyncSession, shop: Shop, item_id: UUID) -> ShopItemRead:
    latest_price_sq = (
        select(DailyPrice.price_per_unit)
        .where(DailyPrice.shop_id == shop.id, DailyPrice.item_id == Item.id)
        .order_by(DailyPrice.price_date.desc(), DailyPrice.created_at.desc(), DailyPrice.id.desc())
        .limit(1)
        .correlate(Item)
        .scalar_subquery()
    )
    latest_price_date_sq = (
        select(DailyPrice.price_date)
        .where(DailyPrice.shop_id == shop.id, DailyPrice.item_id == Item.id)
        .order_by(DailyPrice.price_date.desc(), DailyPrice.created_at.desc(), DailyPrice.id.desc())
        .limit(1)
        .correlate(Item)
        .scalar_subquery()
    )
    bill_count_sq = (
        select(func.count(BillItem.id))
        .where(BillItem.item_id == Item.id)
        .correlate(Item)
        .scalar_subquery()
    )
    price_count_sq = (
        select(func.count(DailyPrice.id))
        .where(DailyPrice.item_id == Item.id)
        .correlate(Item)
        .scalar_subquery()
    )
    allocated_shop_count_sq = (
        select(func.count(ShopItemAllocation.id))
        .where(ShopItemAllocation.item_id == Item.id)
        .correlate(Item)
        .scalar_subquery()
    )
    row = (
        await db.execute(
            select(
                Item.id,
                Item.shop_id,
                Item.name,
                Item.tamil_name,
                Item.unit_type,
                Item.base_unit,
                Item.sort_order,
                Item.category_id,
                Item.category,
                Item.is_active,
                Item.created_at,
                Item.updated_at,
                Item.custom_attributes,
                Item.image_object_key,
                Item.image_content_type,
                Item.image_thumbnail_object_key,
                Item.image_thumbnail_content_type,
                ShopItemAllocation.id.label("allocation_id"),
                ShopItemAllocation.display_name.label("allocation_display_name"),
                ShopItemAllocation.tamil_name.label("allocation_tamil_name"),
                ShopItemAllocation.is_active.label("allocation_is_active"),
                ShopItemAllocation.sort_order.label("allocation_sort_order"),
                ShopItemAllocation.custom_attributes.label("allocation_custom_attributes"),
                latest_price_sq.label("price_per_unit"),
                latest_price_date_sq.label("price_date"),
                bill_count_sq.label("bill_count"),
                price_count_sq.label("price_count"),
                allocated_shop_count_sq.label("allocated_shop_count"),
            )
            .outerjoin(
                ShopItemAllocation,
                and_(
                    ShopItemAllocation.item_id == Item.id,
                    ShopItemAllocation.shop_id == shop.id,
                ),
            )
            .where(
                Item.id == item_id,
                _shop_item_visibility_filter(shop.id),
            )
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    is_shop_item = row.shop_id == shop.id
    is_allocated = is_shop_item or row.allocation_id is not None
    effective_active = row.is_active and (row.allocation_id is None or row.allocation_is_active)
    available_for_billing = effective_active and is_allocated
    effective_name = _coalesce_text(row.allocation_display_name, row.name) or row.name
    effective_tamil_name = _coalesce_text(row.allocation_tamil_name, row.tamil_name)
    effective_sort_order = (
        row.allocation_sort_order if row.allocation_sort_order is not None else row.sort_order
    )
    bill_count = int(row.bill_count or 0)
    price_count = int(row.price_count or 0)
    allocated_shop_count = int(row.allocated_shop_count or 0)

    return ShopItemRead(
        id=row.id,
        shop_id=row.shop_id,
        name=effective_name,
        tamil_name=effective_tamil_name,
        unit_type=row.unit_type,
        base_unit=row.base_unit,
        sort_order=effective_sort_order,
        category_id=row.category_id,
        category=row.category,
        is_active=effective_active,
        created_at=row.created_at,
        updated_at=row.updated_at,
        custom_attributes=_merge_custom_attributes(
            row.custom_attributes,
            row.allocation_custom_attributes,
            is_allocated=is_allocated,
        ),
        image_path=build_item_image_path(row.id, row.image_object_key, row.image_content_type),
        image_thumb_path=build_item_image_thumb_path(
            row.id,
            row.image_thumbnail_object_key,
            row.image_thumbnail_content_type,
            original_object_key=row.image_object_key,
        ),
        image_content_type=row.image_content_type,
        current_price=row.price_per_unit if is_allocated else None,
        price_date=row.price_date if is_allocated else None,
        latest_price_date=row.price_date if is_allocated else None,
        price_status=_price_status_for(row.price_date, is_required=available_for_billing),
        scope=ItemScope.SHOP if is_shop_item else ItemScope.GLOBAL,
        allocated=is_allocated,
        available_for_billing=available_for_billing,
        can_delete=(
            bill_count == 0
            and price_count == 0
            and (is_shop_item or allocated_shop_count == 0)
        ),
        can_deallocate=not is_shop_item and is_allocated,
        bill_count=bill_count,
        price_count=price_count,
        allocated_shop_count=allocated_shop_count,
    )


def _compact_shop_item_from_row(row, shop: Shop, *, allocated: bool) -> ShopItemRead:
    is_shop_item = row.shop_id == shop.id
    effective_name = _coalesce_text(
        getattr(row, "allocation_display_name", None),
        row.name,
    ) or row.name
    effective_tamil_name = _coalesce_text(
        getattr(row, "allocation_tamil_name", None),
        row.tamil_name,
    )
    allocation_is_active = getattr(row, "allocation_is_active", None)
    effective_active = row.is_active and (allocation_is_active is None or allocation_is_active)
    effective_sort_order = getattr(row, "allocation_sort_order", None)
    if effective_sort_order is None:
        effective_sort_order = row.sort_order

    return ShopItemRead(
        id=row.id,
        shop_id=row.shop_id,
        name=effective_name,
        tamil_name=effective_tamil_name,
        unit_type=row.unit_type,
        base_unit=row.base_unit,
        sort_order=effective_sort_order,
        category_id=row.category_id,
        category=row.category,
        is_active=effective_active,
        created_at=row.created_at,
        updated_at=row.updated_at,
        custom_attributes=_merge_custom_attributes(
            row.custom_attributes,
            getattr(row, "allocation_custom_attributes", None),
            is_allocated=allocated,
        ),
        image_path=build_item_image_path(row.id, row.image_object_key, row.image_content_type),
        image_thumb_path=build_item_image_thumb_path(
            row.id,
            row.image_thumbnail_object_key,
            row.image_thumbnail_content_type,
            original_object_key=row.image_object_key,
        ),
        image_content_type=row.image_content_type,
        price_status=PriceStatus.MISSING,
        scope=ItemScope.SHOP if is_shop_item else ItemScope.GLOBAL,
        allocated=allocated,
        available_for_billing=effective_active and allocated,
        can_delete=False,
        can_deallocate=not is_shop_item and allocated,
        bill_count=0,
        price_count=0,
        allocated_shop_count=1 if allocated and not is_shop_item else 0,
    )


def _cursor_filter(
    sort_order_expr,
    sort_name_expr,
    cursor_sort_order,
    cursor_name,
    cursor_id,
    id_expr=Item.id,
):
    if cursor_name is None or cursor_id is None:
        return None
    if cursor_sort_order is None:
        return or_(
            sort_name_expr > cursor_name.lower(),
            and_(sort_name_expr == cursor_name.lower(), id_expr > cursor_id),
        )
    return or_(
        sort_order_expr > cursor_sort_order,
        and_(sort_order_expr == cursor_sort_order, sort_name_expr > cursor_name.lower()),
        and_(
            sort_order_expr == cursor_sort_order,
            sort_name_expr == cursor_name.lower(),
            id_expr > cursor_id,
        ),
    )


def _selected_shop_items_source(shop: Shop):
    shop_owned = select(
        Item.id.label("id"),
        Item.shop_id.label("shop_id"),
        Item.name.label("name"),
        Item.tamil_name.label("tamil_name"),
        Item.unit_type.label("unit_type"),
        Item.base_unit.label("base_unit"),
        Item.sort_order.label("sort_order"),
        Item.category_id.label("category_id"),
        Item.category.label("category"),
        Item.is_active.label("is_active"),
        Item.created_at.label("created_at"),
        Item.updated_at.label("updated_at"),
        Item.custom_attributes.label("custom_attributes"),
        Item.image_object_key.label("image_object_key"),
        Item.image_content_type.label("image_content_type"),
        Item.image_thumbnail_object_key.label("image_thumbnail_object_key"),
        Item.image_thumbnail_content_type.label("image_thumbnail_content_type"),
        cast(null(), ShopItemAllocation.id.type).label("allocation_id"),
        cast(null(), ShopItemAllocation.display_name.type).label("allocation_display_name"),
        cast(null(), ShopItemAllocation.tamil_name.type).label("allocation_tamil_name"),
        cast(null(), ShopItemAllocation.is_active.type).label("allocation_is_active"),
        cast(null(), ShopItemAllocation.sort_order.type).label("allocation_sort_order"),
        cast(null(), ShopItemAllocation.custom_attributes.type).label(
            "allocation_custom_attributes"
        ),
    ).where(Item.shop_id == shop.id)
    allocated_catalogue = (
        select(
            Item.id.label("id"),
            Item.shop_id.label("shop_id"),
            Item.name.label("name"),
            Item.tamil_name.label("tamil_name"),
            Item.unit_type.label("unit_type"),
            Item.base_unit.label("base_unit"),
            Item.sort_order.label("sort_order"),
            Item.category_id.label("category_id"),
            Item.category.label("category"),
            Item.is_active.label("is_active"),
            Item.created_at.label("created_at"),
            Item.updated_at.label("updated_at"),
            Item.custom_attributes.label("custom_attributes"),
            Item.image_object_key.label("image_object_key"),
            Item.image_content_type.label("image_content_type"),
            Item.image_thumbnail_object_key.label("image_thumbnail_object_key"),
            Item.image_thumbnail_content_type.label("image_thumbnail_content_type"),
            ShopItemAllocation.id.label("allocation_id"),
            ShopItemAllocation.display_name.label("allocation_display_name"),
            ShopItemAllocation.tamil_name.label("allocation_tamil_name"),
            ShopItemAllocation.is_active.label("allocation_is_active"),
            ShopItemAllocation.sort_order.label("allocation_sort_order"),
            ShopItemAllocation.custom_attributes.label("allocation_custom_attributes"),
        )
        .join(ShopItemAllocation, ShopItemAllocation.item_id == Item.id)
        .where(
            ShopItemAllocation.shop_id == shop.id,
            Item.shop_id.is_(None),
        )
    )
    return union_all(shop_owned, allocated_catalogue).subquery()


def _filter_selected_shop_source(
    source,
    q: str | None,
    *,
    category_id: UUID | None = None,
    uncategorized: bool | None = None,
):
    if category_id is not None and uncategorized:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="category_id and uncategorized cannot be used together",
        )

    query = select(source)
    search = q.strip() if q else ""
    if search:
        like_search = f"%{search.lower()}%"
        query = query.where(
            or_(
                func.lower(source.c.name).like(like_search),
                func.lower(func.coalesce(source.c.tamil_name, "")).like(like_search),
                func.lower(func.coalesce(source.c.allocation_display_name, "")).like(
                    like_search
                ),
                func.lower(func.coalesce(source.c.allocation_tamil_name, "")).like(
                    like_search
                ),
            )
        )
    if category_id is not None:
        query = query.where(source.c.category_id == category_id)
    elif uncategorized:
        query = query.where(source.c.category_id.is_(None))
    return query


async def list_selected_shop_item_rows(
    db: AsyncSession,
    shop: Shop,
    *,
    q: str | None = None,
    limit: int = 100,
    category_id: UUID | None = None,
    uncategorized: bool | None = None,
    cursor_sort_order: int | None = None,
    cursor_name: str | None = None,
    cursor_id: UUID | None = None,
) -> AdminItemRowsPage:
    source = _selected_shop_items_source(shop)
    sort_order_expr = func.coalesce(source.c.allocation_sort_order, source.c.sort_order)
    sort_name_expr = func.lower(func.coalesce(source.c.allocation_display_name, source.c.name))
    query = _filter_selected_shop_source(
        source,
        q,
        category_id=category_id,
        uncategorized=uncategorized,
    )

    cursor_condition = _cursor_filter(
        sort_order_expr,
        sort_name_expr,
        cursor_sort_order,
        cursor_name,
        cursor_id,
        source.c.id,
    )
    if cursor_condition is not None:
        query = query.where(cursor_condition)

    rows = await db.execute(
        query.order_by(sort_order_expr.asc(), sort_name_expr.asc(), source.c.id.asc()).limit(
            limit + 1
        )
    )
    result_rows = rows.all()
    page_rows = result_rows[:limit]
    has_more = len(result_rows) > limit
    items = [_compact_shop_item_from_row(row, shop, allocated=True) for row in page_rows]

    next_cursor_sort_order = next_cursor_name = next_cursor_id = None
    if has_more and page_rows:
        last_row = page_rows[-1]
        next_cursor_sort_order = (
            last_row.allocation_sort_order
            if last_row.allocation_sort_order is not None
            else last_row.sort_order
        )
        next_cursor_name = (
            _coalesce_text(last_row.allocation_display_name, last_row.name) or last_row.name
        ).lower()
        next_cursor_id = last_row.id

    return AdminItemRowsPage(
        items=items,
        limit=limit,
        has_more=has_more,
        next_cursor_sort_order=next_cursor_sort_order,
        next_cursor_name=next_cursor_name,
        next_cursor_id=next_cursor_id,
    )


async def count_selected_shop_items(
    db: AsyncSession,
    shop: Shop,
    *,
    q: str | None = None,
    category_id: UUID | None = None,
    uncategorized: bool | None = None,
) -> ShopItemCounts:
    source = _selected_shop_items_source(shop)
    count_source = _filter_selected_shop_source(
        source,
        q,
        category_id=category_id,
        uncategorized=uncategorized,
    ).subquery()
    count_row = (
        await db.execute(
            select(
                func.count().label("all"),
                _sum_if(count_source.c.shop_id == shop.id).label("shop"),
                _sum_if(count_source.c.shop_id.is_(None)).label("catalogue"),
                _sum_if(
                    or_(
                        count_source.c.is_active.is_(False),
                        count_source.c.allocation_is_active.is_(False),
                    )
                ).label("paused"),
            ).select_from(count_source)
        )
    ).mappings().one()
    total_count = _zero_if_null(count_row["all"])
    return ShopItemCounts(
        all=total_count,
        allocated=total_count,
        catalogue=_zero_if_null(count_row["catalogue"]),
        shop=_zero_if_null(count_row["shop"]),
        paused=_zero_if_null(count_row["paused"]),
    )


async def list_selected_shop_items(
    db: AsyncSession,
    shop: Shop,
    *,
    q: str | None = None,
    limit: int = 100,
    category_id: UUID | None = None,
    uncategorized: bool | None = None,
    cursor_sort_order: int | None = None,
    cursor_name: str | None = None,
    cursor_id: UUID | None = None,
) -> ShopItemPage:
    rows_page = await list_selected_shop_item_rows(
        db,
        shop,
        q=q,
        limit=limit,
        category_id=category_id,
        uncategorized=uncategorized,
        cursor_sort_order=cursor_sort_order,
        cursor_name=cursor_name,
        cursor_id=cursor_id,
    )
    counts = await count_selected_shop_items(
        db,
        shop,
        q=q,
        category_id=category_id,
        uncategorized=uncategorized,
    )
    return ShopItemPage(
        items=rows_page.items,
        limit=rows_page.limit,
        total_count=counts.all,
        counts=counts,
        has_more=rows_page.has_more,
        next_cursor_sort_order=rows_page.next_cursor_sort_order,
        next_cursor_name=rows_page.next_cursor_name,
        next_cursor_id=rows_page.next_cursor_id,
    )


async def update_selected_shop_items_order(
    db: AsyncSession,
    shop: Shop,
    item_ids: list[UUID],
) -> ShopSelectedItemsOrderRead:
    ordered_item_ids = list(item_ids)
    unique_item_ids = set(ordered_item_ids)
    if len(unique_item_ids) != len(ordered_item_ids):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Order payload contains duplicate items",
        )

    shop_items = (
        await db.scalars(
            select(Item)
            .where(Item.shop_id == shop.id)
            .with_for_update()
        )
    ).all()
    allocation_rows = (
        await db.scalars(
            select(ShopItemAllocation)
            .join(Item, Item.id == ShopItemAllocation.item_id)
            .where(
                ShopItemAllocation.shop_id == shop.id,
                Item.shop_id.is_(None),
            )
            .with_for_update()
        )
    ).all()

    shop_items_by_id = {item.id: item for item in shop_items}
    allocations_by_item_id = {allocation.item_id: allocation for allocation in allocation_rows}
    selected_item_ids = set(shop_items_by_id) | set(allocations_by_item_id)
    missing_item_ids = selected_item_ids - unique_item_ids
    unknown_item_ids = unique_item_ids - selected_item_ids
    if missing_item_ids or unknown_item_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Order payload must include every selected shop item exactly once",
        )

    for index, item_id in enumerate(ordered_item_ids, start=1):
        sort_order = index * 10
        shop_item = shop_items_by_id.get(item_id)
        if shop_item is not None:
            if shop_item.sort_order != sort_order:
                previous_state = _json_safe_item_state(shop_item)
                shop_item.sort_order = sort_order
                _record_item_event(
                    db,
                    item_id=shop_item.id,
                    shop_id=shop.id,
                    event_type="item.order_updated",
                    before=previous_state,
                    after=_json_safe_item_state(shop_item),
                )
            continue

        allocation = allocations_by_item_id[item_id]
        if allocation.sort_order != sort_order:
            before = {
                "shop_id": str(shop.id),
                "item_id": str(item_id),
                "sort_order": allocation.sort_order,
            }
            allocation.sort_order = sort_order
            _record_item_event(
                db,
                item_id=item_id,
                shop_id=shop.id,
                event_type="allocation.order_updated",
                before=before,
                after={
                    "shop_id": str(shop.id),
                    "item_id": str(item_id),
                    "sort_order": allocation.sort_order,
                },
            )

    await db.commit()
    return ShopSelectedItemsOrderRead(item_ids=ordered_item_ids)


def _shop_item_import_candidates_query(shop: Shop, q: str | None = None):
    allocation_exists = (
        select(ShopItemAllocation.id)
        .where(
            ShopItemAllocation.item_id == Item.id,
            ShopItemAllocation.shop_id == shop.id,
        )
        .exists()
    )
    query = (
        select(
            Item.id,
            Item.shop_id,
            Item.name,
            Item.tamil_name,
            Item.unit_type,
            Item.base_unit,
            Item.sort_order,
            Item.category_id,
            Item.category,
            Item.is_active,
            Item.created_at,
            Item.updated_at,
            Item.custom_attributes,
            Item.image_object_key,
            Item.image_content_type,
            Item.image_thumbnail_object_key,
            Item.image_thumbnail_content_type,
        )
        .where(
            Item.shop_id.is_(None),
            Item.is_active.is_(True),
            ~allocation_exists,
        )
    )

    search = q.strip() if q else ""
    if search:
        like_search = f"%{search.lower()}%"
        query = query.where(
            or_(
                func.lower(Item.name).like(like_search),
                func.lower(func.coalesce(Item.tamil_name, "")).like(like_search),
            )
        )
    return query


async def list_shop_item_import_candidate_rows(
    db: AsyncSession,
    shop: Shop,
    *,
    q: str | None = None,
    limit: int = 100,
    cursor_sort_order: int | None = None,
    cursor_name: str | None = None,
    cursor_id: UUID | None = None,
) -> AdminItemRowsPage:
    sort_name_expr = func.lower(Item.name)
    query = _shop_item_import_candidates_query(shop, q)
    cursor_condition = _cursor_filter(
        Item.sort_order,
        sort_name_expr,
        cursor_sort_order,
        cursor_name,
        cursor_id,
    )
    if cursor_condition is not None:
        query = query.where(cursor_condition)

    rows = await db.execute(
        query.order_by(Item.sort_order.asc(), sort_name_expr.asc(), Item.id.asc()).limit(limit + 1)
    )
    result_rows = rows.all()
    page_rows = result_rows[:limit]
    has_more = len(result_rows) > limit
    items = [
        _compact_shop_item_from_row(row, shop, allocated=False)
        for row in page_rows
    ]

    next_cursor_sort_order = next_cursor_name = next_cursor_id = None
    if has_more and page_rows:
        last_row = page_rows[-1]
        next_cursor_sort_order = last_row.sort_order
        next_cursor_name = last_row.name.lower()
        next_cursor_id = last_row.id

    return AdminItemRowsPage(
        items=items,
        limit=limit,
        has_more=has_more,
        next_cursor_sort_order=next_cursor_sort_order,
        next_cursor_name=next_cursor_name,
        next_cursor_id=next_cursor_id,
    )


async def count_shop_item_import_candidates(
    db: AsyncSession,
    shop: Shop,
    *,
    q: str | None = None,
) -> ShopItemCounts:
    total_count = await _count_query_rows(db, _shop_item_import_candidates_query(shop, q))
    return ShopItemCounts(all=total_count, available=total_count, catalogue=total_count)


async def list_shop_item_import_candidates(
    db: AsyncSession,
    shop: Shop,
    *,
    q: str | None = None,
    limit: int = 100,
    cursor_sort_order: int | None = None,
    cursor_name: str | None = None,
    cursor_id: UUID | None = None,
) -> ShopItemPage:
    rows_page = await list_shop_item_import_candidate_rows(
        db,
        shop,
        q=q,
        limit=limit,
        cursor_sort_order=cursor_sort_order,
        cursor_name=cursor_name,
        cursor_id=cursor_id,
    )
    counts = await count_shop_item_import_candidates(db, shop, q=q)
    return ShopItemPage(
        items=rows_page.items,
        limit=rows_page.limit,
        total_count=counts.all,
        counts=counts,
        has_more=rows_page.has_more,
        next_cursor_sort_order=rows_page.next_cursor_sort_order,
        next_cursor_name=rows_page.next_cursor_name,
        next_cursor_id=rows_page.next_cursor_id,
    )


def _catalogue_rows_query(q: str | None = None, active: bool | None = None):
    query = select(
        Item.id,
        Item.shop_id,
        Item.name,
        Item.tamil_name,
        Item.unit_type,
        Item.base_unit,
        Item.sort_order,
        Item.category_id,
        Item.category,
        Item.is_active,
        Item.created_at,
        Item.updated_at,
        Item.custom_attributes,
        Item.image_object_key,
        Item.image_content_type,
        Item.image_thumbnail_object_key,
        Item.image_thumbnail_content_type,
    ).where(Item.shop_id.is_(None))

    search = q.strip() if q else ""
    if search:
        like_search = f"%{search.lower()}%"
        query = query.where(
            or_(
                func.lower(Item.name).like(like_search),
                func.lower(func.coalesce(Item.tamil_name, "")).like(like_search),
            )
        )
    if active is not None:
        query = query.where(Item.is_active.is_(active))
    return query


def _catalogue_row_to_shop_item(row) -> ShopItemRead:
    return ShopItemRead(
        id=row.id,
        shop_id=None,
        name=row.name,
        tamil_name=row.tamil_name,
        unit_type=row.unit_type,
        base_unit=row.base_unit,
        sort_order=row.sort_order,
        category_id=row.category_id,
        category=row.category,
        is_active=row.is_active,
        created_at=row.created_at,
        updated_at=row.updated_at,
        custom_attributes=row.custom_attributes or {},
        image_path=build_item_image_path(row.id, row.image_object_key, row.image_content_type),
        image_thumb_path=build_item_image_thumb_path(
            row.id,
            row.image_thumbnail_object_key,
            row.image_thumbnail_content_type,
            original_object_key=row.image_object_key,
        ),
        image_content_type=row.image_content_type,
        price_status=PriceStatus.MISSING,
        scope=ItemScope.GLOBAL,
        allocated=False,
        available_for_billing=False,
        can_delete=False,
        can_deallocate=False,
    )


async def list_catalogue_item_rows(
    db: AsyncSession,
    *,
    q: str | None = None,
    active: bool | None = None,
    limit: int = 100,
    cursor_sort_order: int | None = None,
    cursor_name: str | None = None,
    cursor_id: UUID | None = None,
) -> AdminItemRowsPage:
    sort_name_expr = func.lower(Item.name)
    query = _catalogue_rows_query(q, active)
    cursor_condition = _cursor_filter(
        Item.sort_order,
        sort_name_expr,
        cursor_sort_order,
        cursor_name,
        cursor_id,
    )
    if cursor_condition is not None:
        query = query.where(cursor_condition)

    rows = await db.execute(
        query.order_by(Item.sort_order.asc(), sort_name_expr.asc(), Item.id.asc()).limit(limit + 1)
    )
    result_rows = rows.all()
    page_rows = result_rows[:limit]
    has_more = len(result_rows) > limit
    items = [_catalogue_row_to_shop_item(row) for row in page_rows]

    next_cursor_sort_order = next_cursor_name = next_cursor_id = None
    if has_more and page_rows:
        last_row = page_rows[-1]
        next_cursor_sort_order = last_row.sort_order
        next_cursor_name = last_row.name.lower()
        next_cursor_id = last_row.id

    return AdminItemRowsPage(
        items=items,
        limit=limit,
        has_more=has_more,
        next_cursor_sort_order=next_cursor_sort_order,
        next_cursor_name=next_cursor_name,
        next_cursor_id=next_cursor_id,
    )


async def count_catalogue_items(
    db: AsyncSession,
    *,
    q: str | None = None,
    active: bool | None = None,
) -> ShopItemCounts:
    allocation_exists = (
        select(ShopItemAllocation.id)
        .where(ShopItemAllocation.item_id == Item.id)
        .exists()
    )
    query = select(
        Item.id,
        Item.is_active,
        allocation_exists.label("is_allocated"),
    ).where(
        Item.shop_id.is_(None)
    )
    search = q.strip() if q else ""
    if search:
        like_search = f"%{search.lower()}%"
        query = query.where(
            or_(
                func.lower(Item.name).like(like_search),
                func.lower(func.coalesce(Item.tamil_name, "")).like(like_search),
            )
        )
    if active is not None:
        query = query.where(Item.is_active.is_(active))

    count_source = query.subquery()
    count_row = (
        await db.execute(
            select(
                func.count().label("all"),
                _sum_if(count_source.c.is_allocated.is_(True)).label("allocated"),
                _sum_if(count_source.c.is_allocated.is_(False)).label("available"),
                _sum_if(count_source.c.is_active.is_(False)).label("paused"),
            ).select_from(count_source)
        )
    ).mappings().one()
    total_count = _zero_if_null(count_row["all"])
    return ShopItemCounts(
        all=total_count,
        catalogue=total_count,
        allocated=_zero_if_null(count_row["allocated"]),
        available=_zero_if_null(count_row["available"]),
        paused=_zero_if_null(count_row["paused"]),
    )


async def list_catalogue_items(
    db: AsyncSession,
    *,
    q: str | None = None,
    allocated: bool | None = None,
    active: bool | None = None,
    limit: int = 500,
    cursor_sort_order: int | None = None,
    cursor_name: str | None = None,
    cursor_id: UUID | None = None,
) -> ShopItemPage:
    bill_counts = (
        select(BillItem.item_id.label("item_id"), func.count(BillItem.id).label("bill_count"))
        .group_by(BillItem.item_id)
        .subquery()
    )
    price_counts = (
        select(DailyPrice.item_id.label("item_id"), func.count(DailyPrice.id).label("price_count"))
        .group_by(DailyPrice.item_id)
        .subquery()
    )
    allocation_counts = (
        select(
            ShopItemAllocation.item_id.label("item_id"),
            func.count(ShopItemAllocation.id).label("allocated_shop_count"),
        )
        .group_by(ShopItemAllocation.item_id)
        .subquery()
    )
    query = select(
        Item.id,
        Item.shop_id,
        Item.name,
        Item.tamil_name,
        Item.unit_type,
        Item.base_unit,
        Item.sort_order,
        Item.category_id,
        Item.category,
        Item.is_active,
        Item.created_at,
        Item.updated_at,
        Item.custom_attributes,
        Item.image_object_key,
        Item.image_content_type,
        Item.image_thumbnail_object_key,
        Item.image_thumbnail_content_type,
        func.coalesce(bill_counts.c.bill_count, 0).label("bill_count"),
        func.coalesce(price_counts.c.price_count, 0).label("price_count"),
        func.coalesce(allocation_counts.c.allocated_shop_count, 0).label(
            "allocated_shop_count"
        ),
    ).outerjoin(
        bill_counts, bill_counts.c.item_id == Item.id
    ).outerjoin(
        price_counts, price_counts.c.item_id == Item.id
    ).outerjoin(
        allocation_counts, allocation_counts.c.item_id == Item.id
    ).where(Item.shop_id.is_(None))

    search = q.strip() if q else ""
    if search:
        like_search = f"%{search.lower()}%"
        query = query.where(
            or_(
                func.lower(Item.name).like(like_search),
                func.lower(func.coalesce(Item.tamil_name, "")).like(like_search),
            )
        )
    if allocated is not None:
        query = query.where(
            allocation_counts.c.allocated_shop_count > 0
            if allocated
            else func.coalesce(allocation_counts.c.allocated_shop_count, 0) == 0
        )
    if active is not None:
        query = query.where(Item.is_active.is_(active))

    count_source = query.subquery()
    count_row = (
        await db.execute(
            select(
                func.count().label("all"),
                _sum_if(count_source.c.allocated_shop_count > 0).label("allocated"),
                _sum_if(count_source.c.allocated_shop_count == 0).label("available"),
                _sum_if(~count_source.c.is_active).label("paused"),
            ).select_from(count_source)
        )
    ).mappings().one()
    total_count = _zero_if_null(count_row["all"])
    counts = ShopItemCounts(
        all=total_count,
        catalogue=total_count,
        allocated=_zero_if_null(count_row["allocated"]),
        available=_zero_if_null(count_row["available"]),
        paused=_zero_if_null(count_row["paused"]),
    )

    sort_name_expr = func.lower(Item.name)
    if cursor_name is not None and cursor_id is not None:
        if cursor_sort_order is None:
            query = query.where(
                or_(
                    sort_name_expr > cursor_name.lower(),
                    and_(sort_name_expr == cursor_name.lower(), Item.id > cursor_id),
                )
            )
        else:
            query = query.where(
                or_(
                    Item.sort_order > cursor_sort_order,
                    and_(Item.sort_order == cursor_sort_order, sort_name_expr > cursor_name.lower()),
                    and_(
                        Item.sort_order == cursor_sort_order,
                        sort_name_expr == cursor_name.lower(),
                        Item.id > cursor_id,
                    ),
                )
            )

    rows = await db.execute(
        query.order_by(Item.sort_order.asc(), sort_name_expr.asc(), Item.id.asc()).limit(limit + 1)
    )
    result_rows = rows.all()
    page_rows = result_rows[:limit]
    has_more = len(result_rows) > limit
    items = [
        ShopItemRead(
            id=row.id,
            shop_id=None,
            name=row.name,
            tamil_name=row.tamil_name,
            unit_type=row.unit_type,
            base_unit=row.base_unit,
            sort_order=row.sort_order,
            category_id=row.category_id,
            category=row.category,
            is_active=row.is_active,
            created_at=row.created_at,
            updated_at=row.updated_at,
            custom_attributes=row.custom_attributes or {},
            image_path=build_item_image_path(row.id, row.image_object_key, row.image_content_type),
            image_thumb_path=build_item_image_thumb_path(
                row.id,
                row.image_thumbnail_object_key,
                row.image_thumbnail_content_type,
                original_object_key=row.image_object_key,
            ),
            image_content_type=row.image_content_type,
            current_price=None,
            price_date=None,
            latest_price_date=None,
            price_status=PriceStatus.MISSING,
            scope=ItemScope.GLOBAL,
            allocated=int(row.allocated_shop_count or 0) > 0,
            available_for_billing=False,
            can_delete=(
                int(row.bill_count or 0) == 0
                and int(row.price_count or 0) == 0
                and int(row.allocated_shop_count or 0) == 0
            ),
            can_deallocate=False,
            bill_count=int(row.bill_count or 0),
            price_count=int(row.price_count or 0),
            allocated_shop_count=int(row.allocated_shop_count or 0),
        )
        for row in page_rows
    ]
    next_cursor_sort_order = next_cursor_name = next_cursor_id = None
    if has_more and page_rows:
        last_row = page_rows[-1]
        next_cursor_sort_order = last_row.sort_order
        next_cursor_name = last_row.name.lower()
        next_cursor_id = last_row.id
    return ShopItemPage(
        items=items,
        limit=limit,
        total_count=total_count,
        counts=counts,
        has_more=has_more,
        next_cursor_group=0,
        next_cursor_sort_order=next_cursor_sort_order,
        next_cursor_name=next_cursor_name,
        next_cursor_id=next_cursor_id,
    )


async def get_catalogue_item(db: AsyncSession, item_id: UUID) -> ShopItemRead:
    bill_count_sq = (
        select(func.count(BillItem.id))
        .where(BillItem.item_id == Item.id)
        .correlate(Item)
        .scalar_subquery()
    )
    price_count_sq = (
        select(func.count(DailyPrice.id))
        .where(DailyPrice.item_id == Item.id)
        .correlate(Item)
        .scalar_subquery()
    )
    allocated_shop_count_sq = (
        select(func.count(ShopItemAllocation.id))
        .where(ShopItemAllocation.item_id == Item.id)
        .correlate(Item)
        .scalar_subquery()
    )
    row = (
        await db.execute(
            select(
                Item.id,
                Item.name,
                Item.tamil_name,
                Item.unit_type,
                Item.base_unit,
                Item.sort_order,
                Item.category_id,
                Item.category,
                Item.is_active,
                Item.created_at,
                Item.updated_at,
                Item.custom_attributes,
                Item.image_object_key,
                Item.image_content_type,
                Item.image_thumbnail_object_key,
                Item.image_thumbnail_content_type,
                bill_count_sq.label("bill_count"),
                price_count_sq.label("price_count"),
                allocated_shop_count_sq.label("allocated_shop_count"),
            ).where(Item.id == item_id, Item.shop_id.is_(None))
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    return ShopItemRead(
        id=row.id,
        shop_id=None,
        name=row.name,
        tamil_name=row.tamil_name,
        unit_type=row.unit_type,
        base_unit=row.base_unit,
        sort_order=row.sort_order,
        category_id=row.category_id,
        category=row.category,
        is_active=row.is_active,
        created_at=row.created_at,
        updated_at=row.updated_at,
        custom_attributes=row.custom_attributes or {},
        image_path=build_item_image_path(row.id, row.image_object_key, row.image_content_type),
        image_thumb_path=build_item_image_thumb_path(
            row.id,
            row.image_thumbnail_object_key,
            row.image_thumbnail_content_type,
            original_object_key=row.image_object_key,
        ),
        image_content_type=row.image_content_type,
        current_price=None,
        price_date=None,
        latest_price_date=None,
        price_status=PriceStatus.MISSING,
        scope=ItemScope.GLOBAL,
        allocated=int(row.allocated_shop_count or 0) > 0,
        available_for_billing=False,
        can_delete=(
            int(row.bill_count or 0) == 0
            and int(row.price_count or 0) == 0
            and int(row.allocated_shop_count or 0) == 0
        ),
        can_deallocate=False,
        bill_count=int(row.bill_count or 0),
        price_count=int(row.price_count or 0),
        allocated_shop_count=int(row.allocated_shop_count or 0),
    )


async def allocate_catalogue_item(db: AsyncSession, shop: Shop, item_id: UUID) -> ShopItemRead:
    item = await db.scalar(select(Item).where(Item.id == item_id).with_for_update())
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    if item.shop_id == shop.id:
        return await get_shop_item(db, shop, item_id)
    if item.shop_id is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Only catalogue items can be allocated to a shop",
        )
    if not item.is_active:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Inactive catalogue items cannot be allocated to a shop",
        )

    existing_allocation = await db.scalar(
        select(ShopItemAllocation.id).where(
            ShopItemAllocation.shop_id == shop.id,
            ShopItemAllocation.item_id == item_id,
        )
    )
    if existing_allocation is None:
        db.add(ShopItemAllocation(shop_id=shop.id, item_id=item_id))
        _record_item_event(
            db,
            item_id=item_id,
            shop_id=shop.id,
            event_type="allocation.created",
            after={"shop_id": str(shop.id), "item_id": str(item_id)},
        )
        await db.commit()
    return await get_shop_item(db, shop, item_id)


async def _existing_allocation_item_ids(
    db: AsyncSession,
    shop_id: UUID,
    item_ids: list[UUID],
) -> set[UUID]:
    if not item_ids:
        return set()
    return set(
        (
            await db.scalars(
                select(ShopItemAllocation.item_id).where(
                    ShopItemAllocation.shop_id == shop_id,
                    ShopItemAllocation.item_id.in_(item_ids),
                )
            )
        ).all()
    )


def _add_catalogue_item_allocations(db: AsyncSession, shop: Shop, item_ids: list[UUID]) -> None:
    for item_id in item_ids:
        db.add(ShopItemAllocation(shop_id=shop.id, item_id=item_id))
        _record_item_event(
            db,
            item_id=item_id,
            shop_id=shop.id,
            event_type="allocation.created",
            after={"shop_id": str(shop.id), "item_id": str(item_id)},
        )


async def allocate_catalogue_items(
    db: AsyncSession,
    shop: Shop,
    item_ids: list[UUID],
) -> ShopItemAllocationBulkRead:
    unique_item_ids = list(dict.fromkeys(item_ids))
    items = (
        await db.scalars(select(Item).where(Item.id.in_(unique_item_ids)).with_for_update())
    ).all()
    items_by_id = {item.id: item for item in items}

    for item_id in unique_item_ids:
        item = items_by_id.get(item_id)
        if item is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
        if item.shop_id is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Only catalogue items can be allocated to a shop",
            )
        if not item.is_active:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Inactive catalogue items cannot be allocated to a shop",
            )

    existing_item_ids = await _existing_allocation_item_ids(db, shop.id, unique_item_ids)
    new_item_ids = [item_id for item_id in unique_item_ids if item_id not in existing_item_ids]
    allocated_count = len(new_item_ids)

    if new_item_ids:
        _add_catalogue_item_allocations(db, shop, new_item_ids)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            existing_after_conflict = await _existing_allocation_item_ids(
                db, shop.id, unique_item_ids
            )
            retry_item_ids = [
                item_id for item_id in unique_item_ids if item_id not in existing_after_conflict
            ]
            allocated_count = len(retry_item_ids)
            if retry_item_ids:
                _add_catalogue_item_allocations(db, shop, retry_item_ids)
                try:
                    await db.commit()
                except IntegrityError:
                    await db.rollback()
                    final_existing_item_ids = await _existing_allocation_item_ids(
                        db, shop.id, unique_item_ids
                    )
                    if not set(unique_item_ids).issubset(final_existing_item_ids):
                        raise
                    allocated_count = 0

    return ShopItemAllocationBulkRead(
        item_ids=unique_item_ids,
        allocated_count=allocated_count,
        already_allocated_count=len(unique_item_ids) - allocated_count,
    )


async def deallocate_catalogue_item(db: AsyncSession, shop: Shop, item_id: UUID) -> ShopItemRead:
    item = await db.scalar(select(Item).where(Item.id == item_id))
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    if item.shop_id is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Shop-owned items cannot be deallocated; pause or delete the shop item instead",
        )

    allocation = await db.scalar(
        select(ShopItemAllocation).where(
            ShopItemAllocation.shop_id == shop.id,
            ShopItemAllocation.item_id == item_id,
        )
    )
    if allocation is not None:
        _record_item_event(
            db,
            item_id=item_id,
            shop_id=shop.id,
            event_type="allocation.deleted",
            before={
                "shop_id": str(shop.id),
                "item_id": str(item_id),
                "display_name": allocation.display_name,
                "tamil_name": allocation.tamil_name,
                "is_active": allocation.is_active,
                "sort_order": allocation.sort_order,
                "custom_attributes": dict(allocation.custom_attributes or {}),
            },
        )
        await db.delete(allocation)
        await db.commit()
    return await get_shop_item(db, shop, item_id)


async def update_catalogue_item_allocation(
    db: AsyncSession,
    shop: Shop,
    item_id: UUID,
    payload: ShopItemAllocationUpdate,
) -> ShopItemRead:
    allocation = await db.scalar(
        select(ShopItemAllocation)
        .join(Item, Item.id == ShopItemAllocation.item_id)
        .where(
            ShopItemAllocation.shop_id == shop.id,
            ShopItemAllocation.item_id == item_id,
            Item.shop_id.is_(None),
        )
        .with_for_update()
    )
    if allocation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Allocation not found")

    before = {
        "shop_id": str(shop.id),
        "item_id": str(item_id),
        "display_name": allocation.display_name,
        "tamil_name": allocation.tamil_name,
        "is_active": allocation.is_active,
        "sort_order": allocation.sort_order,
        "custom_attributes": dict(allocation.custom_attributes or {}),
    }
    if "display_name" in payload.model_fields_set:
        allocation.display_name = _coalesce_text(payload.display_name)
    if "tamil_name" in payload.model_fields_set:
        allocation.tamil_name = _coalesce_text(payload.tamil_name)
    if payload.is_active is not None:
        allocation.is_active = payload.is_active
    if payload.sort_order is not None:
        allocation.sort_order = payload.sort_order
    if "custom_attributes" in payload.model_fields_set:
        allocation.custom_attributes = dict(payload.custom_attributes)
    _record_item_event(
        db,
        item_id=item_id,
        shop_id=shop.id,
        event_type="allocation.updated",
        before=before,
        after={
            "shop_id": str(shop.id),
            "item_id": str(item_id),
            "display_name": allocation.display_name,
            "tamil_name": allocation.tamil_name,
            "is_active": allocation.is_active,
            "sort_order": allocation.sort_order,
            "custom_attributes": dict(allocation.custom_attributes or {}),
        },
    )
    await db.commit()
    return await get_shop_item(db, shop, item_id)


def _bill_to_read(bill: Bill) -> BillRead:
    """Serialise a fully-loaded ``Bill`` ORM object to ``BillRead``.

    Assumes ``bill.shop``, ``bill.payment``, and ``bill.receipt`` are already
    eagerly loaded (via ``contains_eager``).  ``bill.items`` must also be
    loaded with their nested ``item`` relationship.
    """
    return BillRead(
        id=bill.id,
        bill_no=bill.bill_no,
        shop_id=bill.shop_id,
        shop_name=bill.shop.name,
        total_amount=bill.total_amount,
        status=bill.status.value,
        created_at=bill.created_at,
        items=[
            BillLineRead(
                item_id=line.item_id,
                item_name=line.item_name
                or (line.item.name if line.item is not None else "Unknown item"),
                item_tamil_name=line.item_tamil_name
                if line.item_tamil_name is not None
                else (line.item.tamil_name if line.item is not None else None),
                item_unit_type=line.item_unit_type
                if line.item_unit_type is not None
                else (line.item.unit_type if line.item is not None else None),
                item_base_unit=line.item_base_unit or line.unit,
                quantity=line.quantity,
                unit=line.unit,
                price_per_unit=line.price_per_unit,
                line_total=line.line_total,
            )
            # Sort in Python — selectinload doesn't support order_by in load options.
            # Move this to the Bill.items relationship order_by if ordering becomes
            # a performance concern at high item counts.
            for line in sorted(bill.items, key=lambda li: li.id)
        ],
        payment=PaymentRead.model_validate(bill.payment),
        receipt=ReceiptRead.model_validate(bill.receipt),
    )


def _get_period_bounds(
    period: AnalyticsPeriod,
    reference_date: date | None = None,
    range_start_date: date | None = None,
    range_end_date: date | None = None,
) -> tuple[datetime, datetime]:
    if period == "range":
        if range_start_date is None or range_end_date is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="range_start_date and range_end_date are required for custom ranges.",
            )
        if range_end_date < range_start_date:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="range_end_date must be on or after range_start_date.",
            )
        start = datetime(
            range_start_date.year,
            range_start_date.month,
            range_start_date.day,
            tzinfo=UTC,
        )
        end = datetime(
            range_end_date.year,
            range_end_date.month,
            range_end_date.day,
            tzinfo=UTC,
        ) + timedelta(days=1)
        return start, end

    base_date = reference_date or datetime.now(UTC).date()
    now = datetime(base_date.year, base_date.month, base_date.day, tzinfo=UTC)

    if period == "date":
        start = datetime(now.year, now.month, now.day, tzinfo=UTC)
        end = start + timedelta(days=1)
        return start, end

    if period == "month":
        start = datetime(now.year, now.month, 1, tzinfo=UTC)
        end = datetime(
            now.year + (1 if now.month == 12 else 0),
            1 if now.month == 12 else now.month + 1,
            1,
            tzinfo=UTC,
        )
        return start, end

    if period == "year":
        start = datetime(now.year, 1, 1, tzinfo=UTC)
        end = datetime(now.year + 1, 1, 1, tzinfo=UTC)
        return start, end

    start = now - timedelta(days=now.weekday())
    end = start + timedelta(days=7)
    return start, end


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

    existing_user = await db.scalar(select(User.id).where(func.lower(User.username) == username))
    if existing_user is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")

    user = User(
        username=username,
        password_hash=get_password_hash(payload.password),
        role=UserRole.SHOP_ACCOUNT,
        is_active=True,
    )
    shop = Shop(name=shop_name, owner=user, is_active=True)
    db.add_all([user, shop])
    await db.flush()
    await db.commit()
    return _shop_to_read(shop)


async def update_shop_account(db: AsyncSession, shop_id: UUID, payload: ShopUpdate) -> ShopRead:
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
        .where(Shop.id == shop_id)
        .with_for_update()
    )
    shop = result.scalar_one_or_none()
    if shop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shop not found")

    username = payload.username
    shop_name = payload.name.strip()
    new_password = payload.password

    has_changes = False

    if shop.name != shop_name:
        shop.name = shop_name
        has_changes = True

    if shop.owner.username != username:
        # Uniqueness check is only needed when the username actually changes.
        existing = await db.scalar(
            select(User.id).where(func.lower(User.username) == username, User.id != shop.owner.id)
        )
        if existing is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Username already exists"
            )
        shop.owner.username = username
        has_changes = True

    if new_password is not None:
        shop.owner.password_hash = get_password_hash(new_password)
        has_changes = True

    if not has_changes:
        return _shop_to_read(shop)

    await db.flush()  # batch both UPDATEs before the commit
    await db.commit()
    return _shop_to_read(shop)


async def delete_shop_account(db: AsyncSession, shop_id: UUID) -> None:
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
        .where(Shop.id == shop_id)
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


async def list_shops(db: AsyncSession) -> list[ShopRead]:
    """Return all shops projected to ShopRead in a single flat query.

    Uses a column-level projection instead of ``joinedload`` so only the
    5 columns required by ``ShopRead`` are fetched from the DB — the full
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
        )
        .join(Shop.owner)
        .order_by(Shop.id.asc())
    )
    return [
        ShopRead(
            id=r.id,
            name=r.name,
            is_active=r.is_active,
            created_at=r.created_at,
            username=r.username,
        )
        for r in rows.mappings()
    ]


async def get_shop_by_id(db: AsyncSession, shop_id: UUID) -> ShopRead:
    """Fetch a single shop by PK using a flat projection JOIN.

    One SQL JOIN selecting only the 5 columns ShopRead needs — no ORM object
    instantiation, no secondary SELECT for the owner row.
    """
    row = await db.execute(
        select(
            Shop.id,
            Shop.name,
            Shop.is_active,
            Shop.created_at,
            User.username,
        )
        .join(Shop.owner)
        .where(Shop.id == shop_id)
    )
    result = row.mappings().one_or_none()
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shop not found")
    return ShopRead(**result)


async def create_item(
    db: AsyncSession,
    payload: ItemCreate,
    image: UploadFile | None = None,
    shop_id: UUID | None = None,
) -> ItemRead:
    item_name = _normalize_item_name(payload.name)
    await _ensure_unique_item_name(db, item_name, shop_id=shop_id)
    item_category = await _resolve_item_category(
        db, category_id=payload.category_id, category_name=payload.category
    )

    item = Item(
        shop_id=shop_id,
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
        _record_item_event(
            db,
            item_id=item.id,
            shop_id=shop_id,
            event_type="item.created",
            after=_json_safe_item_state(item),
        )
        await db.commit()
        return _item_to_read(item)
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
) -> ItemRead:
    filters = [Item.id == item_id]
    if shop_id is not None:
        filters.append(Item.shop_id == shop_id)
    item = await db.scalar(select(Item).where(*filters).with_for_update())
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    item_name = _normalize_item_name(payload.name)
    tamil_name = _normalize_tamil_item_name(payload.tamil_name)
    item_category = await _resolve_item_category(
        db, category_id=payload.category_id, category_name=payload.category
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
            exclude_item_id=item_id,
        )

    should_remove_image = remove_image and image is None and bool(
        item.image_object_key or item.image_thumbnail_object_key
    )
    if not configuration_changed and image is None and not should_remove_image:
        return _item_to_read(item)

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
        return _item_to_read(item)
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
) -> ItemRead:
    filters = [Item.id == item_id]
    if shop_id is not None:
        filters.append(Item.shop_id == shop_id)
    item = await db.scalar(select(Item).where(*filters).with_for_update())
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    previous_state = _json_safe_item_state(item)
    next_name = _normalize_item_name(payload.name) if payload.name is not None else item.name
    next_tamil_name = (
        _normalize_tamil_item_name(payload.tamil_name)
        if payload.tamil_name is not None
        else item.tamil_name
    )
    category_fields_set = "category_id" in payload.model_fields_set or "category" in payload.model_fields_set
    next_category = (
        await _resolve_item_category(
            db, category_id=payload.category_id, category_name=payload.category
        )
        if category_fields_set
        else None
    )
    next_category_id = (
        next_category.id if next_category is not None else None
    ) if category_fields_set else item.category_id
    next_category_name = (
        next_category.name if next_category is not None else None
    ) if category_fields_set else item.category
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
    if not configuration_changed:
        return _item_to_read(item)

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
    return _item_to_read(item)


async def delete_item(db: AsyncSession, item_id: UUID, shop_id: UUID | None = None) -> None:
    filters = [Item.id == item_id]
    if shop_id is not None:
        filters.append(Item.shop_id == shop_id)
    item = await db.scalar(select(Item).where(*filters).with_for_update())
    if item is None:
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


async def set_shop_active_state(db: AsyncSession, shop_id: UUID, is_active: bool) -> ShopRead:
    """Toggle is_active on both Shop and its owner User in one transaction.

    Uses a single JOIN SELECT with ``with_for_update()`` to prevent a
    lost-update race when two admins toggle the same shop concurrently.
    """
    result = await db.execute(
        select(Shop)
        .join(Shop.owner)
        .options(contains_eager(Shop.owner))
        .where(Shop.id == shop_id)
        .with_for_update()
    )
    shop = result.scalar_one_or_none()
    if shop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shop not found")

    shop.is_active = is_active
    shop.owner.is_active = is_active
    await db.flush()  # batch both UPDATEs before the commit
    await db.commit()
    return _shop_to_read(shop)


async def get_bill_by_id(db: AsyncSession, bill_id: UUID) -> BillRead:
    """Fetch a single bill with all related data in one SQL statement.

    Uses explicit JOINs with ``contains_eager`` for the to-one relationships
    (shop, payment, receipt) to avoid the 3 separate round-trips that
    ``joinedload`` would fire via the identity map.  Bill items are loaded
    with ``selectinload`` + nested ``joinedload`` for the item catalogue row.
    """
    result = await db.execute(
        select(Bill)
        .join(Bill.shop)
        .outerjoin(Bill.payment)
        .outerjoin(Bill.receipt)
        .options(
            contains_eager(Bill.shop),
            contains_eager(Bill.payment),
            contains_eager(Bill.receipt),
            selectinload(Bill.items).joinedload(BillItem.item),
        )
        .where(Bill.id == bill_id)
    )
    bill = result.scalar_one_or_none()
    if bill is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bill not found")
    return _bill_to_read(bill)


async def get_shop_sales_summary(
    db: AsyncSession,
    period: AnalyticsPeriod = "date",
    reference_date: date | None = None,
    shop_id: UUID | None = None,
    range_start_date: date | None = None,
    range_end_date: date | None = None,
) -> list[ShopSalesSummary]:
    """Return total sales grouped by shop for the given time period.

    Uses a LEFT OUTER JOIN so shops with zero bills in the window still
    appear in the result (with ``total_sales = 0``).

    Args:
        db: Async database session.
        period: Granularity bucket — ``"date"``, ``"month"``, ``"week"``, ``"year"``, or ``"range"``.
        reference_date: Anchor date for the period window (defaults to today).
        shop_id: When provided, restricts results to a single shop.
    """
    start, end = _get_period_bounds(period, reference_date, range_start_date, range_end_date)
    filters = [Bill.created_at >= start, Bill.created_at < end]
    if shop_id is not None:
        filters.append(Bill.shop_id == shop_id)

    result = await db.execute(
        select(
            Shop.id,
            Shop.name,
            func.coalesce(func.sum(Bill.total_amount), 0).label("total_sales"),
        )
        .outerjoin(
            Bill,
            and_(Bill.shop_id == Shop.id, *filters),
        )
        .where(Shop.id == shop_id if shop_id is not None else True)
        .group_by(Shop.id)
        .order_by(Shop.name)
    )
    return [
        ShopSalesSummary(
            shop_id=row.id,
            shop_name=row.name,
            total_sales=row.total_sales,
        )
        for row in result.all()
    ]


async def get_payment_split_summary(
    db: AsyncSession,
    period: AnalyticsPeriod = "date",
    reference_date: date | None = None,
    shop_id: UUID | None = None,
    range_start_date: date | None = None,
    range_end_date: date | None = None,
) -> list[PaymentSplitSummary]:
    """Return cash/UPI payment totals grouped by shop for the given time period.

    Uses a double LEFT OUTER JOIN (shops → bills → payments) so:
    - Shops with no bills appear with zero totals.
    - Bills with no matching payment row are safely excluded via COALESCE.

    Args:
        db: Async database session.
        period: Granularity bucket — ``"date"``, ``"month"``, ``"week"``, ``"year"``, or ``"range"``.
        reference_date: Anchor date for the period window (defaults to today).
        shop_id: When provided, restricts results to a single shop.
    """
    start, end = _get_period_bounds(period, reference_date, range_start_date, range_end_date)
    filters = [Bill.created_at >= start, Bill.created_at < end]
    if shop_id is not None:
        filters.append(Bill.shop_id == shop_id)

    result = await db.execute(
        select(
            Shop.id,
            Shop.name,
            func.coalesce(func.sum(Payment.cash_amount), 0).label("cash_total"),
            func.coalesce(func.sum(Payment.upi_amount), 0).label("upi_total"),
        )
        .outerjoin(
            Bill,
            and_(Bill.shop_id == Shop.id, *filters),
        )
        .outerjoin(Payment, Payment.bill_id == Bill.id)
        .where(Shop.id == shop_id if shop_id is not None else True)
        .group_by(Shop.id)
        .order_by(Shop.name)
    )
    return [
        PaymentSplitSummary(
            shop_id=row.id,
            shop_name=row.name,
            cash_total=row.cash_total,
            upi_total=row.upi_total,
        )
        for row in result.all()
    ]


async def get_daily_bills(
    db: AsyncSession,
    period: AnalyticsPeriod = "date",
    reference_date: date | None = None,
    shop_id: UUID | None = None,
    limit: int = 100,
    cursor_created_at: datetime | None = None,
    cursor_id: UUID | None = None,
    range_start_date: date | None = None,
    range_end_date: date | None = None,
    # Inject stats if precalculated to avoid redundant queries
    precalculated_stats: list[AdminBillShopStat] | None = None,
    precalculated_largest_bill: AdminBillSummary | None = None,
) -> AdminBillPage:
    """Return a cursor-paginated page of bills for the given time period.

    Cursor pagination uses ``(created_at DESC, id DESC)`` ordering.  Pass the
    ``next_cursor_created_at`` / ``next_cursor_id`` values from a previous
    response to fetch the next page.

    When called standalone (router path), the stats, bill-page, and largest-
    bill queries are executed in sequence on the same ``AsyncSession``.
    This avoids unsupported concurrent use of one SQLAlchemy session.
    When called from ``get_dashboard_bootstrap``, precalculated stats and the
    largest-bill are injected to skip those redundant queries.

    Args:
        db: Async database session.
        period: Granularity bucket — ``"date"``, ``"month"``, ``"week"``, ``"year"``, or ``"range"``.
        reference_date: Anchor date for the period window (defaults to today).
        shop_id: When provided, restricts results to a single shop.
        limit: Maximum bills per page.
        cursor_created_at: Pagination cursor timestamp (both cursor fields required together).
        cursor_id: Pagination cursor bill ID (both cursor fields required together).
        precalculated_stats: Pre-fetched shop stats; skips the stats query when provided.
        precalculated_largest_bill: Pre-fetched largest bill; skips that query when provided.
    """
    # Validate cursor — both fields must be supplied or both omitted.
    if (cursor_created_at is None) != (cursor_id is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="cursor_created_at and cursor_id must both be provided or both omitted.",
        )

    start, end = _get_period_bounds(period, reference_date, range_start_date, range_end_date)
    base_filters = [Bill.created_at >= start, Bill.created_at < end]
    if shop_id is not None:
        base_filters.append(Bill.shop_id == shop_id)

    page_filters = list(base_filters)
    if cursor_created_at is not None:
        page_filters.append(
            or_(
                Bill.created_at < cursor_created_at,
                and_(Bill.created_at == cursor_created_at, Bill.id < cursor_id),
            )
        )

    # Bills page query is always needed.
    bills_query = (
        select(Bill, Shop.name)
        .join(Shop, Shop.id == Bill.shop_id)
        .where(*page_filters)
        .order_by(Bill.created_at.desc(), Bill.id.desc())
        .limit(limit + 1)
    )

    if precalculated_stats is None:
        stats_result = await db.execute(
            select(
                Bill.shop_id,
                func.count(Bill.id).label("bill_count"),
                func.max(Bill.created_at).label("last_bill_at"),
            )
            .where(*base_filters)
            .group_by(Bill.shop_id)
        )
        bills_result = await db.execute(bills_query)
        largest_result = await db.execute(
            select(Bill, Shop.name)
            .join(Shop, Shop.id == Bill.shop_id)
            .where(*base_filters)
            .order_by(Bill.total_amount.desc(), Bill.created_at.desc(), Bill.id.desc())
            .limit(1)
        )
        shop_stats = [
            AdminBillShopStat(
                shop_id=row.shop_id,
                bill_count=int(row.bill_count),
                last_bill_at=row.last_bill_at,
            )
            for row in stats_result.all()
        ]
        bill_rows = bills_result.all()
        largest_row = largest_result.first()
        if largest_row is not None:
            bill, shop_name = largest_row
            largest_bill: AdminBillSummary | None = AdminBillSummary(
                bill_id=bill.id,
                bill_no=bill.bill_no,
                shop_id=bill.shop_id,
                shop_name=shop_name,
                total_amount=bill.total_amount,
                status=bill.status.value,
                created_at=bill.created_at,
            )
        else:
            largest_bill = None
    else:
        # Bootstrap path: precalculated data injected — only fetch the bill page.
        bills_result = await db.execute(bills_query)
        bill_rows = bills_result.all()
        shop_stats = precalculated_stats
        largest_bill = precalculated_largest_bill

    total_count = sum(stat.bill_count for stat in shop_stats)
    has_more = len(bill_rows) > limit
    paged_rows = bill_rows[:limit]

    items = [
        AdminBillSummary(
            bill_id=bill.id,
            bill_no=bill.bill_no,
            shop_id=bill.shop_id,
            shop_name=shop_name,
            total_amount=bill.total_amount,
            status=bill.status.value,
            created_at=bill.created_at,
        )
        for bill, shop_name in paged_rows
    ]

    next_cursor_created_at = None
    next_cursor_id = None
    if has_more and paged_rows:
        last_bill, _ = paged_rows[-1]
        next_cursor_created_at = last_bill.created_at
        next_cursor_id = last_bill.id

    return AdminBillPage(
        items=items,
        limit=limit,
        has_more=has_more,
        total_count=total_count,
        largest_bill=largest_bill,
        shop_stats=shop_stats,
        next_cursor_created_at=next_cursor_created_at,
        next_cursor_id=next_cursor_id,
    )


async def get_item_sales_summary(
    db: AsyncSession,
    period: AnalyticsPeriod = "date",
    reference_date: date | None = None,
    shop_id: UUID | None = None,
    limit: int = 100,
    range_start_date: date | None = None,
    range_end_date: date | None = None,
) -> list[ItemSalesSummary]:
    """Return quantity sold and revenue grouped by item for the given time period.

    Uses INNER JOINs (items → bill_items → bills) so only items that
    actually appear in at least one bill within the window are returned.
    Items with no sales are excluded — use ``get_shop_sales_summary`` if
    you need a full shop-level zero-padded view.

    Results are ordered by revenue descending so the best-selling items
    appear first.

    Args:
        db: Async database session.
        period: Granularity bucket — ``"date"``, ``"month"``, ``"week"``, ``"year"``, or ``"range"``.
        reference_date: Anchor date for the period window (defaults to today).
        shop_id: When provided, restricts results to bills from a single shop.
        limit: Maximum number of items to return (default 100, max 500).
    """
    start, end = _get_period_bounds(period, reference_date, range_start_date, range_end_date)

    # Build all filters upfront so the query is constructed in one pass.
    filters = [Bill.created_at >= start, Bill.created_at < end]
    if shop_id is not None:
        filters.append(Bill.shop_id == shop_id)

    total_amount_label = func.coalesce(func.sum(BillItem.line_total), 0).label("total_amount")

    result = await db.execute(
        select(
            Item.id,
            Item.name,
            Item.tamil_name,
            Item.base_unit,
            func.coalesce(func.sum(BillItem.quantity), 0).label("quantity_sold"),
            total_amount_label,
            # BillItem.bill_id.distinct() avoids the heavier COUNT(DISTINCT bill.id)
            # which requires a sort/hash dedup pass over the full Bill PK.
            func.count(BillItem.bill_id.distinct()).label("bill_count"),
        )
        .join(BillItem, BillItem.item_id == Item.id)
        .join(Bill, Bill.id == BillItem.bill_id)
        .where(*filters)
        # Item.id is the PK — name and base_unit are functionally dependent,
        # so GROUP BY the key alone is sufficient (PostgreSQL allows this).
        .group_by(Item.id)
        # Reference the labelled aggregate instead of re-evaluating SUM(line_total).
        .order_by(text("total_amount DESC"), Item.name)
        .limit(limit)
    )
    return [
        ItemSalesSummary(
            item_id=row.id,
            item_name=row.name,
            item_tamil_name=row.tamil_name,
            base_unit=row.base_unit,
            quantity_sold=row.quantity_sold,
            total_amount=row.total_amount,
            bill_count=int(row.bill_count),
        )
        for row in result.all()
    ]


async def get_dashboard_bootstrap(
    db: AsyncSession,
    period: AnalyticsPeriod = "date",
    reference_date: date | None = None,
    shop_id: UUID | None = None,
    bills_limit: int = 50,
    range_start_date: date | None = None,
    range_end_date: date | None = None,
) -> AdminDashboardBootstrap:
    """Return the admin dashboard payload with minimal duplicate work.

    The aggregate shop metrics are computed once and then reused to build the
    sales summary, payment summary, and bill shop stats. When the selected
    period has no bills, the expensive largest-bill, bill-page, and item-sales
    queries are skipped entirely.
    """
    start, end = _get_period_bounds(period, reference_date, range_start_date, range_end_date)
    shops = await list_shops(db)
    base_filters = [
        Bill.created_at >= start,
        Bill.created_at < end,
    ]
    if shop_id is not None:
        base_filters.append(Bill.shop_id == shop_id)

    # Since sqlite and some DBs have issues with multiple SUMs from different joined tables due to cartesian product
    # The safest performant way is to join Payment to Bill (1-to-1) and then group by Shop
    combined_query = (
        select(
            Shop.id,
            Shop.name,
            func.coalesce(func.sum(Bill.total_amount), 0).label("total_sales"),
            func.coalesce(func.sum(Payment.cash_amount), 0).label("cash_total"),
            func.coalesce(func.sum(Payment.upi_amount), 0).label("upi_total"),
            func.count(distinct(Bill.id)).label("bill_count"),
            func.max(Bill.created_at).label("last_bill_at"),
            # Also find the largest bill ID if possible? No, we can just do a fast limit 1 query.
        )
        .outerjoin(Bill, and_(Bill.shop_id == Shop.id, *base_filters))
        .outerjoin(Payment, Payment.bill_id == Bill.id)
    )
    if shop_id is not None:
        combined_query = combined_query.where(Shop.id == shop_id)

    combined_query = combined_query.group_by(Shop.id).order_by(Shop.name)
    combined_rows = (await db.execute(combined_query)).all()

    sales_summary = []
    payment_summary = []
    shop_stats = []

    for row in combined_rows:
        if row.bill_count > 0:
            sales_summary.append(
                ShopSalesSummary(shop_id=row.id, shop_name=row.name, total_sales=row.total_sales)
            )
            payment_summary.append(
                PaymentSplitSummary(
                    shop_id=row.id,
                    shop_name=row.name,
                    cash_total=row.cash_total,
                    upi_total=row.upi_total,
                )
            )
        shop_stats.append(
            AdminBillShopStat(
                shop_id=row.id, bill_count=int(row.bill_count), last_bill_at=row.last_bill_at
            )
        )

    total_count = sum(stat.bill_count for stat in shop_stats)
    if total_count == 0:
        bills_page = AdminBillPage(
            items=[],
            limit=bills_limit,
            has_more=False,
            total_count=0,
            largest_bill=None,
            shop_stats=shop_stats,
            next_cursor_created_at=None,
            next_cursor_id=None,
        )
        return AdminDashboardBootstrap(
            shops=shops,
            sales_summary=sales_summary,
            payment_summary=payment_summary,
            bills=bills_page,
            item_sales=[],
        )

    # Fast largest bill query using index
    largest_row = (
        await db.execute(
            select(Bill, Shop.name)
            .join(Shop, Shop.id == Bill.shop_id)
            .where(*base_filters)
            .order_by(Bill.total_amount.desc())
            .limit(1)
        )
    ).first()
    largest_bill = None
    if largest_row is not None:
        bill, shop_name = largest_row
        largest_bill = AdminBillSummary(
            bill_id=bill.id,
            bill_no=bill.bill_no,
            shop_id=bill.shop_id,
            shop_name=shop_name,
            total_amount=bill.total_amount,
            status=bill.status.value,
            created_at=bill.created_at,
        )

    # 4. Fetch daily bills using precalculated stats
    bills_page = await get_daily_bills(
        db,
        period,
        reference_date,
        shop_id,
        bills_limit,
        range_start_date=range_start_date,
        range_end_date=range_end_date,
        precalculated_stats=shop_stats,
        precalculated_largest_bill=largest_bill,
    )
    item_sales = await get_item_sales_summary(
        db,
        period,
        reference_date,
        shop_id,
        range_start_date=range_start_date,
        range_end_date=range_end_date,
    )

    return AdminDashboardBootstrap(
        shops=shops,
        sales_summary=sales_summary,
        payment_summary=payment_summary,
        bills=bills_page,
        item_sales=item_sales,
    )
