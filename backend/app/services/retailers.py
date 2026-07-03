"""Admin retailer CRUD and item price mapping."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Item,
    Retailer,
    RetailerItemPrice,
    RetailerSale,
    RetailerSaleStatus,
    Shop,
    ShopRetailerAllocation,
)
from app.schemas.retailers import (
    RetailerBalanceRead,
    RetailerBranchAllocationRead,
    RetailerCreate,
    RetailerItemPriceInput,
    RetailerItemPriceRead,
    RetailerOpenSaleSummary,
    RetailerPage,
    RetailerRead,
    RetailerUpdate,
)


def _retailer_to_read(
    retailer: Retailer,
    *,
    allocated_shop_count: int | None = None,
) -> RetailerRead:
    data = RetailerRead.model_validate(retailer)
    if allocated_shop_count is not None:
        return data.model_copy(update={"allocated_shop_count": allocated_shop_count})
    return data


async def list_retailers(
    db: AsyncSession,
    *,
    q: str | None = None,
    active: bool | None = None,
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

    query = (
        select(Retailer, allocation_count.c.allocated_shop_count)
        .outerjoin(allocation_count, allocation_count.c.retailer_id == Retailer.id)
        .order_by(Retailer.name.asc(), Retailer.id.asc())
    )
    if filters:
        query = query.where(*filters)
    query = query.offset((page - 1) * page_size).limit(page_size)
    rows = (await db.execute(query)).all()
    return RetailerPage(
        items=[
            _retailer_to_read(
                retailer,
                allocated_shop_count=int(allocated_shop_count or 0),
            )
            for retailer, allocated_shop_count in rows
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


async def list_retailer_item_prices(
    db: AsyncSession, retailer_id: UUID
) -> list[RetailerItemPriceRead]:
    await get_retailer_or_404(db, retailer_id)
    rows = (
        await db.execute(
            select(RetailerItemPrice, Item.name, Item.tamil_name)
            .join(Item, Item.id == RetailerItemPrice.item_id)
            .where(RetailerItemPrice.retailer_id == retailer_id)
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
            is_active=price.is_active,
        )
        for price, item_name, item_tamil_name in rows
    ]


async def sync_retailer_item_prices(
    db: AsyncSession,
    retailer_id: UUID,
    items: list[RetailerItemPriceInput],
) -> list[RetailerItemPriceRead]:
    await get_retailer_or_404(db, retailer_id)
    if not items:
        existing = await db.scalars(
            select(RetailerItemPrice).where(RetailerItemPrice.retailer_id == retailer_id)
        )
        for row in existing:
            await db.delete(row)
        await db.commit()
        return []

    item_ids = [line.item_id for line in items]
    valid_items = (
        await db.scalars(select(Item.id).where(Item.id.in_(item_ids), Item.is_active.is_(True)))
    ).all()
    valid_set = set(valid_items)
    missing = [str(i) for i in item_ids if i not in valid_set]
    if missing:
        raise HTTPException(status_code=422, detail=f"Invalid or inactive items: {missing}")

    existing_rows = (
        await db.scalars(
            select(RetailerItemPrice).where(RetailerItemPrice.retailer_id == retailer_id)
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
    return await list_retailer_item_prices(db, retailer_id)


async def get_retailer_balance(db: AsyncSession, retailer_id: UUID) -> RetailerBalanceRead:
    retailer = await get_retailer_or_404(db, retailer_id)
    sales = (
        await db.execute(
            select(RetailerSale, Shop.name)
            .join(Shop, Shop.id == RetailerSale.shop_id)
            .where(
                RetailerSale.retailer_id == retailer_id,
                RetailerSale.status.in_(
                    [RetailerSaleStatus.OPEN, RetailerSaleStatus.PARTIAL]
                ),
            )
            .order_by(RetailerSale.created_at.desc())
        )
    ).all()
    outstanding = sum((sale.balance_due for sale, _ in sales), Decimal("0.00"))
    return RetailerBalanceRead(
        retailer_id=retailer.id,
        retailer_name=retailer.name,
        outstanding_balance=outstanding,
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
        await db.execute(
            select(Retailer)
            .join(ShopRetailerAllocation, ShopRetailerAllocation.retailer_id == Retailer.id)
            .where(*filters)
            .order_by(Retailer.name.asc())
        )
    ).scalars().all()
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
        valid_shops = (
            await db.scalars(select(Shop.id).where(Shop.id.in_(requested)))
        ).all()
        valid_set = set(valid_shops)
        missing = [str(shop_id) for shop_id in requested if shop_id not in valid_set]
        if missing:
            raise HTTPException(status_code=422, detail=f"Unknown shops: {missing}")

    existing_rows = (
        await db.scalars(
            select(ShopRetailerAllocation).where(
                ShopRetailerAllocation.retailer_id == retailer_id
            )
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
