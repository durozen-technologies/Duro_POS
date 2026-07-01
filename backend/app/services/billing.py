import base64
import binascii
import hashlib
import hmac
import json
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.ids import uuid7
from app.models import (
    Bill,
    BillItem,
    BillStatus,
    DailyPrice,
    InventoryMovement,
    InventoryMovementType,
    Item,
    MonthlyBillSequence,
    Organization,
    Payment,
    Receipt,
    Shop,
    ShopItemAllocation,
)
from app.schemas.billing import (
    BillCheckoutCommitRequest,
    BillCheckoutPreviewRead,
    BillCheckoutRequest,
    BillLineRead,
    BillRead,
    PaymentRead,
    ReceiptRead,
)

TWOPLACES = Decimal("0.01")
THREEPLACES = Decimal("0.001")
CHECKOUT_TOKEN_MAX_AGE_SECONDS = 15 * 60


@dataclass(frozen=True)
class PreparedBillLine:
    item_id: UUID
    item_name: str
    item_tamil_name: str | None
    item_unit_type: Any
    item_base_unit: Any
    quantity: Decimal
    unit: Any
    price_per_unit: Decimal
    line_total: Decimal
    assumption_percent: Decimal | None = None
    assumption_inventory_item_id: UUID | None = None
    assumption_inventory_category_id: UUID | None = None


@dataclass(frozen=True)
class PreparedCheckout:
    lines: list[PreparedBillLine]
    total_amount: Decimal
    cash_amount: Decimal
    upi_amount: Decimal
    total_paid: Decimal


def _round_money(value: Decimal) -> Decimal:
    return value.quantize(TWOPLACES, rounding=ROUND_HALF_UP)


async def _shop_organization_name(db: AsyncSession, shop: Shop) -> str:
    org = await db.get(Organization, shop.organization_id)
    return org.name if org is not None else ""


def _decimal_token(value: Decimal) -> str:
    return format(value.normalize(), "f")


def _token_key() -> bytes:
    settings = get_settings()
    return (settings.secret_key or settings.app_name).encode()


def _encode_checkout_token(payload: dict[str, Any]) -> str:
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    signature = hmac.new(_token_key(), body, hashlib.sha256).digest()
    body_part = base64.urlsafe_b64encode(body).decode().rstrip("=")
    signature_part = base64.urlsafe_b64encode(signature).decode().rstrip("=")
    return f"{body_part}.{signature_part}"


def _decode_checkout_token(token: str) -> dict[str, Any]:
    try:
        body_part, signature_part = token.split(".", 1)
        body = base64.urlsafe_b64decode(body_part + "=" * (-len(body_part) % 4))
        signature = base64.urlsafe_b64decode(signature_part + "=" * (-len(signature_part) % 4))
    except (binascii.Error, ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Invalid checkout token",
        )

    expected_signature = hmac.new(_token_key(), body, hashlib.sha256).digest()
    if not hmac.compare_digest(signature, expected_signature):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Invalid checkout token",
        )

    try:
        decoded = json.loads(body.decode())
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Invalid checkout token",
        )

    if not isinstance(decoded, dict):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Invalid checkout token",
        )

    issued_at = decoded.get("issued_at")
    if not isinstance(issued_at, str):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Invalid checkout token",
        )

    try:
        issued_at_dt = datetime.fromisoformat(issued_at)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Invalid checkout token",
        )

    if datetime.now(UTC).timestamp() - issued_at_dt.timestamp() > CHECKOUT_TOKEN_MAX_AGE_SECONDS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Checkout token expired. Please print the receipt again.",
        )

    return decoded


