from datetime import date, datetime, timedelta
from decimal import Decimal
from math import ceil
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import String, asc, cast, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.redis_cache import (
    cache_get_json,
    cache_set_json,
    hash_cache_parts,
    shop_bills_cache_key,
)
from app.core.timezone import ist_midnight, ist_range_bounds
from app.models import Bill, Payment, Receipt, Shop, User
from app.models.enums import ReceiptStatus
from app.schemas.billing import (
    ShopBillPage,
    ShopBillPaymentMethodFilter,
    ShopBillSortField,
    ShopBillSummaryRead,
)
from app.services.billing import _bill_read_for_shop

_ZERO = Decimal("0")


def _payment_method_code(cash_amount: Decimal, upi_amount: Decimal) -> ShopBillPaymentMethodFilter:
    """Stable machine-readable payment method for list filters + i18n clients."""
    if cash_amount > 0 and upi_amount > 0:
        return ShopBillPaymentMethodFilter.MIXED
    if upi_amount > 0:
        return ShopBillPaymentMethodFilter.UPI
    return ShopBillPaymentMethodFilter.CASH


def _day_bounds(start: date, end: date) -> tuple[datetime, datetime]:
    if end < start:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="range_end_date must be on or after range_start_date",
        )
    return ist_range_bounds(start, end)


def _needs_payment_receipt_filter(
    *,
    payment_method: ShopBillPaymentMethodFilter | None,
    payment_settled: bool | None,
    receipt_status: ReceiptStatus | None,
) -> bool:
    return (
        payment_method is not None
        or payment_settled is not None
        or receipt_status is not None
    )


def _is_default_sort(sort_by: ShopBillSortField, sort_dir: str) -> bool:
    return sort_by == ShopBillSortField.CREATED_AT and sort_dir.lower() == "desc"


async def list_shop_bills(
    db: AsyncSession,
    shop: Shop,
    *,
    page: int = 1,
    page_size: int = 10,
    bill_no: str | None = None,
    range_start_date: date | None = None,
    range_end_date: date | None = None,
    payment_method: ShopBillPaymentMethodFilter | None = None,
    payment_settled: bool | None = None,
    receipt_status: ReceiptStatus | None = None,
    created_by_user_id: UUID | None = None,
    amount_min: Decimal | None = None,
    amount_max: Decimal | None = None,
    sort_by: ShopBillSortField = ShopBillSortField.CREATED_AT,
    sort_dir: str = "desc",
) -> ShopBillPage:
    if page < 1:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="page must be >= 1",
        )
    if page_size < 1 or page_size > 100:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="page_size must be between 1 and 100",
        )

    filter_hash = hash_cache_parts(
        page,
        page_size,
        bill_no,
        range_start_date,
        range_end_date,
        payment_method.value if payment_method else None,
        payment_settled,
        receipt_status.value if receipt_status else None,
        created_by_user_id,
        amount_min,
        amount_max,
        sort_by.value,
        sort_dir.lower(),
    )
    cache_key = await shop_bills_cache_key(shop.id, filter_hash)
    cached = await cache_get_json(cache_key)
    if isinstance(cached, dict):
        try:
            return ShopBillPage.model_validate(cached)
        except Exception:
            pass

    page_result = await _list_shop_bills_from_db(
        db,
        shop,
        page=page,
        page_size=page_size,
        bill_no=bill_no,
        range_start_date=range_start_date,
        range_end_date=range_end_date,
        payment_method=payment_method,
        payment_settled=payment_settled,
        receipt_status=receipt_status,
        created_by_user_id=created_by_user_id,
        amount_min=amount_min,
        amount_max=amount_max,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )
    await cache_set_json(
        cache_key,
        page_result.model_dump(mode="json"),
        ttl_seconds=get_settings().redis_shop_bills_cache_ttl,
    )
    return page_result


