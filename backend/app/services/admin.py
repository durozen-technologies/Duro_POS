from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import and_, distinct, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import contains_eager, selectinload

from app.core.security import get_password_hash
from app.db.storage import (
    build_item_image_path,
    delete_item_image_storage,
    save_item_image_upload,
)
from app.models import Bill, BillItem, DailyPrice, Item, Payment, Shop, User, UserRole
from app.schemas.admin import (
    AdminBillPage,
    AdminBillShopStat,
    AdminBillSummary,
    AdminDashboardBootstrap,
    AnalyticsPeriod,
    ItemCreate,
    ItemRead,
    ItemSalesSummary,
    ItemUpdate,
    PaymentSplitSummary,
    ShopCreate,
    ShopRead,
    ShopSalesSummary,
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
    return ItemRead(
        id=item.id,
        name=item.name,
        unit_type=item.unit_type,
        base_unit=item.base_unit,
        is_active=item.is_active,
        created_at=item.created_at,
        image_path=build_item_image_path(item.id, item.image_object_key, item.image_content_type),
        image_content_type=item.image_content_type,
    )


def _normalize_item_name(raw_name: str) -> str:
    item_name = raw_name.strip()
    if len(item_name) < 2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Item name is required",
        )
    return item_name


async def _ensure_unique_item_name(
    db: AsyncSession,
    item_name: str,
    *,
    exclude_item_id: UUID | None = None,
) -> None:
    filters = [func.lower(Item.name) == item_name.lower()]
    if exclude_item_id is not None:
        filters.append(Item.id != exclude_item_id)

    existing_item = await db.scalar(select(Item.id).where(*filters).limit(1))
    if existing_item is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Item name already exists")


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
                item_name=line.item.name if line.item is not None else "Unknown item",
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
    period: AnalyticsPeriod, reference_date: date | None = None
) -> tuple[datetime, datetime]:
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
    username = payload.username.strip()
    shop_name = payload.name.strip()

    if len(shop_name) < 2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Shop name is required"
        )
    if len(username) < 3:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Username is required"
        )

    existing_user = await db.scalar(select(User.id).where(User.username == username))
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

    username = payload.username.strip()
    shop_name = payload.name.strip()
    new_password = (
        payload.password.strip() if payload.password and payload.password.strip() else None
    )

    has_changes = False

    if shop.name != shop_name:
        shop.name = shop_name
        has_changes = True

    if shop.owner.username != username:
        # Uniqueness check is only needed when the username actually changes.
        existing = await db.scalar(
            select(User.id).where(User.username == username, User.id != shop.owner.id)
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
) -> ItemRead:
    item_name = _normalize_item_name(payload.name)
    await _ensure_unique_item_name(db, item_name)

    item = Item(
        name=item_name,
        unit_type=payload.unit_type,
        base_unit=payload.base_unit,
        is_active=payload.is_active,
    )
    uploaded_image_object_key: str | None = None

    try:
        db.add(item)
        await db.flush()
        if image is not None:
            await save_item_image_upload(db, item, image, commit=False)
            uploaded_image_object_key = item.image_object_key
        await db.commit()
        return _item_to_read(item)
    except Exception:
        await db.rollback()
        await delete_item_image_storage(uploaded_image_object_key)
        raise