def _payload_fingerprint(payload: BillCheckoutRequest) -> str:
    canonical_payload = {
        "items": [
            {
                "item_id": str(line.item_id),
                "quantity": _decimal_token(line.quantity),
            }
            for line in payload.items
        ],
        "payment": {
            "cash_amount": _decimal_token(_round_money(payload.payment.cash_amount)),
            "upi_amount": _decimal_token(_round_money(payload.payment.upi_amount)),
        },
    }
    encoded = json.dumps(canonical_payload, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(encoded.encode()).hexdigest()


def _bill_no_from_sequence(now: datetime, sequence: int) -> str:
    return f"SMB-{now.year:04d}-{now.month:02d}-{sequence:06d}"


async def _peek_next_bill_sequence(db: AsyncSession, now: datetime) -> int:
    month_str = f"{now.year:04d}-{now.month:02d}"
    current_value = await db.scalar(
        select(MonthlyBillSequence.current_value).where(MonthlyBillSequence.month_year == month_str)
    )
    return int(current_value or 0) + 1


async def _sync_printed_bill_sequence(
    db: AsyncSession,
    month_str: str,
    sequence: int,
) -> None:
    sequence_row = await db.get(
        MonthlyBillSequence,
        month_str,
        with_for_update=True,
    )
    if sequence_row is None:
        db.add(MonthlyBillSequence(month_year=month_str, current_value=sequence))
        return

    if sequence_row.current_value < sequence:
        sequence_row.current_value = sequence


def _line_to_read(line: PreparedBillLine) -> BillLineRead:
    return BillLineRead(
        item_id=line.item_id,
        item_name=line.item_name,
        item_tamil_name=line.item_tamil_name,
        item_unit_type=line.item_unit_type,
        item_base_unit=line.item_base_unit,
        quantity=line.quantity,
        unit=line.unit,
        price_per_unit=line.price_per_unit,
        line_total=line.line_total,
    )


def _inventory_movement_for_assumption(
    shop: Shop, line: PreparedBillLine
) -> InventoryMovement | None:
    if (
        line.unit.value != "kg"
        or line.assumption_percent is None
        or line.assumption_inventory_item_id is None
        or line.assumption_inventory_category_id is None
    ):
        return None

    quantity = (line.quantity * line.assumption_percent / Decimal("100")).quantize(
        THREEPLACES, rounding=ROUND_HALF_UP
    )
    if quantity <= 0:
        return None

    return InventoryMovement(
        shop_id=shop.id,
        inventory_item_id=line.assumption_inventory_item_id,
        category_id=line.assumption_inventory_category_id,
        movement_type=InventoryMovementType.USE,
        quantity=quantity,
        occurred_at=datetime.now(UTC),
    )


async def _prepare_checkout(
    db: AsyncSession,
    shop: Shop,
    payload: BillCheckoutRequest,
) -> PreparedCheckout:
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
            select(
                Item.id,
                Item.name,
                Item.tamil_name,
                Item.unit_type,
                Item.base_unit,
                Item.assumption_percent,
                Item.assumption_inventory_item_id,
                Item.assumption_inventory_category_id,
                ShopItemAllocation.display_name,
                ShopItemAllocation.tamil_name.label("allocation_tamil_name"),
            )
            .outerjoin(
                ShopItemAllocation,
                and_(
                    ShopItemAllocation.item_id == Item.id,
                    ShopItemAllocation.shop_id == shop.id,
                ),
            )
            .where(
                Item.id.in_(item_ids),
                Item.is_active.is_(True),
                or_(
                    Item.shop_id == shop.id,
                    and_(
                        Item.shop_id.is_(None),
                        ShopItemAllocation.id.is_not(None),
                        ShopItemAllocation.is_active.is_(True),
                    ),
                ),
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

    bill_lines: list[PreparedBillLine] = []
    total_amount = Decimal("0.00")

    for line in payload.items:
        item = items_by_id[line.item_id]
        item_name = (item.display_name or item.name).strip()
        item_tamil_name = item.allocation_tamil_name or item.tamil_name
        if item.base_unit.value == "unit" and line.quantity != line.quantity.to_integral_value():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"{item_name} only accepts integer unit quantities",
            )

        price_per_unit = price_map.get(item.id)
        if price_per_unit is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Missing today's price for {item_name}",
            )
        if price_per_unit <= 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Today's price for {item_name} must be greater than 0",
            )

        line_total = _round_money(price_per_unit * line.quantity)
        total_amount += line_total
        bill_lines.append(
            PreparedBillLine(
                item_id=item.id,
                item_name=item_name,
                item_tamil_name=item_tamil_name,
                item_unit_type=item.unit_type,
                item_base_unit=item.base_unit,
                quantity=line.quantity,
                unit=item.base_unit,
                price_per_unit=price_per_unit,
                line_total=line_total,
                assumption_percent=item.assumption_percent,
                assumption_inventory_item_id=item.assumption_inventory_item_id,
                assumption_inventory_category_id=item.assumption_inventory_category_id,
            )
        )

    total_amount = _round_money(total_amount)
    cash_amount = _round_money(payload.payment.cash_amount)
    upi_amount = _round_money(payload.payment.upi_amount)
    total_paid = _round_money(cash_amount + upi_amount)
    balance = _round_money(total_amount - total_paid)

    if total_paid < total_amount:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Payment pending. Balance: {balance}",
        )
    if total_paid > total_amount:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Payment exceeds total amount. Receipt remains blocked until corrected",
        )

    return PreparedCheckout(
        lines=bill_lines,
        total_amount=total_amount,
        cash_amount=cash_amount,
        upi_amount=upi_amount,
        total_paid=total_paid,
    )


