from datetime import date
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.storage import build_item_image_path, build_item_image_thumb_path
from app.models import DailyPrice, Item, Shop, ShopItemAllocation
from app.schemas.admin import PriceStatus
from app.schemas.pricing import (
    DailyPriceCreate,
    DailyPriceEntry,
    DailyPriceRead,
    DailyPriceUpdate,
    ItemPriceRead,
    ShopBootstrapResponse,
)


def _shop_visible_item_filter(shop_id: UUID):
    return or_(
        Item.shop_id == shop_id,
        and_(
            Item.shop_id.is_(None),
            select(ShopItemAllocation.id)
            .where(
                ShopItemAllocation.shop_id == shop_id,
                ShopItemAllocation.item_id == Item.id,
            )
            .exists(),
        ),
    )


def _shop_billing_item_filter(shop_id: UUID):
    return or_(
        Item.shop_id == shop_id,
        and_(
            Item.shop_id.is_(None),
            ShopItemAllocation.id.is_not(None),
            ShopItemAllocation.is_active.is_(True),
        ),
    )


def _price_status_for(price_date: date | None) -> PriceStatus:
    if price_date is None:
        return PriceStatus.MISSING
    return PriceStatus.CURRENT if price_date == date.today() else PriceStatus.STALE


def _shop_prices_published_today(shop: Shop, today: date | None = None) -> bool:
    target_day = today or date.today()
    return shop.daily_prices_published_on == target_day


async def _invalidate_daily_prices_publication(db: AsyncSession, shop: Shop) -> None:
    if shop.daily_prices_published_on == date.today():
        shop.daily_prices_published_on = None
        await db.commit()


async def _publish_daily_prices(db: AsyncSession, shop: Shop, target_date: date) -> None:
    shop.daily_prices_published_on = target_date
    await db.commit()


def _validate_daily_price_entries(
    entries: list[DailyPriceEntry], active_item_ids: set[UUID]
) -> None:
    submitted_item_ids = set(_validate_submitted_price_entries(entries))

    unknown_item_ids = submitted_item_ids - active_item_ids
    if unknown_item_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Prices can only be submitted for active items",
        )

    missing_item_ids = active_item_ids - submitted_item_ids
    if missing_item_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Prices must be provided for every active item",
        )


def _validate_submitted_price_entries(entries: list[DailyPriceEntry]) -> list[UUID]:
    submitted_item_ids: list[UUID] = []
    seen_item_ids: set[UUID] = set()
    for entry in entries:
        if entry.item_id in seen_item_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Duplicate price entry for item {entry.item_id}",
            )
        if entry.price_per_unit <= 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Prices must be greater than 0",
            )
        seen_item_ids.add(entry.item_id)
        submitted_item_ids.append(entry.item_id)
    return submitted_item_ids


async def _load_billable_item_units(
    db: AsyncSession,
    shop_id: UUID,
    item_ids: list[UUID] | None = None,
) -> dict[UUID, object]:
    if item_ids is not None and not item_ids:
        return {}

    query = (
        select(Item.id, Item.base_unit)
        .outerjoin(
            ShopItemAllocation,
            and_(
                ShopItemAllocation.item_id == Item.id,
                ShopItemAllocation.shop_id == shop_id,
            ),
        )
        .where(
            Item.is_active.is_(True),
            _shop_billing_item_filter(shop_id),
        )
    )
    if item_ids is not None:
        query = query.where(Item.id.in_(item_ids))

    rows = (await db.execute(query)).all()
    return {row.id: row.base_unit for row in rows}


async def _database_dialect_name(db: AsyncSession) -> str:
    return await db.run_sync(lambda session: session.get_bind().dialect.name)


