from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DailyPrice, Item, Shop, User
from app.schemas.pricing import (
    DailyPriceCreate,
    DailyPriceRead,
    ItemPriceRead,
    ShopBootstrapResponse,
)


async def get_shop_bootstrap(db: AsyncSession, shop: Shop) -> ShopBootstrapResponse:
    """Return active items with their current prices for the given shop.

    Uses one query with a window-function subquery to fetch active items plus
    the latest price row per item for this shop. This avoids the previous
    two-query bootstrap path and also avoids concurrent use of one
    ``AsyncSession``.
    """
    today = date.today()
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
    rows = (
        await db.execute(
            select(
                Item.id,
                Item.name,
                Item.unit_type,
                Item.base_unit,
                latest_prices.c.price_per_unit,
                latest_prices.c.price_date,
            )
            .outerjoin(
                latest_prices,
                and_(latest_prices.c.item_id == Item.id, latest_prices.c.rn == 1),
            )
            .where(Item.is_active.is_(True))
            .order_by(Item.name)
        )
    ).all()
    has_today_prices = any(row.price_date == today for row in rows)

    return ShopBootstrapResponse(
        shop_id=shop.id,
        shop_name=shop.name,
        price_date=today,
        prices_set=has_today_prices,
        next_screen="billing" if has_today_prices else "daily_price_setup",
        items=[
            ItemPriceRead(
                item_id=row.id,
                item_name=row.name,
                unit_type=row.unit_type,
                base_unit=row.base_unit,
                current_price=row.price_per_unit,
            )
            for row in rows
        ],
    )


async def get_today_prices(db: AsyncSession, shop: Shop) -> list[DailyPriceRead]:
    """Return today's prices for the shop using a flat projection query."""
    rows = await db.execute(
        select(
            DailyPrice.id,
            DailyPrice.item_id,
            DailyPrice.price_per_unit,
            DailyPrice.unit,
            DailyPrice.price_date,
            DailyPrice.created_at,
        )
        .where(
            DailyPrice.shop_id == shop.id,
            DailyPrice.price_date == date.today(),
        )
        .order_by(DailyPrice.item_id.asc())
    )
    return [DailyPriceRead(**row) for row in rows.mappings()]


async def create_daily_prices(
    db: AsyncSession,
    shop: Shop,
    payload: DailyPriceCreate,
) -> list[DailyPriceRead]:
    """Create or update daily prices for every active item for the given shop.

    - Uses a narrow item projection instead of loading full ``Item`` ORM rows.
    - Avoids concurrent use of one ``AsyncSession``.
    - Rejects duplicate and unknown item IDs before mutating ORM state.
    - ``db.flush()`` assigns PKs without expiring the session, so a
      per-object ``db.refresh()`` loop (N extra SELECTs) is not needed.
    """
    target_date = date.today()

    item_rows = (
        await db.execute(select(Item.id, Item.base_unit).where(Item.is_active.is_(True)))
    ).all()
    items_by_id = {row.id: row.base_unit for row in item_rows}
    active_item_ids = set(items_by_id)

    submitted_item_ids: set[int] = set()
    for entry in payload.entries:
        if entry.item_id in submitted_item_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Duplicate price entry for item {entry.item_id}",
            )
        submitted_item_ids.add(entry.item_id)

    unknown_item_ids = submitted_item_ids - active_item_ids
    if unknown_item_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Prices can only be submitted for active items",
        )

    missing_item_ids = active_item_ids - submitted_item_ids
    if missing_item_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Prices must be provided for every active item",
        )

    existing_result = await db.scalars(
        select(DailyPrice).where(
            DailyPrice.shop_id == shop.id,
            DailyPrice.price_date == target_date,
        )
    )
    existing_prices_by_item_id = {price.item_id: price for price in existing_result.all()}

    saved_prices: list[DailyPrice] = []
    for entry in payload.entries:
        item_id = entry.item_id
        daily_price = existing_prices_by_item_id.get(item_id)
        if daily_price is None:
            daily_price = DailyPrice(
                shop_id=shop.id,
                item_id=item_id,
                price_per_unit=entry.price_per_unit,
                unit=items_by_id[item_id],
                price_date=target_date,
            )
            db.add(daily_price)
        else:
            daily_price.price_per_unit = entry.price_per_unit
            daily_price.unit = items_by_id[item_id]
        saved_prices.append(daily_price)

    # flush assigns auto-generated PKs; commit persists without expiring objects.
    await db.flush()
    await db.commit()
    return [DailyPriceRead.model_validate(price) for price in saved_prices]