async def preview_bill(
    db: AsyncSession,
    shop: Shop,
    payload: BillCheckoutRequest,
) -> BillCheckoutPreviewRead:
    """Build a printable bill without saving any billing data."""
    prepared = await _prepare_checkout(db, shop, payload)
    now = datetime.now(UTC)
    sequence = await _peek_next_bill_sequence(db, now)
    if sequence > 999999:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Monthly bill sequence limit reached for SMB bill format",
        )

    bill_no = _bill_no_from_sequence(now, sequence)
    organization_name = await _shop_organization_name(db, shop)
    token_payload = {
        "bill_no": bill_no,
        "created_at": now.isoformat(),
        "issued_at": now.isoformat(),
        "month_year": f"{now.year:04d}-{now.month:02d}",
        "payload_hash": _payload_fingerprint(payload),
        "sequence": sequence,
        "shop_id": str(shop.id),
    }

    return BillCheckoutPreviewRead(
        id=uuid7(),
        bill_no=bill_no,
        shop_id=shop.id,
        shop_name=shop.name,
        organization_name=organization_name,
        total_amount=prepared.total_amount,
        status=BillStatus.PAID.value,
        created_at=now,
        items=[_line_to_read(line) for line in prepared.lines],
        payment=PaymentRead(
            id=uuid7(),
            cash_amount=prepared.cash_amount,
            upi_amount=prepared.upi_amount,
            total_paid=prepared.total_paid,
            balance=Decimal("0.00"),
            is_settled=True,
        ),
        receipt=ReceiptRead(
            id=uuid7(),
            receipt_number=f"RCT-{bill_no}",
            printed_at=now,
        ),
        checkout_token=_encode_checkout_token(token_payload),
    )


async def create_bill(
    db: AsyncSession,
    shop: Shop,
    payload: BillCheckoutCommitRequest,
) -> BillRead:
    """Persist a paid bill only after the receipt has been printed."""
    prepared = await _prepare_checkout(db, shop, payload)
    organization_name = await _shop_organization_name(db, shop)
    token_payload = _decode_checkout_token(payload.checkout_token)

    if token_payload.get("shop_id") != str(shop.id) or token_payload.get(
        "payload_hash"
    ) != _payload_fingerprint(payload):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Checkout token does not match this printed receipt",
        )

    bill_no = token_payload.get("bill_no")
    month_str = token_payload.get("month_year")
    sequence = token_payload.get("sequence")
    created_at_raw = token_payload.get("created_at")
    if (
        not isinstance(bill_no, str)
        or not isinstance(month_str, str)
        or not isinstance(sequence, int)
        or not isinstance(created_at_raw, str)
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Invalid checkout token",
        )

    try:
        created_at = datetime.fromisoformat(created_at_raw)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Invalid checkout token",
        )

    await _sync_printed_bill_sequence(db, month_str, sequence)

    bill = Bill(
        bill_no=bill_no,
        shop_id=shop.id,
        total_amount=prepared.total_amount,
        status=BillStatus.PAID,
        created_at=created_at,
        items=[
            BillItem(
                item_id=line.item_id,
                item_name=line.item_name,
                item_tamil_name=line.item_tamil_name,
                item_unit_type=line.item_unit_type,
                item_base_unit=line.item_base_unit,
                quantity=line.quantity,
                unit=line.unit,
                price_per_unit=line.price_per_unit,
                line_total=line.line_total,
            )
            for line in prepared.lines
        ],
    )
    db.add(bill)

    # First flush claims the printed bill number; second flush creates receipt rows.
    try:
        await db.flush()
        payment = Payment(
            bill_id=bill.id,
            cash_amount=prepared.cash_amount,
            upi_amount=prepared.upi_amount,
            total_paid=prepared.total_paid,
            balance=Decimal("0.00"),
            is_settled=True,
        )
        receipt = Receipt(
            bill_id=bill.id,
            receipt_number=f"RCT-{bill.bill_no}",
            printed_at=datetime.now(UTC),
        )
        assumption_movements = [
            movement
            for line in prepared.lines
            if (movement := _inventory_movement_for_assumption(shop, line)) is not None
        ]
        db.add_all([payment, receipt, *assumption_movements])
        await db.flush()
        await db.commit()
    except IntegrityError:
        if hasattr(db, "rollback"):
            await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Printed receipt number was already saved. Please print a new receipt.",
        )

    return BillRead(
        id=bill.id,
        bill_no=bill.bill_no,
        shop_id=shop.id,
        shop_name=shop.name,
        organization_name=organization_name,
        total_amount=bill.total_amount,
        status=bill.status.value,
        created_at=bill.created_at,
        items=[_line_to_read(line) for line in prepared.lines],
        payment=payment,
        receipt=receipt,
    )