async def _upsert_daily_price_entries_fallback(
    db: AsyncSession,
    shop_id: UUID,
    target_date: date,
    entries: list[DailyPriceEntry],
    items_by_id: dict[UUID, object],
) -> list[DailyPriceRead]:
    submitted_item_ids = [entry.item_id for entry in entries]
    existing_result = await db.scalars(
        select(DailyPrice).where(
            DailyPrice.shop_id == shop_id,
            DailyPrice.price_date == target_date,
            DailyPrice.item_id.in_(submitted_item_ids),
        )
    )
    existing_prices_by_item_id = {price.item_id: price for price in existing_result.all()}

    saved_prices: list[DailyPrice] = []
    for entry in entries:
        daily_price = existing_prices_by_item_id.get(entry.item_id)
        if daily_price is None:
            daily_price = DailyPrice(
                shop_id=shop_id,
                item_id=entry.item_id,
                price_per_unit=entry.price_per_unit,
                unit=items_by_id[entry.item_id],
                price_date=target_date,
            )
            db.add(daily_price)
        else:
            daily_price.price_per_unit = entry.price_per_unit
            daily_price.unit = items_by_id[entry.item_id]
        saved_prices.append(daily_price)

    await db.flush()
    await db.commit()
    return [DailyPriceRead.model_validate(price) for price in saved_prices]


async def _upsert_daily_price_entries(
    db: AsyncSession,
    shop_id: UUID,
    target_date: date,
    entries: list[DailyPriceEntry],
    items_by_id: dict[UUID, object],
) -> list[DailyPriceRead]:
    if not entries:
        return []

    dialect_name = await _database_dialect_name(db)
    insert_factory = {
        "postgresql": postgresql_insert,
        "sqlite": sqlite_insert,
    }.get(dialect_name)
    if insert_factory is None:
        return await _upsert_daily_price_entries_fallback(
            db, shop_id, target_date, entries, items_by_id
        )

    values = [
        {
            "shop_id": shop_id,
            "item_id": entry.item_id,
            "price_per_unit": entry.price_per_unit,
            "unit": items_by_id[entry.item_id],
            "price_date": target_date,
        }
        for entry in entries
    ]
    insert_stmt = insert_factory(DailyPrice).values(values)
    upsert_stmt = insert_stmt.on_conflict_do_update(
        index_elements=[
            DailyPrice.shop_id,
            DailyPrice.item_id,
            DailyPrice.price_date,
        ],
        set_={
            "price_per_unit": insert_stmt.excluded.price_per_unit,
            "unit": insert_stmt.excluded.unit,
        },
    ).returning(
        DailyPrice.id,
        DailyPrice.item_id,
        DailyPrice.price_per_unit,
        DailyPrice.unit,
        DailyPrice.price_date,
        DailyPrice.created_at,
    )
    rows = (await db.execute(upsert_stmt)).mappings().all()
    await db.commit()
    rows_by_item_id = {row["item_id"]: row for row in rows}
    return [
        DailyPriceRead(**rows_by_item_id[entry.item_id])
        for entry in entries
        if entry.item_id in rows_by_item_id
    ]