async def update_item(
    db: AsyncSession,
    item_id: UUID,
    payload: ItemUpdate,
    image: UploadFile | None = None,
) -> ItemRead:
    item = await db.scalar(select(Item).where(Item.id == item_id).with_for_update())
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    item_name = _normalize_item_name(payload.name)
    name_changed = item.name != item_name
    configuration_changed = (
        name_changed
        or item.unit_type != payload.unit_type
        or item.base_unit != payload.base_unit
        or item.is_active != payload.is_active
    )

    if name_changed and item.name.lower() != item_name.lower():
        await _ensure_unique_item_name(db, item_name, exclude_item_id=item_id)

    if not configuration_changed and image is None:
        return _item_to_read(item)

    previous_image_object_key = item.image_object_key
    uploaded_image_object_key: str | None = None

    try:
        item.name = item_name
        item.unit_type = payload.unit_type
        item.base_unit = payload.base_unit
        item.is_active = payload.is_active
        await db.flush()
        if image is not None:
            await save_item_image_upload(db, item, image, commit=False)
            uploaded_image_object_key = item.image_object_key
        await db.commit()
        if (
            image is not None
            and previous_image_object_key
            and previous_image_object_key != item.image_object_key
        ):
            await delete_item_image_storage(previous_image_object_key)
        return _item_to_read(item)
    except Exception:
        await db.rollback()
        if uploaded_image_object_key and uploaded_image_object_key != previous_image_object_key:
            await delete_item_image_storage(uploaded_image_object_key)
        raise


async def delete_item(db: AsyncSession, item_id: UUID) -> None:
    item = await db.scalar(select(Item).where(Item.id == item_id).with_for_update())
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
            )
        )
    ).one()
    has_bill_items, has_prices = existence_row

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
    await db.delete(item)
    await db.commit()
    await delete_item_image_storage(image_object_key)


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
) -> list[ShopSalesSummary]:
    """Return total sales grouped by shop for the given time period.

    Uses a LEFT OUTER JOIN so shops with zero bills in the window still
    appear in the result (with ``total_sales = 0``).

    Args:
        db: Async database session.
        period: Granularity bucket — ``"date"``, ``"month"``, ``"week"``, or ``"year"``.
        reference_date: Anchor date for the period window (defaults to today).
        shop_id: When provided, restricts results to a single shop.
    """
    start, end = _get_period_bounds(period, reference_date)
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
) -> list[PaymentSplitSummary]:
    """Return cash/UPI payment totals grouped by shop for the given time period.

    Uses a double LEFT OUTER JOIN (shops → bills → payments) so:
    - Shops with no bills appear with zero totals.
    - Bills with no matching payment row are safely excluded via COALESCE.

    Args:
        db: Async database session.
        period: Granularity bucket — ``"date"``, ``"month"``, ``"week"``, or ``"year"``.
        reference_date: Anchor date for the period window (defaults to today).
        shop_id: When provided, restricts results to a single shop.
    """
    start, end = _get_period_bounds(period, reference_date)
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
        period: Granularity bucket — ``"date"``, ``"month"``, ``"week"``, or ``"year"``.
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

    start, end = _get_period_bounds(period, reference_date)
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
        period: Granularity bucket — ``"date"``, ``"month"``, ``"week"``, or ``"year"``.
        reference_date: Anchor date for the period window (defaults to today).
        shop_id: When provided, restricts results to bills from a single shop.
        limit: Maximum number of items to return (default 100, max 500).
    """
    start, end = _get_period_bounds(period, reference_date)

    # Build all filters upfront so the query is constructed in one pass.
    filters = [Bill.created_at >= start, Bill.created_at < end]
    if shop_id is not None:
        filters.append(Bill.shop_id == shop_id)

    total_amount_label = func.coalesce(func.sum(BillItem.line_total), 0).label("total_amount")

    result = await db.execute(
        select(
            Item.id,
            Item.name,
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
) -> AdminDashboardBootstrap:
    """Return the admin dashboard payload with minimal duplicate work.

    The aggregate shop metrics are computed once and then reused to build the
    sales summary, payment summary, and bill shop stats. When the selected
    period has no bills, the expensive largest-bill, bill-page, and item-sales
    queries are skipped entirely.
    """
    start, end = _get_period_bounds(period, reference_date)
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
        precalculated_stats=shop_stats,
        precalculated_largest_bill=largest_bill,
    )
    item_sales = await get_item_sales_summary(db, period, reference_date, shop_id)

    return AdminDashboardBootstrap(
        shops=shops,
        sales_summary=sales_summary,
        payment_summary=payment_summary,
        bills=bills_page,
        item_sales=item_sales,
    )