async def get_global_bootstrap(db: AsyncSession) -> ShopBootstrapResponse:
    """Return active items with the latest global price snapshot in one query.

    Instead of loading all today's prices and then scanning the full
    ``daily_prices`` history in Python, this uses a window-function subquery
    to pick the most recent price row per item across active shops.
    """
    today = date.today()
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
        .join(Shop, Shop.id == DailyPrice.shop_id)
        .where(Shop.is_active.is_(True))
        .subquery()
    )

    rows = (
        await db.execute(
            select(
                Item.id,
                Item.name,
                Item.unit_type,
                Item.base_unit,
                latest_prices.c.price_per_unit,
                latest_prices.c.price_date,
            )
            .outerjoin(
                latest_prices,
                and_(latest_prices.c.item_id == Item.id, latest_prices.c.rn == 1),
            )
            .where(Item.is_active.is_(True))
            .order_by(Item.name)
        )
    ).all()
    has_today_prices = any(row.price_date == today for row in rows)

    return ShopBootstrapResponse(
        shop_id=None,  # Global, not shop-specific
        shop_name="Global Prices",
        price_date=today,
        prices_set=has_today_prices,
        next_screen="billing" if has_today_prices else "daily_price_setup",
        items=[
            ItemPriceRead(
                item_id=row.id,
                item_name=row.name,
                unit_type=row.unit_type,
                base_unit=row.base_unit,
                current_price=row.price_per_unit,
            )
            for row in rows
        ],
    )


async def create_global_daily_prices(
    db: AsyncSession,
    payload: DailyPriceCreate,
    actor: User,
) -> list[DailyPriceRead]:
    """Create daily prices for all shops at once (global pricing)."""
    target_date = date.today()

    # Get all shops
    shops_result = await db.scalars(select(Shop).where(Shop.is_active.is_(True)))
    shops = shops_result.all()

    if not shops:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No active shops to apply global prices to",
        )

    items_result = await db.scalars(select(Item).where(Item.is_active.is_(True)))
    items = items_result.all()
    items_by_id = {item.id: item for item in items}
    submitted_item_ids = {entry.item_id for entry in payload.entries}
    missing_item_ids = {item.id for item in items} - submitted_item_ids

    if missing_item_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Prices must be provided for every active item",
        )

    saved_prices: list[DailyPrice] = []

    # For each shop, create or update daily prices
    for shop in shops:
        existing_prices_result = await db.scalars(
            select(DailyPrice).where(
                DailyPrice.shop_id == shop.id, DailyPrice.price_date == target_date
            )
        )
        existing_prices = existing_prices_result.all()
        existing_prices_by_item_id = {price.item_id: price for price in existing_prices}

        for entry in payload.entries:
            item = items_by_id.get(entry.item_id)
            if item is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Item {entry.item_id} not found",
                )

            daily_price = existing_prices_by_item_id.get(item.id)
            if daily_price is None:
                daily_price = DailyPrice(
                    shop_id=shop.id,
                    item_id=item.id,
                    price_per_unit=entry.price_per_unit,
                    unit=item.base_unit,
                    price_date=target_date,
                )
                db.add(daily_price)
            else:
                daily_price.price_per_unit = entry.price_per_unit
                daily_price.unit = item.base_unit

            saved_prices.append(daily_price)

    await db.commit()
    for price in saved_prices:
        await db.refresh(price)
    return [DailyPriceRead.model_validate(price) for price in saved_prices]
