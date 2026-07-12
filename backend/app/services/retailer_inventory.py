from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.ids import uuid7
from app.core.timezone import ist_midnight
from app.models import (
    BaseUnit,
    Retailer,
    RetailerInventoryUsage,
    Shop,
    User,
)
from app.schemas.retailer_inventory import (
    RetailerInventoryUsageBulkCreate,
    RetailerInventoryUsageBulkResult,
    RetailerInventoryUsagePage,
    RetailerInventoryUsageRead,
    RetailerStockAdjustRequest,
)
from app.services.retailers import ensure_retailer_at_shop

from .inventory import (
    THREE_DECIMALS,
    ZERO,
    _bird_availability_for_transaction,
    _get_allocated_inventory_item_for_shop,
    _normalize_nonnegative_quantity,
    _normalize_quantity,
    _prepare_occurred_at,
    _quantity_availability_for_transaction,
    _quantity_exceeds_available,
    _retailer_usage_totals,
    _stock_item_for_shop_inventory_item,
    _validate_bird_count_ceiling,
    get_inventory_summary,
)


def _resolved_party_name(stored: str | None, live_name: str | None) -> str | None:
    if stored:
        return stored
    return live_name


def _retailer_shop_snapshot_name(retailer: Retailer | None) -> str:
    if retailer is None or retailer.shop_name is None:
        return ""
    return retailer.shop_name.strip()


async def _retailer_snapshot_name(db: AsyncSession, retailer_id: UUID | None) -> str:
    if retailer_id is None:
        return ""
    retailer = await db.get(Retailer, retailer_id)
    return retailer.name if retailer is not None else ""


async def _retailer_shop_snapshot_name_for_id(db: AsyncSession, retailer_id: UUID | None) -> str:
    if retailer_id is None:
        return ""
    retailer = await db.get(Retailer, retailer_id)
    return _retailer_shop_snapshot_name(retailer)


def _usage_to_read(usage: RetailerInventoryUsage) -> RetailerInventoryUsageRead:
    item = usage.item
    category = usage.category
    shop = usage.shop
    retailer = usage.retailer
    actor = usage.created_by
    return RetailerInventoryUsageRead(
        id=usage.id,
        shop_id=usage.shop_id,
        shop_name=_resolved_party_name(
            usage.shop_name,
            _retailer_shop_snapshot_name(retailer),
        ),
        retailer_id=usage.retailer_id,
        retailer_name=_resolved_party_name(
            usage.retailer_name,
            retailer.name if retailer is not None else None,
        ),
        inventory_item_id=usage.inventory_item_id,
        inventory_item_name=item.name if item is not None else "",
        inventory_item_tamil_name=item.tamil_name if item is not None else None,
        category_id=usage.category_id,
        category_name=category.name if category is not None else None,
        quantity=usage.quantity,
        bird_count=usage.bird_count,
        unit=item.base_unit if item is not None else BaseUnit.KG,
        occurred_at=usage.occurred_at,
        created_at=usage.created_at,
        created_by_user_id=usage.created_by_user_id,
        created_by_name=actor.username if actor is not None else None,
        adjustment_reason=usage.adjustment_reason,
    )


async def list_retailer_inventory_usages(
    db: AsyncSession,
    *,
    shop_id: UUID | None = None,
    item_id: UUID | None = None,
    retailer_id: UUID | None = None,
    reference_date: date | None = None,
    range_start_date: date | None = None,
    range_end_date: date | None = None,
    limit: int = 100,
) -> RetailerInventoryUsagePage:
    query = select(RetailerInventoryUsage).options(
        selectinload(RetailerInventoryUsage.shop),
        selectinload(RetailerInventoryUsage.retailer),
        selectinload(RetailerInventoryUsage.item),
        selectinload(RetailerInventoryUsage.category),
        selectinload(RetailerInventoryUsage.created_by),
    )
    if shop_id is not None:
        query = query.where(RetailerInventoryUsage.shop_id == shop_id)
    if item_id is not None:
        query = query.where(RetailerInventoryUsage.inventory_item_id == item_id)
    if retailer_id is not None:
        query = query.where(RetailerInventoryUsage.retailer_id == retailer_id)
    if range_start_date is not None or range_end_date is not None:
        if range_start_date is not None:
            query = query.where(
                RetailerInventoryUsage.occurred_at
                >= ist_midnight(range_start_date)
            )
        if range_end_date is not None:
            query = query.where(
                RetailerInventoryUsage.occurred_at
                < ist_midnight(range_end_date + timedelta(days=1))
            )
    elif reference_date is not None:
        query = query.where(
            RetailerInventoryUsage.occurred_at
            >= ist_midnight(reference_date),
            RetailerInventoryUsage.occurred_at
            < ist_midnight(reference_date + timedelta(days=1)),
        )
    rows = (
        await db.scalars(
            query.order_by(
                RetailerInventoryUsage.occurred_at.desc(),
                RetailerInventoryUsage.id.desc(),
            ).limit(limit + 1)
        )
    ).all()
    page_rows = rows[:limit]
    return RetailerInventoryUsagePage(
        items=[_usage_to_read(row) for row in page_rows],
        limit=limit,
        has_more=len(rows) > limit,
    )


