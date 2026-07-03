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
    Organization,
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
    OrganizationBranchQuota,
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

import asyncio

from app.services.admin.catalogue import _bill_to_read, _get_period_bounds
from app.services.admin.shops import list_shops
from app.services.tenant_query import get_shop_for_tenant_or_404


async def _branch_quota_for_organization(
    db: AsyncSession, organization_id: UUID, branch_count: int
) -> OrganizationBranchQuota:
    org = await db.get(Organization, organization_id)
    max_branches = org.max_branches if org is not None else 5
    remaining = max(0, max_branches - branch_count)
    return OrganizationBranchQuota(
        max_branches=max_branches,
        branch_count=branch_count,
        remaining_branches=remaining,
        can_create_branch=branch_count < max_branches,
    )


async def get_bill_by_id(
    db: AsyncSession, bill_id: UUID, organization_id: UUID
) -> BillRead:
    """Fetch a single bill with all related data in one SQL statement.

    Uses explicit JOINs with ``contains_eager`` for the to-one relationships
    (shop, payment, receipt) to avoid the 3 separate round-trips that
    ``joinedload`` would fire via the identity map.  Bill items are loaded
    with ``selectinload`` + nested ``joinedload`` for the item catalogue row.
    """
    result = await db.execute(
        select(Bill)
        .join(Bill.shop)
        .join(Shop.organization)
        .outerjoin(Bill.payment)
        .outerjoin(Bill.receipt)
        .options(
            contains_eager(Bill.shop).contains_eager(Shop.organization),
            contains_eager(Bill.payment),
            contains_eager(Bill.receipt),
            selectinload(Bill.items).joinedload(BillItem.item),
        )
        .where(Bill.id == bill_id, Shop.organization_id == organization_id)
    )
    bill = result.scalar_one_or_none()
    if bill is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bill not found")
    return _bill_to_read(bill)


async def get_bills_by_ids(
    db: AsyncSession, bill_ids: list[UUID], organization_id: UUID
) -> list[BillRead]:
    unique_bill_ids = list(dict.fromkeys(bill_ids))
    result = await db.execute(
        select(Bill)
        .join(Bill.shop)
        .join(Shop.organization)
        .outerjoin(Bill.payment)
        .outerjoin(Bill.receipt)
        .options(
            contains_eager(Bill.shop).contains_eager(Shop.organization),
            contains_eager(Bill.payment),
            contains_eager(Bill.receipt),
            selectinload(Bill.items).joinedload(BillItem.item),
        )
        .where(Bill.id.in_(unique_bill_ids), Shop.organization_id == organization_id)
    )
    bills = result.unique().scalars().all()
    bills_by_id = {bill.id: bill for bill in bills}
    missing_bill_ids = [bill_id for bill_id in unique_bill_ids if bill_id not in bills_by_id]
    if missing_bill_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bill not found")
    return [_bill_to_read(bills_by_id[bill_id]) for bill_id in bill_ids]


async def get_shop_sales_summary(
    db: AsyncSession,
    period: AnalyticsPeriod = "date",
    reference_date: date | None = None,
    shop_id: UUID | None = None,
    range_start_date: date | None = None,
    range_end_date: date | None = None,
    organization_id: UUID | None = None,
) -> list[ShopSalesSummary]:
    """Return total sales grouped by shop for the given time period.

    Uses a LEFT OUTER JOIN so shops with zero bills in the window still
    appear in the result (with ``total_sales = 0``).

    Args:
        db: Async database session.
        period: Granularity bucket — ``"date"``, ``"month"``, ``"week"``, ``"year"``, or ``"range"``.
        reference_date: Anchor date for the period window (defaults to today).
        shop_id: When provided, restricts results to a single shop.
        organization_id: Tenant organization; only branches from this org are included.
    """
    if organization_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organization context is required",
        )
    if shop_id is not None:
        await get_shop_for_tenant_or_404(db, shop_id, organization_id)

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
        .where(Shop.organization_id == organization_id)
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
    organization_id: UUID | None = None,
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
        organization_id: Tenant organization; only branches from this org are included.
    """
    if organization_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organization context is required",
        )
    if shop_id is not None:
        await get_shop_for_tenant_or_404(db, shop_id, organization_id)

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
        .where(Shop.organization_id == organization_id)
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
    organization_id: UUID | None = None,
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
        organization_id: Tenant organization; only branches from this org are included.
    """
    if organization_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organization context is required",
        )
    if shop_id is not None:
        await get_shop_for_tenant_or_404(db, shop_id, organization_id)

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
        .where(*page_filters, Shop.organization_id == organization_id)
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
            .join(Shop, Shop.id == Bill.shop_id)
            .where(*base_filters, Shop.organization_id == organization_id)
            .group_by(Bill.shop_id)
        )
        bills_result = await db.execute(bills_query)
        largest_result = await db.execute(
            select(Bill, Shop.name)
            .join(Shop, Shop.id == Bill.shop_id)
            .where(*base_filters, Shop.organization_id == organization_id)
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
    organization_id: UUID | None = None,
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
        organization_id: Tenant organization; only sales from this org's branches are included.
    """
    if organization_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organization context is required",
        )
    if shop_id is not None:
        await get_shop_for_tenant_or_404(db, shop_id, organization_id)

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
        .join(Shop, Shop.id == Bill.shop_id)
        .where(*filters, Shop.organization_id == organization_id)
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
    organization_id: UUID,
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
    shops = await list_shops(db, organization_id)
    branch_quota = await _branch_quota_for_organization(db, organization_id, len(shops))
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
        .where(Shop.organization_id == organization_id)
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
            branch_quota=branch_quota,
        )

    largest_result, item_sales = await asyncio.gather(
        db.execute(
            select(Bill, Shop.name)
            .join(Shop, Shop.id == Bill.shop_id)
            .where(*base_filters, Shop.organization_id == organization_id)
            .order_by(Bill.total_amount.desc())
            .limit(1)
        ),
        get_item_sales_summary(
            db,
            period,
            reference_date,
            shop_id,
            range_start_date=range_start_date,
            range_end_date=range_end_date,
            organization_id=organization_id,
        ),
    )
    largest_row = largest_result.first()
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

    bills_page = await get_daily_bills(
        db,
        period,
        reference_date,
        shop_id,
        bills_limit,
        range_start_date=range_start_date,
        range_end_date=range_end_date,
        organization_id=organization_id,
        precalculated_stats=shop_stats,
        precalculated_largest_bill=largest_bill,
    )

    return AdminDashboardBootstrap(
        shops=shops,
        sales_summary=sales_summary,
        payment_summary=payment_summary,
        bills=bills_page,
        item_sales=item_sales,
        branch_quota=branch_quota,
    )