async def get_shop_bootstrap(db: AsyncSession, shop: Shop) -> ShopBootstrapResponse:
    """Return active allocated catalogue and shop items with current prices.

    Uses one latest-price subquery for the selected shop instead of two
    correlated latest-price lookups per item.
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
                Item.tamil_name,
                Item.unit_type,
                Item.base_unit,
                Item.sort_order,
                Item.category_id,
                Item.category,
                Item.image_object_key,
                Item.image_content_type,
                Item.image_thumbnail_object_key,
                Item.image_thumbnail_content_type,
                ShopItemAllocation.display_name,
                ShopItemAllocation.tamil_name.label("allocation_tamil_name"),
                ShopItemAllocation.sort_order.label("allocation_sort_order"),
                latest_prices.c.price_per_unit,
                latest_prices.c.price_date,
            )
            .outerjoin(
                ShopItemAllocation,
                and_(
                    ShopItemAllocation.item_id == Item.id,
                    ShopItemAllocation.shop_id == shop.id,
                ),
            )
            .outerjoin(
                latest_prices,
                and_(latest_prices.c.item_id == Item.id, latest_prices.c.rn == 1),
            )
            .where(Item.is_active.is_(True), _shop_billing_item_filter(shop.id))
            .order_by(
                func.coalesce(ShopItemAllocation.sort_order, Item.sort_order, 0),
                func.coalesce(ShopItemAllocation.display_name, Item.name),
            )
        )
    ).all()
    has_today_prices = bool(rows) and all(row.price_date == today for row in rows)
    prices_published = _shop_prices_published_today(shop, today)
    prices_set = has_today_prices and prices_published

    return ShopBootstrapResponse(
        shop_id=shop.id,
        shop_name=shop.name,
        price_date=today,
        prices_set=prices_set,
        next_screen="billing" if prices_set else "daily_price_setup",
        items=[
            ItemPriceRead(
                item_id=row.id,
                item_name=(row.display_name or row.name).strip(),
                item_tamil_name=(row.allocation_tamil_name or row.tamil_name),
                unit_type=row.unit_type,
                base_unit=row.base_unit,
                current_price=row.price_per_unit,
                latest_price_date=row.price_date,
                price_status=_price_status_for(row.price_date),
                sort_order=row.allocation_sort_order
                if row.allocation_sort_order is not None
                else row.sort_order,
                category_id=row.category_id,
                category=row.category,
                image_path=build_item_image_path(
                    row.id, row.image_object_key, row.image_content_type
                ),
                image_thumb_path=build_item_image_thumb_path(
                    row.id,
                    row.image_thumbnail_object_key,
                    row.image_thumbnail_content_type,
                    original_object_key=row.image_object_key,
                ),
            )
            for row in rows
        ],
    )


async def get_shop_price_history(
    db: AsyncSession, shop: Shop, target_date: date
) -> ShopBootstrapResponse:
    """Return active allocated shop items with prices saved on one exact date."""
    exact_prices = (
        select(
            DailyPrice.item_id.label("item_id"),
            DailyPrice.price_per_unit.label("price_per_unit"),
            DailyPrice.price_date.label("price_date"),
        )
        .where(DailyPrice.shop_id == shop.id, DailyPrice.price_date == target_date)
        .subquery()
    )
    rows = (
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
                Item.image_object_key,
                Item.image_content_type,
                Item.image_thumbnail_object_key,
                Item.image_thumbnail_content_type,
                ShopItemAllocation.display_name,
                ShopItemAllocation.tamil_name.label("allocation_tamil_name"),
                ShopItemAllocation.sort_order.label("allocation_sort_order"),
                exact_prices.c.price_per_unit,
                exact_prices.c.price_date,
            )
            .outerjoin(
                ShopItemAllocation,
                and_(
                    ShopItemAllocation.item_id == Item.id,
                    ShopItemAllocation.shop_id == shop.id,
                ),
            )
            .outerjoin(exact_prices, exact_prices.c.item_id == Item.id)
            .where(Item.is_active.is_(True), _shop_billing_item_filter(shop.id))
            .order_by(
                func.coalesce(ShopItemAllocation.sort_order, Item.sort_order, 0),
                func.coalesce(ShopItemAllocation.display_name, Item.name),
            )
        )
    ).all()
    has_prices = bool(rows) and all(row.price_date == target_date for row in rows)

    return ShopBootstrapResponse(
        shop_id=shop.id,
        shop_name=shop.name,
        price_date=target_date,
        prices_set=has_prices,
        next_screen="billing" if has_prices else "daily_price_setup",
        items=[
            ItemPriceRead(
                item_id=row.id,
                item_name=(row.display_name or row.name).strip(),
                item_tamil_name=(row.allocation_tamil_name or row.tamil_name),
                unit_type=row.unit_type,
                base_unit=row.base_unit,
                current_price=row.price_per_unit,
                latest_price_date=row.price_date,
                price_status=_price_status_for(row.price_date),
                sort_order=row.allocation_sort_order
                if row.allocation_sort_order is not None
                else row.sort_order,
                category_id=row.category_id,
                category=row.category,
                image_path=build_item_image_path(
                    row.id, row.image_object_key, row.image_content_type
                ),
                image_thumb_path=build_item_image_thumb_path(
                    row.id,
                    row.image_thumbnail_object_key,
                    row.image_thumbnail_content_type,
                    original_object_key=row.image_object_key,
                ),
            )
            for row in rows
        ],
    )


async def get_today_prices(db: AsyncSession, shop: Shop) -> list[DailyPriceRead]:
    """Return today's prices for active items currently allocated to the shop."""
    rows = await db.execute(
        select(
            DailyPrice.id,
            DailyPrice.item_id,
            DailyPrice.price_per_unit,
            DailyPrice.unit,
            DailyPrice.price_date,
            DailyPrice.created_at,
        )
        .join(Item, Item.id == DailyPrice.item_id)
        .outerjoin(
            ShopItemAllocation,
            and_(
                ShopItemAllocation.item_id == Item.id,
                ShopItemAllocation.shop_id == shop.id,
            ),
        )
        .where(
            DailyPrice.shop_id == shop.id,
            DailyPrice.price_date == date.today(),
            Item.is_active.is_(True),
            _shop_billing_item_filter(shop.id),
        )
        .order_by(DailyPrice.item_id.asc())
    )
    return [DailyPriceRead(**row) for row in rows.mappings()]


