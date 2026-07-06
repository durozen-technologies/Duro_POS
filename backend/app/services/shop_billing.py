from datetime import UTC, date, datetime, time
from decimal import Decimal
from math import ceil
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import asc, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Bill, Payment, Receipt, Shop, User
from app.models.enums import ReceiptStatus
from app.schemas.billing import (
    ShopBillPage,
    ShopBillPaymentMethodFilter,
    ShopBillSortField,
    ShopBillSummaryRead,
)
from app.services.admin.catalogue import _bill_to_read
from app.services.billing import _bill_read_for_shop, _load_bill_for_shop


def _payment_method_label(cash_amount: Decimal, upi_amount: Decimal) -> str:
    if cash_amount > 0 and upi_amount > 0:
        return "Cash + UPI"
    if upi_amount > 0:
        return "UPI"
    return "Cash"


def _day_bounds(start: date, end: date) -> tuple[datetime, datetime]:
    start_dt = datetime.combine(start, time.min, tzinfo=UTC)
    end_dt = datetime.combine(end, time.max, tzinfo=UTC)
    if end < start:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="range_end_date must be on or after range_start_date",
        )
    return start_dt, end_dt


async def list_shop_bills(
    db: AsyncSession,
    shop: Shop,
    *,
    page: int = 1,
    page_size: int = 20,
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

    filters = [Bill.shop_id == shop.id]
    if bill_no:
        filters.append(Bill.bill_no.ilike(f"%{bill_no.strip()}%"))
    if range_start_date and range_end_date:
        start_dt, end_dt = _day_bounds(range_start_date, range_end_date)
        filters.append(Bill.created_at >= start_dt)
        filters.append(Bill.created_at <= end_dt)
    elif range_start_date:
        filters.append(Bill.created_at >= datetime.combine(range_start_date, time.min, tzinfo=UTC))
    elif range_end_date:
        filters.append(Bill.created_at <= datetime.combine(range_end_date, time.max, tzinfo=UTC))
    if amount_min is not None:
        filters.append(Bill.total_amount >= amount_min)
    if amount_max is not None:
        filters.append(Bill.total_amount <= amount_max)
    if created_by_user_id is not None:
        filters.append(Bill.created_by_user_id == created_by_user_id)

    query = (
        select(Bill, Payment, Receipt, User.username)
        .join(Payment, Payment.bill_id == Bill.id)
        .join(Receipt, Receipt.bill_id == Bill.id)
        .outerjoin(User, User.id == Bill.created_by_user_id)
        .where(*filters)
    )

    if payment_settled is not None:
        query = query.where(Payment.is_settled.is_(payment_settled))
    if receipt_status is not None:
        query = query.where(Receipt.receipt_status == receipt_status)
    if payment_method == ShopBillPaymentMethodFilter.CASH:
        query = query.where(Payment.cash_amount > 0, Payment.upi_amount == 0)
    elif payment_method == ShopBillPaymentMethodFilter.UPI:
        query = query.where(Payment.upi_amount > 0, Payment.cash_amount == 0)
    elif payment_method == ShopBillPaymentMethodFilter.MIXED:
        query = query.where(Payment.cash_amount > 0, Payment.upi_amount > 0)

    total_count = await db.scalar(select(func.count()).select_from(query.subquery())) or 0
    total_pages = max(1, ceil(total_count / page_size)) if total_count else 0

    sort_column = {
        ShopBillSortField.BILL_NO: Bill.bill_no,
        ShopBillSortField.CREATED_AT: Bill.created_at,
        ShopBillSortField.TOTAL_AMOUNT: Bill.total_amount,
        ShopBillSortField.CREATED_BY: User.username,
    }[sort_by]
    order_fn = desc if sort_dir.lower() == "desc" else asc
    ordered = query.order_by(order_fn(sort_column), desc(Bill.id)).offset((page - 1) * page_size).limit(
        page_size
    )

    rows = (await db.execute(ordered)).all()
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
            payment_method=_payment_method_label(payment.cash_amount, payment.upi_amount),
            receipt_status=receipt.receipt_status,
            created_by_name=username,
        )
        for bill, payment, receipt, username in rows
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
