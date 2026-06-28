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
    InventoryItem,
    InventoryItemCategory,
    Item,
    ItemAssumptionStatus,
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
    ItemAssumptionUpdate,
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

from app.services.admin._shared import (
    _coalesce_text,
    _count_query_rows,
    _item_assumption_read_kwargs,
    _json_safe_item_state,
    _merge_custom_attributes,
    _price_status_for,
    _record_item_event,
    _shop_item_visibility_filter,
    _sum_if,
    _zero_if_null,
)


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
            Item.assumption_percent,
            Item.assumption_inventory_item_id,
            Item.assumption_inventory_category_id,
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
        (
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
        )
        .mappings()
        .one()
    )
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
                **_item_assumption_read_kwargs(row),
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
                Item.assumption_percent,
                Item.assumption_inventory_item_id,
                Item.assumption_inventory_category_id,
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
        **_item_assumption_read_kwargs(row),
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
            bill_count == 0 and price_count == 0 and (is_shop_item or allocated_shop_count == 0)
        ),
        can_deallocate=not is_shop_item and is_allocated,
        bill_count=bill_count,
        price_count=price_count,
        allocated_shop_count=allocated_shop_count,
    )


def _compact_shop_item_from_row(row, shop: Shop, *, allocated: bool) -> ShopItemRead:
    is_shop_item = row.shop_id == shop.id
    effective_name = (
        _coalesce_text(
            getattr(row, "allocation_display_name", None),
            row.name,
        )
        or row.name
    )
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
        **_item_assumption_read_kwargs(row),
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
        Item.assumption_percent.label("assumption_percent"),
        Item.assumption_inventory_item_id.label("assumption_inventory_item_id"),
        Item.assumption_inventory_category_id.label("assumption_inventory_category_id"),
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
            Item.assumption_percent.label("assumption_percent"),
            Item.assumption_inventory_item_id.label("assumption_inventory_item_id"),
            Item.assumption_inventory_category_id.label("assumption_inventory_category_id"),
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
                func.lower(func.coalesce(source.c.allocation_display_name, "")).like(like_search),
                func.lower(func.coalesce(source.c.allocation_tamil_name, "")).like(like_search),
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
        (
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
        )
        .mappings()
        .one()
    )
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
        await db.scalars(select(Item).where(Item.shop_id == shop.id).with_for_update())
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
        Item.assumption_percent,
        Item.assumption_inventory_item_id,
        Item.assumption_inventory_category_id,
        Item.image_object_key,
        Item.image_content_type,
        Item.image_thumbnail_object_key,
        Item.image_thumbnail_content_type,
    ).where(
        Item.shop_id.is_(None),
        Item.is_active.is_(True),
        ~allocation_exists,
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
    items = [_compact_shop_item_from_row(row, shop, allocated=False) for row in page_rows]

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
        Item.assumption_percent,
        Item.assumption_inventory_item_id,
        Item.assumption_inventory_category_id,
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
        **_item_assumption_read_kwargs(row),
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
        select(ShopItemAllocation.id).where(ShopItemAllocation.item_id == Item.id).exists()
    )
    query = select(
        Item.id,
        Item.is_active,
        allocation_exists.label("is_allocated"),
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

    count_source = query.subquery()
    count_row = (
        (
            await db.execute(
                select(
                    func.count().label("all"),
                    _sum_if(count_source.c.is_allocated.is_(True)).label("allocated"),
                    _sum_if(count_source.c.is_allocated.is_(False)).label("available"),
                    _sum_if(count_source.c.is_active.is_(False)).label("paused"),
                ).select_from(count_source)
            )
        )
        .mappings()
        .one()
    )
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
            Item.assumption_percent,
            Item.assumption_inventory_item_id,
            Item.assumption_inventory_category_id,
            Item.image_object_key,
            Item.image_content_type,
            Item.image_thumbnail_object_key,
            Item.image_thumbnail_content_type,
            func.coalesce(bill_counts.c.bill_count, 0).label("bill_count"),
            func.coalesce(price_counts.c.price_count, 0).label("price_count"),
            func.coalesce(allocation_counts.c.allocated_shop_count, 0).label(
                "allocated_shop_count"
            ),
        )
        .outerjoin(bill_counts, bill_counts.c.item_id == Item.id)
        .outerjoin(price_counts, price_counts.c.item_id == Item.id)
        .outerjoin(allocation_counts, allocation_counts.c.item_id == Item.id)
        .where(Item.shop_id.is_(None))
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
        (
            await db.execute(
                select(
                    func.count().label("all"),
                    _sum_if(count_source.c.allocated_shop_count > 0).label("allocated"),
                    _sum_if(count_source.c.allocated_shop_count == 0).label("available"),
                    _sum_if(~count_source.c.is_active).label("paused"),
                ).select_from(count_source)
            )
        )
        .mappings()
        .one()
    )
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
                    and_(
                        Item.sort_order == cursor_sort_order, sort_name_expr > cursor_name.lower()
                    ),
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
            **_item_assumption_read_kwargs(row),
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
                Item.assumption_percent,
                Item.assumption_inventory_item_id,
                Item.assumption_inventory_category_id,
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
        **_item_assumption_read_kwargs(row),
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


