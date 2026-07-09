"""Admin retailer CRUD and item price mapping."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.storage import build_item_image_path, build_item_image_thumb_path
from app.models import (
    DailyPrice,
    Item,
    Retailer,
    RetailerItemPrice,
    RetailerSale,
    RetailerSaleStatus,
    Shop,
    ShopItemAllocation,
    ShopRetailerAllocation,
    ShopRetailerItemAllocation,
)
from app.schemas.retailers import (
    PriceHistoryEntry,
    RetailerBalanceRead,
    RetailerBranchAllocationRead,
    RetailerCreate,
    RetailerItemAllocationBulkRead,
    RetailerItemAllocationListRead,
    RetailerItemAllocationRead,
    RetailerItemAllocationUpdate,
    RetailerItemPriceInput,
    RetailerItemPriceRead,
    RetailerOpenSaleSummary,
    RetailerPage,
    RetailerRead,
    RetailerUpdate,
    RetailerWalletRead,
)


def _retailer_to_read(
    retailer: Retailer,
    *,
    allocated_shop_count: int | None = None,
    outstanding_balance: Decimal | None = None,
    branch_names: list[str] | None = None,
) -> RetailerRead:
    data = RetailerRead.model_validate(retailer)
    updates: dict = {}
    if allocated_shop_count is not None:
        updates["allocated_shop_count"] = allocated_shop_count
    if outstanding_balance is not None:
        updates["outstanding_balance"] = outstanding_balance
    if branch_names is not None:
        updates["branch_names"] = branch_names
    return data.model_copy(update=updates) if updates else data


async def list_retailers(
    db: AsyncSession,
    *,
    q: str | None = None,
    active: bool | None = None,
    shop_id: UUID | None = None,
    page: int = 1,
    page_size: int = 20,
) -> RetailerPage:
    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)
    filters = []
    if active is not None:
        filters.append(Retailer.is_active.is_(active))
    if q:
        pattern = f"%{q.strip().lower()}%"
        filters.append(
            or_(
                func.lower(Retailer.name).like(pattern),
                func.lower(func.coalesce(Retailer.phone, "")).like(pattern),
            )
        )

    count_query = select(func.count()).select_from(Retailer)
    if shop_id is not None:
        count_query = count_query.join(
            ShopRetailerAllocation,
            ShopRetailerAllocation.retailer_id == Retailer.id,
        ).where(
            ShopRetailerAllocation.shop_id == shop_id,
            ShopRetailerAllocation.is_active.is_(True),
        )
    if filters:
        count_query = count_query.where(*filters)
    total = int(await db.scalar(count_query) or 0)

    allocation_count = (
        select(
            ShopRetailerAllocation.retailer_id.label("retailer_id"),
            func.count(ShopRetailerAllocation.id).label("allocated_shop_count"),
        )
        .where(ShopRetailerAllocation.is_active.is_(True))
        .group_by(ShopRetailerAllocation.retailer_id)
        .subquery()
    )

    # Aggregate outstanding balance from open/partial sales
    balance_sub = (
        select(
            RetailerSale.retailer_id.label("retailer_id"),
            func.coalesce(func.sum(RetailerSale.balance_due), Decimal("0.00")).label(
                "outstanding_balance"
            ),
        )
        .where(RetailerSale.status.in_([RetailerSaleStatus.OPEN, RetailerSaleStatus.PARTIAL]))
        .group_by(RetailerSale.retailer_id)
        .subquery()
    )

    # Aggregate branch names for allocated shops
    branch_names_sub = (
        select(
            ShopRetailerAllocation.retailer_id.label("retailer_id"),
            func.string_agg(Shop.name, ", ").label("branch_names"),
        )
        .join(Shop, Shop.id == ShopRetailerAllocation.shop_id)
        .where(ShopRetailerAllocation.is_active.is_(True))
        .group_by(ShopRetailerAllocation.retailer_id)
        .subquery()
    )

    query = (
        select(
            Retailer,
            allocation_count.c.allocated_shop_count,
            balance_sub.c.outstanding_balance,
            branch_names_sub.c.branch_names,
        )
        .outerjoin(allocation_count, allocation_count.c.retailer_id == Retailer.id)
        .outerjoin(balance_sub, balance_sub.c.retailer_id == Retailer.id)
        .outerjoin(branch_names_sub, branch_names_sub.c.retailer_id == Retailer.id)
        .order_by(Retailer.name.asc(), Retailer.id.asc())
    )
    if shop_id is not None:
        query = query.join(
            ShopRetailerAllocation,
            ShopRetailerAllocation.retailer_id == Retailer.id,
        ).where(
            ShopRetailerAllocation.shop_id == shop_id,
            ShopRetailerAllocation.is_active.is_(True),
        )
    if filters:
        query = query.where(*filters)
    query = query.offset((page - 1) * page_size).limit(page_size)
    rows = (await db.execute(query)).all()
    return RetailerPage(
        items=[
            _retailer_to_read(
                retailer,
                allocated_shop_count=int(alloc_count or 0),
                outstanding_balance=Decimal(str(balance or "0.00")),
                branch_names=(
                    [n.strip() for n in str(bnames).split(",") if n.strip()] if bnames else []
                ),
            )
            for retailer, alloc_count, balance, bnames in rows
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


async def create_retailer(db: AsyncSession, payload: RetailerCreate) -> RetailerRead:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Retailer name is required")
    retailer = Retailer(
        name=name,
        phone=payload.phone.strip() if payload.phone else None,
        notes=payload.notes.strip() if payload.notes else None,
        is_active=payload.is_active,
    )
    db.add(retailer)
    try:
        await db.commit()
        await db.refresh(retailer)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Retailer already exists")
    return _retailer_to_read(retailer)


async def get_retailer_or_404(db: AsyncSession, retailer_id: UUID) -> Retailer:
    retailer = await db.get(Retailer, retailer_id)
    if retailer is None:
        raise HTTPException(status_code=404, detail="Retailer not found")
    return retailer


async def update_retailer(
    db: AsyncSession, retailer_id: UUID, payload: RetailerUpdate
) -> RetailerRead:
    retailer = await get_retailer_or_404(db, retailer_id)
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="Retailer name is required")
        retailer.name = name
    if payload.phone is not None:
        retailer.phone = payload.phone.strip() or None
    if payload.notes is not None:
        retailer.notes = payload.notes.strip() or None
    if payload.is_active is not None:
        retailer.is_active = payload.is_active
    retailer.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(retailer)
    return _retailer_to_read(retailer)


async def get_shop_or_404(db: AsyncSession, shop_id: UUID) -> Shop:
    shop = await db.get(Shop, shop_id)
    if shop is None:
        raise HTTPException(status_code=404, detail="Shop not found")
    return shop


async def ensure_retailer_at_shop(
    db: AsyncSession,
    *,
    retailer_id: UUID,
    shop_id: UUID,
) -> None:
    await get_retailer_or_404(db, retailer_id)
    await get_shop_or_404(db, shop_id)
    if not await is_retailer_allocated_to_shop(
        db,
        shop_id=shop_id,
        retailer_id=retailer_id,
    ):
        raise HTTPException(
            status_code=422,
            detail="Retailer is not assigned to this branch",
        )


def _shop_billing_catalogue_filter(shop_id: UUID):
    return or_(
        Item.shop_id == shop_id,
        and_(
            Item.shop_id.is_(None),
            ShopItemAllocation.shop_id == shop_id,
            ShopItemAllocation.is_active.is_(True),
        ),
    )


def _shop_latest_billing_prices_subquery(shop_id: UUID):
    return (
        select(
            DailyPrice.item_id.label("item_id"),
            DailyPrice.price_per_unit.label("price_per_unit"),
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
        .where(DailyPrice.shop_id == shop_id)
        .subquery()
    )


async def _valid_branch_catalogue_item_ids(
    db: AsyncSession,
    shop_id: UUID,
    item_ids: list[UUID],
) -> set[UUID]:
    if not item_ids:
        return set()
    rows = (
        await db.scalars(
            select(Item.id)
            .outerjoin(
                ShopItemAllocation,
                and_(
                    ShopItemAllocation.item_id == Item.id,
                    ShopItemAllocation.shop_id == shop_id,
                ),
            )
            .where(
                Item.id.in_(item_ids),
                Item.is_active.is_(True),
                or_(Item.shop_id == shop_id, Item.shop_id.is_(None)),
            )
        )
    ).all()
    return set(rows)


async def _valid_shop_retailer_catalog_item_ids(
    db: AsyncSession,
    shop_id: UUID,
    item_ids: list[UUID],
) -> set[UUID]:
    if not item_ids:
        return set()
    rows = (
        await db.scalars(
            select(ShopRetailerItemAllocation.item_id)
            .join(Item, Item.id == ShopRetailerItemAllocation.item_id)
            .where(
                ShopRetailerItemAllocation.shop_id == shop_id,
                ShopRetailerItemAllocation.is_active.is_(True),
                ShopRetailerItemAllocation.item_id.in_(item_ids),
                Item.is_active.is_(True),
            )
        )
    ).all()
    return set(rows)


def _allocation_read_from_row(
    item: Item,
    billing_allocation: ShopItemAllocation | None,
    *,
    billing_price,
    is_allocated: bool,
    retailer_item_price_id: UUID | None = None,
    price_per_unit=None,
    allocation_is_active: bool | None = None,
    price_history: list[PriceHistoryEntry] | None = None,
) -> RetailerItemAllocationRead:
    return RetailerItemAllocationRead(
        item_id=item.id,
        item_name=(
            billing_allocation.display_name
            if billing_allocation and billing_allocation.display_name
            else item.name
        ),
        item_tamil_name=(
            billing_allocation.tamil_name
            if billing_allocation and billing_allocation.tamil_name
            else item.tamil_name
        ),
        unit_type=item.unit_type,
        base_unit=item.base_unit,
        image_path=build_item_image_path(item.id, item.image_object_key, item.image_content_type),
        image_thumb_path=build_item_image_thumb_path(
            item.id,
            item.image_thumbnail_object_key,
            item.image_thumbnail_content_type,
            original_object_key=item.image_object_key,
        ),
        billing_price=billing_price,
        is_allocated=is_allocated,
        retailer_item_price_id=retailer_item_price_id,
        price_per_unit=price_per_unit,
        allocation_is_active=allocation_is_active,
        price_history=price_history or [],
    )


async def list_shop_retailer_item_catalog(
    db: AsyncSession,
    shop_id: UUID,
    *,
    q: str | None = None,
    allocated: Literal["allocated", "available"] | None = None,
    limit: int = 200,
) -> RetailerItemAllocationListRead:
    await get_shop_or_404(db, shop_id)
    limit = min(max(limit, 1), 500)
    latest_prices = _shop_latest_billing_prices_subquery(shop_id)
    is_allocated_expr = ShopRetailerItemAllocation.id.is_not(None)

    query = (
        select(
            Item,
            ShopItemAllocation,
            ShopRetailerItemAllocation,
            latest_prices.c.price_per_unit.label("billing_price"),
        )
        .outerjoin(
            ShopItemAllocation,
            and_(
                ShopItemAllocation.item_id == Item.id,
                ShopItemAllocation.shop_id == shop_id,
            ),
        )
        .outerjoin(
            ShopRetailerItemAllocation,
            and_(
                ShopRetailerItemAllocation.item_id == Item.id,
                ShopRetailerItemAllocation.shop_id == shop_id,
                ShopRetailerItemAllocation.is_active.is_(True),
            ),
        )
        .outerjoin(
            latest_prices,
            and_(latest_prices.c.item_id == Item.id, latest_prices.c.rn == 1),
        )
        .where(
            or_(Item.shop_id == shop_id, Item.shop_id.is_(None)),
            Item.is_active.is_(True),
        )
    )

    if q:
        pattern = f"%{q.strip().lower()}%"
        query = query.where(
            or_(
                func.lower(func.coalesce(ShopItemAllocation.display_name, Item.name)).like(pattern),
                func.lower(func.coalesce(ShopItemAllocation.tamil_name, Item.tamil_name)).like(
                    pattern
                ),
            )
        )

    if allocated == "allocated":
        query = query.where(is_allocated_expr)
    elif allocated == "available":
        query = query.where(~is_allocated_expr)

    query = query.order_by(Item.sort_order.asc(), Item.name.asc()).limit(limit)
    rows = (await db.execute(query)).all()

    items = [
        _allocation_read_from_row(
            item,
            billing_allocation,
            billing_price=billing_price,
            is_allocated=catalog_row is not None,
            retailer_item_price_id=catalog_row.id if catalog_row else None,
        )
        for item, billing_allocation, catalog_row, billing_price in rows
    ]
    allocated_count = sum(1 for row in items if row.is_allocated)
    return RetailerItemAllocationListRead(
        items=items,
        total=len(items),
        allocated_count=allocated_count,
    )


async def sync_shop_retailer_item_catalog(
    db: AsyncSession,
    shop_id: UUID,
    item_ids: list[UUID],
) -> RetailerItemAllocationListRead:
    await get_shop_or_404(db, shop_id)
    requested = list(dict.fromkeys(item_ids))
    if requested:
        valid_set = await _valid_branch_catalogue_item_ids(db, shop_id, requested)
        missing = [str(item_id) for item_id in requested if item_id not in valid_set]
        if missing:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid or inactive branch billing items: {missing}",
            )

    existing_rows = (
        await db.scalars(
            select(ShopRetailerItemAllocation).where(ShopRetailerItemAllocation.shop_id == shop_id)
        )
    ).all()
    by_item_id = {row.item_id: row for row in existing_rows}
    requested_set = set(requested)

    for item_id in requested:
        row = by_item_id.get(item_id)
        if row is None:
            db.add(
                ShopRetailerItemAllocation(
                    shop_id=shop_id,
                    item_id=item_id,
                    is_active=True,
                )
            )
        else:
            row.is_active = True
            row.updated_at = datetime.now(UTC)

    for item_id, row in by_item_id.items():
        if item_id not in requested_set:
            await db.delete(row)
            price_rows = (
                await db.scalars(
                    select(RetailerItemPrice).where(
                        RetailerItemPrice.shop_id == shop_id,
                        RetailerItemPrice.item_id == item_id,
                    )
                )
            ).all()
            for price_row in price_rows:
                await db.delete(price_row)

    await db.commit()
    return await list_shop_retailer_item_catalog(db, shop_id, allocated="allocated")


async def list_retailer_item_prices(
    db: AsyncSession,
    retailer_id: UUID,
    *,
    shop_id: UUID,
) -> list[RetailerItemPriceRead]:
    await ensure_retailer_at_shop(db, retailer_id=retailer_id, shop_id=shop_id)
    rows = (
        await db.execute(
            select(RetailerItemPrice, Item.name, Item.tamil_name)
            .join(Item, Item.id == RetailerItemPrice.item_id)
            .where(
                RetailerItemPrice.retailer_id == retailer_id,
                RetailerItemPrice.shop_id == shop_id,
                RetailerItemPrice.effective_date == func.current_date(),
            )
            .order_by(Item.sort_order.asc(), Item.name.asc())
        )
    ).all()
    return [
        RetailerItemPriceRead(
            id=price.id,
            item_id=price.item_id,
            item_name=item_name,
            item_tamil_name=item_tamil_name,
            price_per_unit=price.price_per_unit,
            effective_date=price.effective_date,
            is_active=price.is_active,
        )
        for price, item_name, item_tamil_name in rows
    ]


async def sync_retailer_item_prices(
    db: AsyncSession,
    retailer_id: UUID,
    shop_id: UUID,
    items: list[RetailerItemPriceInput],
) -> list[RetailerItemPriceRead]:
    await ensure_retailer_at_shop(db, retailer_id=retailer_id, shop_id=shop_id)
    if not items:
        existing = await db.scalars(
            select(RetailerItemPrice).where(
                RetailerItemPrice.retailer_id == retailer_id,
                RetailerItemPrice.shop_id == shop_id,
            )
        )
        for row in existing:
            await db.delete(row)
        await db.commit()
        return []

    item_ids = [line.item_id for line in items]
    valid_set = await _valid_shop_retailer_catalog_item_ids(db, shop_id, item_ids)
    missing = [str(i) for i in item_ids if i not in valid_set]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Items not allocated to branch retailer catalog: {missing}",
        )

    existing_rows = (
        await db.scalars(
            select(RetailerItemPrice).where(
                RetailerItemPrice.retailer_id == retailer_id,
                RetailerItemPrice.shop_id == shop_id,
            )
        )
    ).all()
    by_item_id = {row.item_id: row for row in existing_rows}
    seen: set[UUID] = set()
    for line in items:
        if line.item_id in seen:
            raise HTTPException(status_code=422, detail="Duplicate item in mapping")
        seen.add(line.item_id)
        row = by_item_id.get(line.item_id)
        if row is None:
            row = RetailerItemPrice(
                retailer_id=retailer_id,
                shop_id=shop_id,
                item_id=line.item_id,
                price_per_unit=line.price_per_unit.quantize(Decimal("0.01")),
                is_active=line.is_active,
            )
            db.add(row)
        else:
            row.price_per_unit = line.price_per_unit.quantize(Decimal("0.01"))
            row.is_active = line.is_active

    for item_id, row in by_item_id.items():
        if item_id not in seen:
            await db.delete(row)

    await db.commit()
    return await list_retailer_item_prices(db, retailer_id, shop_id=shop_id)


async def list_retailer_item_allocations(
    db: AsyncSession,
    retailer_id: UUID,
    *,
    shop_id: UUID,
    q: str | None = None,
    allocated: Literal["allocated", "available"] | None = None,
    limit: int = 200,
    effective_date: date | None = None,
) -> RetailerItemAllocationListRead:
    await ensure_retailer_at_shop(db, retailer_id=retailer_id, shop_id=shop_id)
    limit = min(max(limit, 1), 500)
    latest_prices = _shop_latest_billing_prices_subquery(shop_id)
    is_allocated_expr = RetailerItemPrice.id.is_not(None)

    target_date = effective_date if effective_date is not None else func.current_date()

    query = (
        select(
            Item,
            ShopItemAllocation,
            RetailerItemPrice,
            latest_prices.c.price_per_unit.label("billing_price"),
        )
        .join(
            ShopRetailerItemAllocation,
            and_(
                ShopRetailerItemAllocation.item_id == Item.id,
                ShopRetailerItemAllocation.shop_id == shop_id,
                ShopRetailerItemAllocation.is_active.is_(True),
            ),
        )
        .outerjoin(
            ShopItemAllocation,
            and_(
                ShopItemAllocation.item_id == Item.id,
                ShopItemAllocation.shop_id == shop_id,
            ),
        )
        .outerjoin(
            RetailerItemPrice,
            and_(
                RetailerItemPrice.item_id == Item.id,
                RetailerItemPrice.retailer_id == retailer_id,
                RetailerItemPrice.shop_id == shop_id,
                RetailerItemPrice.effective_date == target_date,
            ),
        )
        .outerjoin(
            latest_prices,
            and_(latest_prices.c.item_id == Item.id, latest_prices.c.rn == 1),
        )
        .where(Item.is_active.is_(True))
    )

    if q:
        pattern = f"%{q.strip().lower()}%"
        query = query.where(
            or_(
                func.lower(func.coalesce(ShopItemAllocation.display_name, Item.name)).like(pattern),
                func.lower(func.coalesce(ShopItemAllocation.tamil_name, Item.tamil_name)).like(
                    pattern
                ),
            )
        )

    if allocated == "allocated":
        query = query.where(is_allocated_expr)
    elif allocated == "available":
        query = query.where(~is_allocated_expr)

    query = query.order_by(Item.sort_order.asc(), Item.name.asc()).limit(limit)
    rows = (await db.execute(query)).all()

    # Fetch price history for the items in the current page
    item_ids = [row[0].id for row in rows]
    price_history_map: dict[UUID, list[PriceHistoryEntry]] = {item_id: [] for item_id in item_ids}
    if item_ids:
        history_query = (
            select(RetailerItemPrice)
            .where(
                RetailerItemPrice.retailer_id == retailer_id,
                RetailerItemPrice.shop_id == shop_id,
                RetailerItemPrice.item_id.in_(item_ids),
            )
            .order_by(RetailerItemPrice.item_id, RetailerItemPrice.effective_date.desc())
        )
        history_rows = (await db.execute(history_query)).scalars().all()
        for h in history_rows:
            if len(price_history_map[h.item_id]) < 5:
                price_history_map[h.item_id].append(
                    PriceHistoryEntry(
                        effective_date=h.effective_date,
                        price_per_unit=h.price_per_unit,
                    )
                )

    items = [
        _allocation_read_from_row(
            item,
            billing_allocation,
            billing_price=billing_price,
            is_allocated=price_row is not None,
            retailer_item_price_id=price_row.id if price_row else None,
            price_per_unit=price_row.price_per_unit if price_row else None,
            allocation_is_active=price_row.is_active if price_row else None,
            price_history=price_history_map.get(item.id, []),
        )
        for item, billing_allocation, price_row, billing_price in rows
    ]
    allocated_count = sum(1 for row in items if row.is_allocated)
    return RetailerItemAllocationListRead(
        items=items,
        total=len(items),
        allocated_count=allocated_count,
    )


async def bulk_allocate_retailer_items(
    db: AsyncSession,
    retailer_id: UUID,
    shop_id: UUID,
    items: list[RetailerItemPriceInput],
) -> RetailerItemAllocationBulkRead:
    await ensure_retailer_at_shop(db, retailer_id=retailer_id, shop_id=shop_id)
    if not items:
        return RetailerItemAllocationBulkRead(
            items=[],
            allocated_count=0,
            already_allocated_count=0,
        )

    item_ids = [line.item_id for line in items]
    valid_set = await _valid_shop_retailer_catalog_item_ids(db, shop_id, item_ids)
    missing = [str(item_id) for item_id in item_ids if item_id not in valid_set]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Items not allocated to branch retailer catalog: {missing}",
        )

    existing_rows = (
        await db.scalars(
            select(RetailerItemPrice).where(
                RetailerItemPrice.retailer_id == retailer_id,
                RetailerItemPrice.shop_id == shop_id,
                RetailerItemPrice.item_id.in_(item_ids),
            )
        )
    ).all()
    existing_ids = {row.item_id for row in existing_rows}

    allocated_count = 0
    already_allocated_count = 0
    seen: set[UUID] = set()
    new_ids: list[UUID] = []
    for line in items:
        if line.item_id in seen:
            raise HTTPException(status_code=422, detail="Duplicate item in allocation request")
        seen.add(line.item_id)
        if line.item_id in existing_ids:
            already_allocated_count += 1
            continue
        db.add(
            RetailerItemPrice(
                retailer_id=retailer_id,
                shop_id=shop_id,
                item_id=line.item_id,
                price_per_unit=line.price_per_unit.quantize(Decimal("0.01")),
                is_active=line.is_active,
            )
        )
        new_ids.append(line.item_id)
        allocated_count += 1

    if allocated_count:
        await db.commit()

    created: list[RetailerItemPriceRead] = []
    if new_ids:
        all_prices = await list_retailer_item_prices(db, retailer_id, shop_id=shop_id)
        new_id_set = set(new_ids)
        created = [row for row in all_prices if row.item_id in new_id_set]

    return RetailerItemAllocationBulkRead(
        items=created,
        allocated_count=allocated_count,
        already_allocated_count=already_allocated_count,
    )


async def update_retailer_item_allocation(
    db: AsyncSession,
    retailer_id: UUID,
    shop_id: UUID,
    item_id: UUID,
    payload: RetailerItemAllocationUpdate,
) -> RetailerItemPriceRead:
    await ensure_retailer_at_shop(db, retailer_id=retailer_id, shop_id=shop_id)
    row = await db.scalar(
        select(RetailerItemPrice).where(
            RetailerItemPrice.retailer_id == retailer_id,
            RetailerItemPrice.shop_id == shop_id,
            RetailerItemPrice.item_id == item_id,
            RetailerItemPrice.effective_date == func.current_date(),
        )
    )
    if row is None:
        if payload.price_per_unit is None:
            raise HTTPException(status_code=404, detail="Item allocation not found")
        valid = await _valid_shop_retailer_catalog_item_ids(db, shop_id, [item_id])
        if item_id not in valid:
            raise HTTPException(
                status_code=422,
                detail="Item not allocated to branch retailer catalog",
            )
        row = RetailerItemPrice(
            retailer_id=retailer_id,
            shop_id=shop_id,
            item_id=item_id,
            price_per_unit=payload.price_per_unit.quantize(Decimal("0.01")),
            is_active=payload.is_active if payload.is_active is not None else True,
        )
        db.add(row)
    else:
        if payload.price_per_unit is not None:
            row.price_per_unit = payload.price_per_unit.quantize(Decimal("0.01"))
        if payload.is_active is not None:
            row.is_active = payload.is_active
    await db.commit()
    prices = await list_retailer_item_prices(db, retailer_id, shop_id=shop_id)
    match = next((price for price in prices if price.item_id == item_id), None)
    if match is None:
        raise HTTPException(status_code=404, detail="Item allocation not found")
    return match


async def delete_retailer_item_allocation(
    db: AsyncSession,
    retailer_id: UUID,
    shop_id: UUID,
    item_id: UUID,
) -> None:
    await ensure_retailer_at_shop(db, retailer_id=retailer_id, shop_id=shop_id)
    row = await db.scalar(
        select(RetailerItemPrice).where(
            RetailerItemPrice.retailer_id == retailer_id,
            RetailerItemPrice.shop_id == shop_id,
            RetailerItemPrice.item_id == item_id,
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Item allocation not found")
    await db.delete(row)
    await db.commit()


async def get_retailer_balance(db: AsyncSession, retailer_id: UUID) -> RetailerBalanceRead:
    retailer = await get_retailer_or_404(db, retailer_id)
    sales = (
        await db.execute(
            select(RetailerSale, Shop.name)
            .join(Shop, Shop.id == RetailerSale.shop_id)
            .where(
                RetailerSale.retailer_id == retailer_id,
                RetailerSale.status.in_([RetailerSaleStatus.OPEN, RetailerSaleStatus.PARTIAL]),
            )
            .order_by(RetailerSale.created_at.desc())
        )
    ).all()
    outstanding = sum((sale.balance_due for sale, _ in sales), Decimal("0.00"))
    return RetailerBalanceRead(
        retailer_id=retailer.id,
        retailer_name=retailer.name,
        outstanding_balance=outstanding,
        credit_balance=retailer.credit_balance,
        open_sales=[
            RetailerOpenSaleSummary(
                id=sale.id,
                sale_no=sale.sale_no,
                shop_id=sale.shop_id,
                shop_name=shop_name,
                total_amount=sale.total_amount,
                amount_paid_total=sale.amount_paid_total,
                balance_due=sale.balance_due,
                status=sale.status,
                created_at=sale.created_at,
            )
            for sale, shop_name in sales
        ],
    )


async def get_shop_retailer_wallet(
    db: AsyncSession,
    shop: Shop,
    retailer_id: UUID,
) -> RetailerWalletRead:
    await ensure_retailer_at_shop(db, retailer_id=retailer_id, shop_id=shop.id)
    retailer = await get_retailer_or_404(db, retailer_id)
    return RetailerWalletRead(
        retailer_id=retailer.id,
        retailer_name=retailer.name,
        credit_balance=retailer.credit_balance,
    )


async def list_active_retailers_for_shop(
    db: AsyncSession,
    shop: Shop,
    *,
    q: str | None = None,
) -> list[RetailerRead]:
    filters = [
        Retailer.is_active.is_(True),
        ShopRetailerAllocation.shop_id == shop.id,
        ShopRetailerAllocation.is_active.is_(True),
    ]
    if q:
        pattern = f"%{q.strip().lower()}%"
        filters.append(func.lower(Retailer.name).like(pattern))
    rows = (
        (
            await db.execute(
                select(Retailer)
                .join(ShopRetailerAllocation, ShopRetailerAllocation.retailer_id == Retailer.id)
                .where(*filters)
                .order_by(Retailer.name.asc())
            )
        )
        .scalars()
        .all()
    )
    return [_retailer_to_read(retailer, allocated_shop_count=1) for retailer in rows]


async def is_retailer_allocated_to_shop(
    db: AsyncSession,
    *,
    shop_id: UUID,
    retailer_id: UUID,
) -> bool:
    allocated = await db.scalar(
        select(ShopRetailerAllocation.id).where(
            ShopRetailerAllocation.shop_id == shop_id,
            ShopRetailerAllocation.retailer_id == retailer_id,
            ShopRetailerAllocation.is_active.is_(True),
        )
    )
    return allocated is not None


async def list_retailer_branch_allocations(
    db: AsyncSession,
    retailer_id: UUID,
) -> list[RetailerBranchAllocationRead]:
    await get_retailer_or_404(db, retailer_id)
    rows = (
        await db.execute(
            select(Shop, ShopRetailerAllocation)
            .outerjoin(
                ShopRetailerAllocation,
                (ShopRetailerAllocation.shop_id == Shop.id)
                & (ShopRetailerAllocation.retailer_id == retailer_id),
            )
            .order_by(Shop.name.asc(), Shop.id.asc())
        )
    ).all()
    return [
        RetailerBranchAllocationRead(
            shop_id=shop.id,
            shop_name=shop.name,
            shop_is_active=shop.is_active,
            is_allocated=allocation is not None,
            allocation_is_active=allocation.is_active if allocation is not None else None,
        )
        for shop, allocation in rows
    ]


async def sync_retailer_branch_allocations(
    db: AsyncSession,
    retailer_id: UUID,
    shop_ids: list[UUID],
) -> list[RetailerBranchAllocationRead]:
    await get_retailer_or_404(db, retailer_id)
    requested = list(dict.fromkeys(shop_ids))
    if requested:
        valid_shops = (await db.scalars(select(Shop.id).where(Shop.id.in_(requested)))).all()
        valid_set = set(valid_shops)
        missing = [str(shop_id) for shop_id in requested if shop_id not in valid_set]
        if missing:
            raise HTTPException(status_code=422, detail=f"Unknown shops: {missing}")

    existing_rows = (
        await db.scalars(
            select(ShopRetailerAllocation).where(ShopRetailerAllocation.retailer_id == retailer_id)
        )
    ).all()
    by_shop_id = {row.shop_id: row for row in existing_rows}
    requested_set = set(requested)

    for shop_id in requested:
        row = by_shop_id.get(shop_id)
        if row is None:
            db.add(
                ShopRetailerAllocation(
                    shop_id=shop_id,
                    retailer_id=retailer_id,
                    is_active=True,
                )
            )
        else:
            row.is_active = True
            row.updated_at = datetime.now(UTC)

    for shop_id, row in by_shop_id.items():
        if shop_id not in requested_set:
            await db.delete(row)

    await db.commit()
    return await list_retailer_branch_allocations(db, retailer_id)