async def record_retailer_inventory_usages_bulk(
    db: AsyncSession,
    shop: Shop,
    payload: RetailerInventoryUsageBulkCreate,
    *,
    actor: User | None = None,
    include_summary: bool = True,
) -> RetailerInventoryUsageBulkResult:
    await ensure_retailer_at_shop(db, retailer_id=payload.retailer_id, shop_id=shop.id)
    occurred_at = await _prepare_occurred_at(db, actor=actor, shop=shop, raw=payload.occurred_at)
    retailer_name = await _retailer_snapshot_name(db, payload.retailer_id)
    shop_name = await _retailer_shop_snapshot_name_for_id(db, payload.retailer_id)

    lines_by_item: dict[UUID, list] = {}
    for line in payload.lines:
        lines_by_item.setdefault(line.inventory_item_id, []).append(line)

    saved: list[RetailerInventoryUsage] = []
    for item_id, lines in lines_by_item.items():
        item, _allocation = await _get_allocated_inventory_item_for_shop(db, shop, item_id)
        category_ids = {link.category_id for link in item.category_links}
        item_total = ZERO
        item_bird_total = 0
        for line in lines:
            quantity = _normalize_quantity(item.base_unit, line.quantity)
            if category_ids:
                if line.category_id not in category_ids:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                        detail="Inventory category is not linked to this item",
                    )
            elif line.category_id is not None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="Inventory category is not linked to this item",
                )
            item_total += quantity
            item_bird_total += line.bird_count

        available_quantity = await _quantity_availability_for_transaction(
            db,
            shop.id,
            item.id,
            raw_occurred_at=payload.occurred_at,
            occurred_at=occurred_at,
        )
        if _quantity_exceeds_available(item_total, available_quantity):
            requested = item_total.quantize(THREE_DECIMALS)
            available = available_quantity.quantize(THREE_DECIMALS)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Retailer stock for {item.name} exceeds available quantity "
                    f"({requested} requested, {available} available)"
                ),
            )
        added_bird_count, available_bird_count = await _bird_availability_for_transaction(
            db,
            shop.id,
            item.id,
            raw_occurred_at=payload.occurred_at,
            occurred_at=occurred_at,
        )
        _validate_bird_count_ceiling(
            item,
            item_bird_total,
            available_bird_count=available_bird_count,
            added_bird_count=added_bird_count,
        )

        for line in lines:
            quantity = _normalize_quantity(item.base_unit, line.quantity)
            usage = RetailerInventoryUsage(
                id=uuid7(),
                shop_id=shop.id,
                retailer_id=payload.retailer_id,
                retailer_name=retailer_name,
                shop_name=shop_name,
                inventory_item_id=item.id,
                category_id=line.category_id,
                quantity=quantity,
                bird_count=line.bird_count,
                occurred_at=occurred_at,
                created_by_user_id=actor.id if actor is not None else None,
            )
            db.add(usage)
            saved.append(usage)

    await db.commit()
    for usage in saved:
        await db.refresh(usage)

    loaded = (
        await db.scalars(
            select(RetailerInventoryUsage)
            .where(RetailerInventoryUsage.id.in_([row.id for row in saved]))
            .options(
                selectinload(RetailerInventoryUsage.shop),
                selectinload(RetailerInventoryUsage.retailer),
                selectinload(RetailerInventoryUsage.item),
                selectinload(RetailerInventoryUsage.category),
                selectinload(RetailerInventoryUsage.created_by),
            )
        )
    ).all()

    summary = None
    if include_summary:
        summary = await get_inventory_summary(
            db, shop, include_unallocated=False, active_allocations_only=True
        )

    return RetailerInventoryUsageBulkResult(
        usages=[_usage_to_read(row) for row in loaded],
        summary=summary,
    )