async def create_daily_prices(
    db: AsyncSession,
    shop: Shop,
    payload: DailyPriceCreate,
    *,
    publish: bool = False,
) -> list[DailyPriceRead]:
    """Create or update daily prices for every active item allocated to the shop.

    - Uses a narrow item projection instead of loading full ``Item`` ORM rows.
    - Avoids concurrent use of one ``AsyncSession``.
    - Rejects duplicate and unknown item IDs before mutating ORM state.
    - ``db.flush()`` assigns PKs without expiring the session, so a
      per-object ``db.refresh()`` loop (N extra SELECTs) is not needed.
    """
    target_date = date.today()
    entries = payload.entries

    items_by_id = await _load_billable_item_units(db, shop.id)
    active_item_ids = set(items_by_id)
    _validate_daily_price_entries(entries, active_item_ids)

    saved = await _upsert_daily_price_entries(db, shop.id, target_date, entries, items_by_id)
    if publish:
        await _publish_daily_prices(db, shop, target_date)
    return saved


def _validate_partial_daily_price_entries(
    submitted_item_ids: set[UUID], active_item_ids: set[UUID]
) -> None:
    unknown_item_ids = submitted_item_ids - active_item_ids
    if unknown_item_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Prices can only be submitted for active items",
        )


async def create_partial_daily_prices(
    db: AsyncSession,
    shop: Shop,
    payload: DailyPriceCreate,
) -> list[DailyPriceRead]:
    target_date = date.today()
    entries = payload.entries
    if not entries:
        return []

    submitted_item_ids = _validate_submitted_price_entries(entries)
    items_by_id = await _load_billable_item_units(db, shop.id, submitted_item_ids)
    _validate_partial_daily_price_entries(set(submitted_item_ids), set(items_by_id))

    saved = await _upsert_daily_price_entries(db, shop.id, target_date, entries, items_by_id)
    await _invalidate_daily_prices_publication(db, shop)
    return saved