async def _list_shop_bills_from_db(
    db: AsyncSession,
    shop: Shop,
    *,
    page: int,
    page_size: int,
    bill_no: str | None,
    range_start_date: date | None,
    range_end_date: date | None,
    payment_method: ShopBillPaymentMethodFilter | None,
    payment_settled: bool | None,
    receipt_status: ReceiptStatus | None,
    created_by_user_id: UUID | None,
    amount_min: Decimal | None,
    amount_max: Decimal | None,
    sort_by: ShopBillSortField,
    sort_dir: str,
) -> ShopBillPage:
    bill_filters = [Bill.shop_id == shop.id]
    if bill_no:
        bill_filters.append(Bill.bill_no.ilike(f"%{bill_no.strip()}%"))
    if range_start_date and range_end_date:
        start_dt, end_dt = _day_bounds(range_start_date, range_end_date)
        bill_filters.append(Bill.created_at >= start_dt)
        bill_filters.append(Bill.created_at < end_dt)
    elif range_start_date:
        bill_filters.append(Bill.created_at >= ist_midnight(range_start_date))
    elif range_end_date:
        bill_filters.append(Bill.created_at < ist_midnight(range_end_date + timedelta(days=1)))
    if amount_min is not None:
        bill_filters.append(Bill.total_amount >= amount_min)
    if amount_max is not None:
        bill_filters.append(Bill.total_amount <= amount_max)
    if created_by_user_id is not None:
        bill_filters.append(Bill.created_by_user_id == created_by_user_id)

    payment_receipt_filters: list = []
    if payment_settled is not None:
        payment_receipt_filters.append(Payment.is_settled.is_(payment_settled))
    if receipt_status is not None:
        # Compare as text: tenant schemas may have a local receiptstatus twin that
        # cannot be compared to SQLAlchemy's public.receiptstatus bind type.
        payment_receipt_filters.append(
            cast(Receipt.receipt_status, String) == receipt_status.value
        )
    if payment_method == ShopBillPaymentMethodFilter.CASH:
        payment_receipt_filters.append(Payment.cash_amount > _ZERO)
        payment_receipt_filters.append(Payment.upi_amount == _ZERO)
    elif payment_method == ShopBillPaymentMethodFilter.UPI:
        payment_receipt_filters.append(Payment.upi_amount > _ZERO)
        payment_receipt_filters.append(Payment.cash_amount == _ZERO)
    elif payment_method == ShopBillPaymentMethodFilter.MIXED:
        payment_receipt_filters.append(Payment.cash_amount > _ZERO)
        payment_receipt_filters.append(Payment.upi_amount > _ZERO)

    use_two_step = (
        not _needs_payment_receipt_filter(
            payment_method=payment_method,
            payment_settled=payment_settled,
            receipt_status=receipt_status,
        )
        and _is_default_sort(sort_by, sort_dir)
    )

    if use_two_step:
        # Bills-only count + page IDs use shop_id+created_at index; hydrate joins for page only.
        total_count = int(
            await db.scalar(select(func.count(Bill.id)).where(*bill_filters)) or 0
        )
        total_pages = max(1, ceil(total_count / page_size)) if total_count else 0
        bill_ids = (
            await db.scalars(
                select(Bill.id)
                .where(*bill_filters)
                .order_by(desc(Bill.created_at), desc(Bill.id))
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
        if not bill_ids:
            return ShopBillPage(
                items=[],
                page=page,
                page_size=page_size,
                total_count=int(total_count),
                total_pages=total_pages,
            )
        rows = (
            await db.execute(
                select(Bill, Payment, Receipt, User.username)
                .join(Payment, Payment.bill_id == Bill.id)
                .join(Receipt, Receipt.bill_id == Bill.id)
                .outerjoin(User, User.id == Bill.created_by_user_id)
                .where(Bill.id.in_(bill_ids))
            )
        ).all()
        by_id = {bill.id: (bill, payment, receipt, username) for bill, payment, receipt, username in rows}
        ordered_rows = [by_id[bill_id] for bill_id in bill_ids if bill_id in by_id]
    else:
        filters = [*bill_filters, *payment_receipt_filters]
        # Count only Bill.id — avoid wrapping the full joined row projection.
        count_query = (
            select(func.count(Bill.id))
            .join(Payment, Payment.bill_id == Bill.id)
            .join(Receipt, Receipt.bill_id == Bill.id)
            .where(*filters)
        )
        total_count = int(await db.scalar(count_query) or 0)
        total_pages = max(1, ceil(total_count / page_size)) if total_count else 0

        sort_column = {
            ShopBillSortField.BILL_NO: Bill.bill_no,
            ShopBillSortField.CREATED_AT: Bill.created_at,
            ShopBillSortField.TOTAL_AMOUNT: Bill.total_amount,
            ShopBillSortField.CREATED_BY: User.username,
        }[sort_by]
        order_fn = desc if sort_dir.lower() == "desc" else asc

        list_query = (
            select(Bill, Payment, Receipt, User.username)
            .join(Payment, Payment.bill_id == Bill.id)
            .join(Receipt, Receipt.bill_id == Bill.id)
            .outerjoin(User, User.id == Bill.created_by_user_id)
            .where(*filters)
            .order_by(order_fn(sort_column), desc(Bill.id))
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        ordered_rows = (await db.execute(list_query)).all()

    items = [
        ShopBillSummaryRead(
            bill_id=bill.id,
            bill_no=bill.bill_no,
            created_at=bill.created_at,
            total_items=bill.item_count,
            total_quantity=bill.total_quantity,
            grand_total=bill.total_amount,
            paid_amount=payment.total_paid,
            balance_amount=payment.balance,
            payment_method=_payment_method_code(payment.cash_amount, payment.upi_amount),
            receipt_status=receipt.receipt_status,
            status=bill.status,
            created_by_name=username,
        )
        for bill, payment, receipt, username in ordered_rows
    ]

    return ShopBillPage(
        items=items,
        page=page,
        page_size=page_size,
        total_count=int(total_count),
        total_pages=total_pages,
    )


async def get_shop_bill(db: AsyncSession, shop: Shop, bill_id: UUID):
    return await _bill_read_for_shop(db, shop, bill_id)