async def admin_set_retailer_inventory_stock(
    db: AsyncSession,
    shop: Shop,
    item_id: UUID,
    payload: RetailerStockAdjustRequest,
    *,
    actor: User | None = None,
):
    occurred_at = await _prepare_occurred_at(db, actor=actor, shop=shop, raw=payload.occurred_at)
    item, allocation = await _get_allocated_inventory_item_for_shop(db, shop, item_id)
    category_ids = {link.category_id for link in item.category_links}
    if payload.category_id is not None and payload.category_id not in category_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Inventory category is not linked to this item",
        )

    (
        retailer_used_today,
        category_retailer_used_today,
        retailer_used_today_bird,
        category_retailer_used_today_bird,
    ) = await _retailer_usage_totals(db, shop.id, [item_id], used_since=date.today())

    delta = ZERO
    if payload.retailer_used_quantity is not None:
        target_used = _normalize_nonnegative_quantity(
            item.base_unit, payload.retailer_used_quantity
        )
        if payload.category_id:
            current_used = category_retailer_used_today.get((item_id, payload.category_id), ZERO)
        else:
            current_used = retailer_used_today.get(item_id, ZERO)

        delta = (target_used - current_used).quantize(Decimal("0.001"))

    birds_delta = 0
    if payload.retailer_used_bird_count is not None and item.base_unit == BaseUnit.KG:
        if payload.category_id:
            current_bird = category_retailer_used_today_bird.get(
                (item_id, payload.category_id), 0
            )
        else:
            current_bird = retailer_used_today_bird.get(item_id, 0)
        birds_delta = payload.retailer_used_bird_count - current_bird

    if delta != ZERO or birds_delta != 0:
        if payload.retailer_id is not None:
            await ensure_retailer_at_shop(
                db, retailer_id=payload.retailer_id, shop_id=shop.id
            )
        retailer_name = await _retailer_snapshot_name(db, payload.retailer_id)
        shop_name = await _retailer_shop_snapshot_name_for_id(db, payload.retailer_id)
        adjustment_reason = payload.adjustment_reason
        if delta != ZERO:
            usage = RetailerInventoryUsage(
                shop_id=shop.id,
                retailer_id=payload.retailer_id,
                retailer_name=retailer_name,
                shop_name=shop_name,
                inventory_item_id=item_id,
                category_id=payload.category_id,
                quantity=delta,
                bird_count=abs(birds_delta) if birds_delta > 0 and delta != ZERO else 0,
                occurred_at=occurred_at,
                created_by_user_id=actor.id if actor is not None else None,
                adjustment_reason=adjustment_reason,
            )
            db.add(usage)
            birds_delta = 0 if birds_delta > 0 else birds_delta

        if birds_delta != 0:
            trace = THREE_DECIMALS
            if birds_delta > 0:
                db.add(
                    RetailerInventoryUsage(
                        shop_id=shop.id,
                        retailer_id=payload.retailer_id,
                        retailer_name=retailer_name,
                        shop_name=shop_name,
                        inventory_item_id=item_id,
                        category_id=payload.category_id,
                        quantity=trace,
                        bird_count=birds_delta,
                        occurred_at=occurred_at,
                        created_by_user_id=actor.id if actor is not None else None,
                        adjustment_reason=adjustment_reason,
                    )
                )
                db.add(
                    RetailerInventoryUsage(
                        shop_id=shop.id,
                        retailer_id=payload.retailer_id,
                        retailer_name=retailer_name,
                        shop_name=shop_name,
                        inventory_item_id=item_id,
                        category_id=payload.category_id,
                        quantity=-trace,
                        bird_count=0,
                        occurred_at=occurred_at,
                        created_by_user_id=actor.id if actor is not None else None,
                        adjustment_reason=adjustment_reason,
                    )
                )
            else:
                db.add(
                    RetailerInventoryUsage(
                        shop_id=shop.id,
                        retailer_id=payload.retailer_id,
                        retailer_name=retailer_name,
                        shop_name=shop_name,
                        inventory_item_id=item_id,
                        category_id=payload.category_id,
                        quantity=trace,
                        bird_count=0,
                        occurred_at=occurred_at,
                        created_by_user_id=actor.id if actor is not None else None,
                        adjustment_reason=adjustment_reason,
                    )
                )
                db.add(
                    RetailerInventoryUsage(
                        shop_id=shop.id,
                        retailer_id=payload.retailer_id,
                        retailer_name=retailer_name,
                        shop_name=shop_name,
                        inventory_item_id=item_id,
                        category_id=payload.category_id,
                        quantity=-trace,
                        bird_count=birds_delta,
                        occurred_at=occurred_at,
                        created_by_user_id=actor.id if actor is not None else None,
                        adjustment_reason=adjustment_reason,
                    )
                )
        await db.commit()

    return await _stock_item_for_shop_inventory_item(
        db, shop, item, allocation, used_since=date.today()
    )