async def upsert_shop_daily_price(
    db: AsyncSession,
    shop: Shop,
    item_id: UUID,
    payload: DailyPriceUpdate,
) -> DailyPriceRead:
    target_date = date.today()
    if payload.price_per_unit <= 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Prices must be greater than 0",
        )
    item_row = await db.execute(
        select(Item.id, Item.base_unit)
        .outerjoin(
            ShopItemAllocation,
            and_(
                ShopItemAllocation.item_id == Item.id,
                ShopItemAllocation.shop_id == shop.id,
            ),
        )
        .where(
            Item.id == item_id,
            Item.is_active.is_(True),
            _shop_billing_item_filter(shop.id),
        )
    )
    item = item_row.one_or_none()
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Price can only be saved for an active allocated item",
        )

    saved_prices = await _upsert_daily_price_entries(
        db,
        shop.id,
        target_date,
        [
            DailyPriceEntry(
                item_id=item_id,
                price_per_unit=payload.price_per_unit,
            )
        ],
        {item_id: item.base_unit},
    )
    await _invalidate_daily_prices_publication(db, shop)
    return saved_prices[0]


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
                Item.tamil_name,
                Item.unit_type,
                Item.base_unit,
                Item.sort_order,
                Item.category_id,
                Item.category,
                Item.image_object_key,
                Item.image_content_type,
                Item.image_thumbnail_object_key,
                Item.image_thumbnail_content_type,
                latest_prices.c.price_per_unit,
                latest_prices.c.price_date,
            )
            .outerjoin(
                latest_prices,
                and_(latest_prices.c.item_id == Item.id, latest_prices.c.rn == 1),
            )
            .where(Item.is_active.is_(True), Item.shop_id.is_(None))
            .order_by(Item.sort_order, Item.name)
        )
    ).all()
    has_today_prices = bool(rows) and all(row.price_date == today for row in rows)

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
                item_tamil_name=row.tamil_name,
                unit_type=row.unit_type,
                base_unit=row.base_unit,
                current_price=row.price_per_unit,
                latest_price_date=row.price_date,
                price_status=_price_status_for(row.price_date),
                sort_order=row.sort_order,
                category_id=row.category_id,
                category=row.category,
                image_path=build_item_image_path(
                    row.id, row.image_object_key, row.image_content_type
                ),
                image_thumb_path=build_item_image_thumb_path(
                    row.id,
                    row.image_thumbnail_object_key,
                    row.image_thumbnail_content_type,
                    original_object_key=row.image_object_key,
                ),
            )
            for row in rows
        ],
    )


async def create_global_daily_prices(
    db: AsyncSession,
    payload: DailyPriceCreate,
) -> list[DailyPriceRead]:
    """Create daily prices for all active shops at once (global pricing)."""
    target_date = date.today()

    shops_result = await db.scalars(select(Shop).where(Shop.is_active.is_(True)))
    shops = shops_result.all()

    if not shops:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="No active shops to apply global prices to",
        )

    item_rows = (
        await db.execute(
            select(Item.id, Item.base_unit).where(
                Item.is_active.is_(True),
                Item.shop_id.is_(None),
            )
        )
    ).all()
    items_by_id = {row.id: row.base_unit for row in item_rows}
    active_item_ids = set(items_by_id)
    _validate_daily_price_entries(payload.entries, active_item_ids)

    shop_ids = [shop.id for shop in shops]
    existing_prices_result = await db.scalars(
        select(DailyPrice).where(
            DailyPrice.shop_id.in_(shop_ids),
            DailyPrice.price_date == target_date,
        )
    )
    existing_prices_by_key = {
        (price.shop_id, price.item_id): price for price in existing_prices_result.all()
    }

    saved_prices: list[DailyPrice] = []

    for shop in shops:
        for entry in payload.entries:
            daily_price = existing_prices_by_key.get((shop.id, entry.item_id))
            if daily_price is None:
                daily_price = DailyPrice(
                    shop_id=shop.id,
                    item_id=entry.item_id,
                    price_per_unit=entry.price_per_unit,
                    unit=items_by_id[entry.item_id],
                    price_date=target_date,
                )
                db.add(daily_price)
            else:
                daily_price.price_per_unit = entry.price_per_unit
                daily_price.unit = items_by_id[entry.item_id]

            saved_prices.append(daily_price)

    await db.flush()
    await db.commit()
    return [DailyPriceRead.model_validate(price) for price in saved_prices]
