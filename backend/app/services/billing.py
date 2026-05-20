from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Bill,
    BillItem,
    BillStatus,
    DailyPrice,
    Item,
    MonthlyBillSequence,
    Payment,
    Receipt,
    Shop,
)
from app.schemas.billing import BillCheckoutRequest, BillLineRead, BillRead

TWOPLACES = Decimal("0.01")


def _round_money(value: Decimal) -> Decimal:
    return value.quantize(TWOPLACES, rounding=ROUND_HALF_UP)


async def _generate_bill_no(db: AsyncSession) -> str:
    now = datetime.now(UTC)
    month_str = f"{now.year:04d}-{now.month:02d}"

    stmt = (
        update(MonthlyBillSequence)
        .where(MonthlyBillSequence.month_year == month_str)
        .values(current_value=MonthlyBillSequence.current_value + 1)
        .returning(MonthlyBillSequence.current_value)
    )
    result = await db.scalar(stmt)

    if result is None:
        try:
            db.add(MonthlyBillSequence(month_year=month_str, current_value=1))
            await db.flush()
            result = 1
        except IntegrityError:
            await db.rollback()
            result = await db.scalar(stmt)

    sequence = int(result or 1)
    if sequence > 999999:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Monthly bill sequence limit reached for SMB bill format",
        )

    return f"SMB-{now.year:04d}-{now.month:02d}-{sequence:06d}"


async def create_bill(db: AsyncSession, shop: Shop, payload: BillCheckoutRequest) -> BillRead:
    """Create a paid bill using today's price book for the given shop."""
    today = date.today()
    price_rows = (
        await db.execute(
            select(
                DailyPrice.item_id,
                DailyPrice.price_per_unit,
            ).where(
                DailyPrice.shop_id == shop.id,
                DailyPrice.price_date == today,
            )
        )
    ).all()
    price_map = {row.item_id: row.price_per_unit for row in price_rows}
    if not price_map:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No prices have been configured for this shop",
        )

    item_ids = [line.item_id for line in payload.items]
    item_rows = (
        await db.execute(
            select(Item.id, Item.name, Item.base_unit).where(
                Item.id.in_(item_ids),
                Item.is_active.is_(True),
            )
        )
    ).all()
    items_by_id = {row.id: row for row in item_rows}
    missing_ids = [item_id for item_id in item_ids if item_id not in items_by_id]
    if missing_ids:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Items not found or inactive: {missing_ids}",
        )

    bill_items: list[BillItem] = []
    bill_lines: list[BillLineRead] = []
    total_amount = Decimal("0.00")

    for line in payload.items:
        item = items_by_id[line.item_id]
        if item.base_unit.value == "unit" and line.quantity != line.quantity.to_integral_value():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"{item.name} only accepts integer unit quantities",
            )

        price_per_unit = price_map.get(item.id)
        if price_per_unit is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Missing today's price for {item.name}",
            )

        line_total = _round_money(price_per_unit * line.quantity)
        total_amount += line_total
        bill_items.append(
            BillItem(
                item_id=item.id,
                quantity=line.quantity,
                unit=item.base_unit,
                price_per_unit=price_per_unit,
                line_total=line_total,
            )
        )
        bill_lines.append(
            BillLineRead(
                item_id=item.id,
                item_name=item.name,
                quantity=line.quantity,
                unit=item.base_unit,
                price_per_unit=price_per_unit,
                line_total=line_total,
            )
        )

    total_amount = _round_money(total_amount)
    cash_amount = _round_money(payload.payment.cash_amount)
    upi_amount = _round_money(payload.payment.upi_amount)
    total_paid = _round_money(cash_amount + upi_amount)
    balance = _round_money(total_amount - total_paid)

    if total_paid < total_amount:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Payment pending. Balance: {balance}",
        )
    if total_paid > total_amount:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Payment exceeds total amount. Receipt remains blocked until corrected",
        )

    bill = Bill(
        bill_no=await _generate_bill_no(db),
        shop_id=shop.id,
        total_amount=total_amount,
        status=BillStatus.PAID,
        items=bill_items,
    )
    db.add(bill)
    await db.flush()

    payment = Payment(
        bill_id=bill.id,
        cash_amount=cash_amount,
        upi_amount=upi_amount,
        total_paid=total_paid,
        balance=Decimal("0.00"),
        is_settled=True,
    )
    receipt = Receipt(
        bill_id=bill.id,
        receipt_number=f"RCT-{bill.bill_no}",
        printed_at=datetime.now(UTC),
    )
    db.add_all([payment, receipt])

    # Flush once so payment/receipt IDs are available without extra refresh queries.
    await db.flush()
    await db.commit()

    return BillRead(
        id=bill.id,
        bill_no=bill.bill_no,
        shop_id=shop.id,
        shop_name=shop.name,
        total_amount=bill.total_amount,
        status=bill.status.value,
        created_at=bill.created_at,
        items=bill_lines,
        payment=payment,
        receipt=receipt,
    )
