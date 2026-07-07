"""Retailer sale checkout, payments, and sale reads."""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import logging
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.ids import uuid7
from app.core.timezone import ist_month_key
from app.db.storage import build_item_image_path, build_item_image_thumb_path
from app.models import (
    AuditLog,
    Item,
    MonthlyRetailerSaleSequence,
    Organization,
    Retailer,
    RetailerItemPrice,
    RetailerPayment,
    RetailerReceiptType,
    RetailerSale,
    RetailerSaleItem,
    RetailerSaleReceipt,
    RetailerSaleStatus,
    Shop,
    ShopItemAllocation,
    ShopRetailerItemAllocation,
    User,
)
from app.schemas.retailers import (
    RetailerCatalogItemRead,
    RetailerPaymentCreate,
    RetailerPaymentRead,
    RetailerPaymentRecordResponse,
    RetailerSaleCheckoutCommitRequest,
    RetailerSaleCheckoutRequest,
    RetailerSaleLineRead,
    RetailerSalePage,
    RetailerSalePreviewRead,
    RetailerSaleRead,
    RetailerSaleReceiptPage,
    RetailerSaleReceiptRead,
)
from app.services.retailer_receipt_number import balance_receipt_number, invoice_receipt_number
from app.services.retailer_sale_number import retailer_sale_no_from_sequence
from app.services.retailers import is_retailer_allocated_to_shop

logger = logging.getLogger(__name__)

TWOPLACES = Decimal("0.01")
CHECKOUT_TOKEN_MAX_AGE_SECONDS = 15 * 60


@dataclass(frozen=True)
class PreparedRetailerLine:
    item_id: UUID
    item_name: str
    item_tamil_name: str | None
    item_unit_type: Any
    item_base_unit: Any
    quantity: Decimal
    unit: Any
    price_per_unit: Decimal
    line_total: Decimal


@dataclass(frozen=True)
class PreparedRetailerCheckout:
    lines: list[PreparedRetailerLine]
    total_amount: Decimal
    cash_amount: Decimal
    upi_amount: Decimal
    total_paid: Decimal
    balance_due: Decimal


def _round_money(value: Decimal) -> Decimal:
    return value.quantize(TWOPLACES, rounding=ROUND_HALF_UP)


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
        raise HTTPException(status_code=422, detail="Invalid checkout token")

    expected_signature = hmac.new(_token_key(), body, hashlib.sha256).digest()
    if not hmac.compare_digest(signature, expected_signature):
        raise HTTPException(status_code=422, detail="Invalid checkout token")

    try:
        decoded = json.loads(body.decode())
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail="Invalid checkout token")

    if not isinstance(decoded, dict):
        raise HTTPException(status_code=422, detail="Invalid checkout token")

    issued_at = decoded.get("issued_at")
    if not isinstance(issued_at, str):
        raise HTTPException(status_code=422, detail="Invalid checkout token")

    try:
        issued_at_dt = datetime.fromisoformat(issued_at)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid checkout token")

    if datetime.now(UTC).timestamp() - issued_at_dt.timestamp() > CHECKOUT_TOKEN_MAX_AGE_SECONDS:
        raise HTTPException(
            status_code=409,
            detail="Checkout token expired. Please print the receipt again.",
        )

    return decoded


def _payload_fingerprint(payload: RetailerSaleCheckoutRequest) -> str:
    canonical_payload = {
        "retailer_id": str(payload.retailer_id),
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


def _sale_status(total_amount: Decimal, amount_paid: Decimal) -> RetailerSaleStatus:
    balance = _round_money(total_amount - amount_paid)
    if balance <= 0:
        return RetailerSaleStatus.SETTLED
    if amount_paid > 0:
        return RetailerSaleStatus.PARTIAL
    return RetailerSaleStatus.OPEN


async def _shop_organization_name(db: AsyncSession, shop: Shop) -> str:
    org = await db.get(Organization, shop.organization_id)
    return org.name if org is not None else ""


async def _peek_next_sale_sequence(db: AsyncSession, now: datetime) -> int:
    month_str = ist_month_key(now)
    current_value = await db.scalar(
        select(MonthlyRetailerSaleSequence.current_value).where(
            MonthlyRetailerSaleSequence.month_year == month_str
        )
    )
    return int(current_value or 0) + 1


async def _sync_printed_sale_sequence(db: AsyncSession, month_str: str, sequence: int) -> None:
    sequence_row = await db.get(
        MonthlyRetailerSaleSequence,
        month_str,
        with_for_update=True,
    )
    if sequence_row is None:
        db.add(MonthlyRetailerSaleSequence(month_year=month_str, current_value=sequence))
        return
    if sequence_row.current_value < sequence:
        sequence_row.current_value = sequence


def _line_to_read(line: PreparedRetailerLine) -> RetailerSaleLineRead:
    return RetailerSaleLineRead(
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


async def _get_active_retailer(
    db: AsyncSession,
    retailer_id: UUID,
    *,
    shop: Shop | None = None,
) -> Retailer:
    retailer = await db.get(Retailer, retailer_id)
    if retailer is None or not retailer.is_active:
        raise HTTPException(status_code=404, detail="Retailer not found")
    if shop is not None and not await is_retailer_allocated_to_shop(
        db,
        shop_id=shop.id,
        retailer_id=retailer_id,
    ):
        raise HTTPException(status_code=404, detail="Retailer not available at this branch")
    return retailer


async def _prepare_retailer_checkout(
    db: AsyncSession,
    shop: Shop,
    payload: RetailerSaleCheckoutRequest,
    *,
    max_payable: Decimal | None = None,
) -> PreparedRetailerCheckout:
    await _get_active_retailer(db, payload.retailer_id, shop=shop)
    item_ids = [line.item_id for line in payload.items]

    price_rows = (
        await db.execute(
            select(
                RetailerItemPrice.item_id,
                RetailerItemPrice.price_per_unit,
                Item.name,
                Item.tamil_name,
                Item.unit_type,
                Item.base_unit,
                ShopItemAllocation.display_name,
                ShopItemAllocation.tamil_name.label("allocation_tamil_name"),
            )
            .join(Item, Item.id == RetailerItemPrice.item_id)
            .join(
                ShopRetailerItemAllocation,
                and_(
                    ShopRetailerItemAllocation.item_id == Item.id,
                    ShopRetailerItemAllocation.shop_id == shop.id,
                    ShopRetailerItemAllocation.is_active.is_(True),
                ),
            )
            .outerjoin(
                ShopItemAllocation,
                and_(
                    ShopItemAllocation.item_id == Item.id,
                    ShopItemAllocation.shop_id == shop.id,
                ),
            )
            .where(
                RetailerItemPrice.retailer_id == payload.retailer_id,
                RetailerItemPrice.shop_id == shop.id,
                RetailerItemPrice.item_id.in_(item_ids),
                RetailerItemPrice.effective_date == func.current_date(),
                RetailerItemPrice.is_active.is_(True),
                Item.is_active.is_(True),
            )
        )
    ).all()
    price_map = {row.item_id: row for row in price_rows}
    missing = [str(i) for i in item_ids if i not in price_map]
    if missing:
        raise HTTPException(status_code=422, detail=f"Items not mapped for retailer: {missing}")

    lines: list[PreparedRetailerLine] = []
    total_amount = Decimal("0.00")
    for line in payload.items:
        row = price_map[line.item_id]
        item_name = (row.display_name or row.name).strip()
        item_tamil_name = row.allocation_tamil_name or row.tamil_name
        if row.base_unit.value == "unit" and line.quantity != line.quantity.to_integral_value():
            raise HTTPException(
                status_code=422,
                detail=f"{item_name} only accepts integer unit quantities",
            )
        price_per_unit = _round_money(row.price_per_unit)
        if price_per_unit <= 0:
            raise HTTPException(status_code=422, detail=f"Invalid price for {item_name}")
        line_total = _round_money(price_per_unit * line.quantity)
        total_amount += line_total
        lines.append(
            PreparedRetailerLine(
                item_id=row.item_id,
                item_name=item_name,
                item_tamil_name=item_tamil_name,
                item_unit_type=row.unit_type,
                item_base_unit=row.base_unit,
                quantity=line.quantity,
                unit=row.base_unit,
                price_per_unit=price_per_unit,
                line_total=line_total,
            )
        )

    total_amount = _round_money(total_amount)
    cash_amount = _round_money(payload.payment.cash_amount)
    upi_amount = _round_money(payload.payment.upi_amount)
    total_paid = _round_money(cash_amount + upi_amount)
    if total_paid < 0:
        raise HTTPException(status_code=422, detail="Payment amounts must be non-negative")
    limit = max_payable if max_payable is not None else total_amount
    if total_paid > limit:
        raise HTTPException(
            status_code=422,
            detail=f"Payment exceeds allowed amount. Max: {limit}",
        )
    balance_due = _round_money(total_amount - total_paid)
    return PreparedRetailerCheckout(
        lines=lines,
        total_amount=total_amount,
        cash_amount=cash_amount,
        upi_amount=upi_amount,
        total_paid=total_paid,
        balance_due=balance_due,
    )


def _payment_to_read(payment: RetailerPayment) -> RetailerPaymentRead:
    return RetailerPaymentRead.model_validate(payment)


def _payment_sort_key(payment: RetailerPayment) -> tuple[datetime, str]:
    paid_at = payment.paid_at
    if paid_at.tzinfo is None:
        paid_at = paid_at.replace(tzinfo=UTC)
    return paid_at, str(payment.id)


def _receipt_sort_key(receipt: RetailerSaleReceipt) -> tuple[datetime, str]:
    printed_at = receipt.printed_at
    if printed_at.tzinfo is None:
        printed_at = printed_at.replace(tzinfo=UTC)
    return printed_at, str(receipt.id)


def _receipt_to_read(
    receipt: RetailerSaleReceipt,
    *,
    payment_totals: dict[UUID, Decimal],
) -> RetailerSaleReceiptRead:
    return RetailerSaleReceiptRead(
        id=receipt.id,
        receipt_number=receipt.receipt_number,
        receipt_type=receipt.receipt_type,
        retailer_payment_id=receipt.retailer_payment_id,
        printed_at=receipt.printed_at,
        payment_total=payment_totals.get(receipt.retailer_payment_id),
    )


def _sale_load_options():
    return (
        selectinload(RetailerSale.items),
        selectinload(RetailerSale.payments),
        selectinload(RetailerSale.receipts),
        selectinload(RetailerSale.retailer),
        selectinload(RetailerSale.shop),
    )


async def _sale_to_read(db: AsyncSession, sale: RetailerSale) -> RetailerSaleRead:
    retailer = sale.retailer or await db.get(Retailer, sale.retailer_id)
    shop = sale.shop or await db.get(Shop, sale.shop_id)
    org_name = await _shop_organization_name(db, shop) if shop else ""
    items = sorted(sale.items, key=lambda row: row.item_name or "")
    payments = sorted(sale.payments, key=_payment_sort_key)
    payment_totals = {payment.id: payment.total_paid for payment in payments}
    receipts = sorted(sale.receipts, key=_receipt_sort_key)
    receipt_reads = [
        _receipt_to_read(receipt, payment_totals=payment_totals) for receipt in receipts
    ]
    invoice_receipt = next(
        (
            receipt
            for receipt in receipt_reads
            if receipt.receipt_type == RetailerReceiptType.SALE_INVOICE
        ),
        None,
    )
    return RetailerSaleRead(
        id=sale.id,
        sale_no=sale.sale_no,
        retailer_id=sale.retailer_id,
        retailer_name=retailer.name if retailer else "",
        shop_id=sale.shop_id,
        shop_name=shop.name if shop else "",
        organization_name=org_name,
        total_amount=sale.total_amount,
        amount_paid_total=sale.amount_paid_total,
        balance_due=sale.balance_due,
        status=sale.status,
        created_at=sale.created_at,
        created_by_user_id=sale.created_by_user_id,
        items=[
            RetailerSaleLineRead(
                item_id=row.item_id,
                item_name=row.item_name or "",
                item_tamil_name=row.item_tamil_name,
                item_unit_type=row.item_unit_type,
                item_base_unit=row.item_base_unit,
                quantity=row.quantity,
                unit=row.unit,
                price_per_unit=row.price_per_unit,
                line_total=row.line_total,
            )
            for row in items
        ],
        payments=[_payment_to_read(p) for p in payments],
        receipts=receipt_reads,
        receipt=invoice_receipt,
    )


async def get_retailer_catalog(
    db: AsyncSession, shop: Shop, retailer_id: UUID
) -> list[RetailerCatalogItemRead]:
    await _get_active_retailer(db, retailer_id, shop=shop)
    rows = (
        await db.execute(
            select(
                RetailerItemPrice.item_id,
                RetailerItemPrice.price_per_unit,
                Item.name,
                Item.tamil_name,
                Item.unit_type,
                Item.base_unit,
                Item.image_object_key,
                Item.image_content_type,
                Item.image_thumbnail_object_key,
                Item.image_thumbnail_content_type,
                ShopItemAllocation.display_name,
            )
            .join(Item, Item.id == RetailerItemPrice.item_id)
            .join(
                ShopRetailerItemAllocation,
                and_(
                    ShopRetailerItemAllocation.item_id == Item.id,
                    ShopRetailerItemAllocation.shop_id == shop.id,
                    ShopRetailerItemAllocation.is_active.is_(True),
                ),
            )
            .outerjoin(
                ShopItemAllocation,
                and_(
                    ShopItemAllocation.item_id == Item.id,
                    ShopItemAllocation.shop_id == shop.id,
                ),
            )
            .where(
                RetailerItemPrice.retailer_id == retailer_id,
                RetailerItemPrice.shop_id == shop.id,
                RetailerItemPrice.effective_date == func.current_date(),
                RetailerItemPrice.is_active.is_(True),
                Item.is_active.is_(True),
            )
            .order_by(Item.sort_order.asc(), Item.name.asc())
        )
    ).all()
    return [
        RetailerCatalogItemRead(
            item_id=row.item_id,
            item_name=(row.display_name or row.name).strip(),
            item_tamil_name=row.tamil_name,
            item_unit_type=row.unit_type,
            item_base_unit=row.base_unit,
            price_per_unit=row.price_per_unit,
            image_path=build_item_image_path(
                row.item_id, row.image_object_key, row.image_content_type
            ),
            image_thumb_path=build_item_image_thumb_path(
                row.item_id,
                row.image_thumbnail_object_key,
                row.image_thumbnail_content_type,
                original_object_key=row.image_object_key,
            ),
        )
        for row in rows
    ]


async def preview_retailer_sale(
    db: AsyncSession,
    shop: Shop,
    user: User,
    payload: RetailerSaleCheckoutRequest,
) -> RetailerSalePreviewRead:
    prepared = await _prepare_retailer_checkout(db, shop, payload)
    now = datetime.now(UTC)
    sequence = await _peek_next_sale_sequence(db, now)
    try:
        sale_no = retailer_sale_no_from_sequence(now, sequence)
    except ValueError:
        raise HTTPException(status_code=409, detail="Monthly sale sequence limit reached")

    retailer = await _get_active_retailer(db, payload.retailer_id, shop=shop)
    org_name = await _shop_organization_name(db, shop)
    token_payload = {
        "sale_no": sale_no,
        "created_at": now.isoformat(),
        "issued_at": now.isoformat(),
        "month_year": ist_month_key(now),
        "payload_hash": _payload_fingerprint(payload),
        "sequence": sequence,
        "shop_id": str(shop.id),
        "retailer_id": str(payload.retailer_id),
    }
    sale_status = _sale_status(prepared.total_amount, prepared.total_paid)
    preview_payment_id = uuid7()
    preview_receipt = RetailerSaleReceiptRead(
        id=uuid7(),
        receipt_number=invoice_receipt_number(sale_no),
        receipt_type=RetailerReceiptType.SALE_INVOICE,
        retailer_payment_id=preview_payment_id,
        printed_at=now,
        payment_total=prepared.total_paid,
    )
    preview = RetailerSalePreviewRead(
        id=uuid7(),
        sale_no=sale_no,
        retailer_id=payload.retailer_id,
        retailer_name=retailer.name,
        shop_id=shop.id,
        shop_name=shop.name,
        organization_name=org_name,
        total_amount=prepared.total_amount,
        amount_paid_total=prepared.total_paid,
        balance_due=prepared.balance_due,
        status=sale_status,
        created_at=now,
        created_by_user_id=user.id,
        items=[_line_to_read(line) for line in prepared.lines],
        payments=[
            RetailerPaymentRead(
                id=preview_payment_id,
                cash_amount=prepared.cash_amount,
                upi_amount=prepared.upi_amount,
                total_paid=prepared.total_paid,
                paid_at=now,
                recorded_by_user_id=user.id,
            )
        ],
        receipts=[preview_receipt],
        receipt=preview_receipt,
        checkout_token=_encode_checkout_token(token_payload),
    )
    return preview


async def create_retailer_sale(
    db: AsyncSession,
    shop: Shop,
    user: User,
    payload: RetailerSaleCheckoutCommitRequest,
) -> RetailerSaleRead:
    prepared = await _prepare_retailer_checkout(db, shop, payload)
    if prepared.total_paid <= 0:
        raise HTTPException(status_code=422, detail="At least some payment is required")

    token_payload = _decode_checkout_token(payload.checkout_token)
    if (
        token_payload.get("shop_id") != str(shop.id)
        or token_payload.get("retailer_id") != str(payload.retailer_id)
        or token_payload.get("payload_hash") != _payload_fingerprint(payload)
    ):
        raise HTTPException(status_code=409, detail="Checkout token does not match this receipt")

    sale_no = token_payload.get("sale_no")
    month_str = token_payload.get("month_year")
    sequence = token_payload.get("sequence")
    created_at_raw = token_payload.get("created_at")
    if (
        not isinstance(sale_no, str)
        or not isinstance(month_str, str)
        or not isinstance(sequence, int)
        or not isinstance(created_at_raw, str)
    ):
        raise HTTPException(status_code=422, detail="Invalid checkout token")

    try:
        created_at = datetime.fromisoformat(created_at_raw)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid checkout token")

    await _sync_printed_sale_sequence(db, month_str, sequence)
    sale_status = _sale_status(prepared.total_amount, prepared.total_paid)
    sale = RetailerSale(
        sale_no=sale_no,
        retailer_id=payload.retailer_id,
        shop_id=shop.id,
        total_amount=prepared.total_amount,
        amount_paid_total=prepared.total_paid,
        balance_due=prepared.balance_due,
        status=sale_status,
        created_by_user_id=user.id,
        created_at=created_at,
        items=[
            RetailerSaleItem(
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
    db.add(sale)
    try:
        await db.flush()
        payment = RetailerPayment(
            retailer_sale_id=sale.id,
            cash_amount=prepared.cash_amount,
            upi_amount=prepared.upi_amount,
            total_paid=prepared.total_paid,
            recorded_by_user_id=user.id,
        )
        db.add(payment)
        await db.flush()
        printed_at = datetime.now(UTC)
        receipt = RetailerSaleReceipt(
            retailer_sale_id=sale.id,
            retailer_payment_id=payment.id,
            receipt_type=RetailerReceiptType.SALE_INVOICE,
            receipt_number=invoice_receipt_number(sale.sale_no),
            printed_at=printed_at,
        )
        db.add(receipt)
        db.add(
            AuditLog(
                user_id=user.id,
                organization_id=shop.organization_id,
                shop_id=shop.id,
                action="retailer_sale.created",
                entity_type="retailer_sale",
                entity_id=sale.id,
                details={
                    "sale_no": sale.sale_no,
                    "retailer_id": str(sale.retailer_id),
                    "total_amount": str(sale.total_amount),
                    "balance_due": str(sale.balance_due),
                },
            )
        )
        await db.flush()
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Sale number was already saved. Please print a new receipt.",
        )

    logger.info(
        {
            "event": "retailer_sale_created",
            "sale_id": str(sale.id),
            "shop_id": str(shop.id),
            "retailer_id": str(sale.retailer_id),
            "total": str(sale.total_amount),
            "balance_due": str(sale.balance_due),
        }
    )

    await db.refresh(sale, attribute_names=["items", "payments", "receipts", "retailer", "shop"])
    return await _sale_to_read(db, sale)


async def record_retailer_payment(
    db: AsyncSession,
    shop: Shop | None,
    user: User,
    sale_id: UUID,
    payload: RetailerPaymentCreate,
    *,
    admin_override: bool = False,
) -> RetailerPaymentRecordResponse:
    sale = await db.scalar(
        select(RetailerSale).options(*_sale_load_options()).where(RetailerSale.id == sale_id)
    )
    if sale is None:
        raise HTTPException(status_code=404, detail="Sale not found")
    if not admin_override and shop is not None and sale.shop_id != shop.id:
        raise HTTPException(status_code=404, detail="Sale not found")
    if sale.status == RetailerSaleStatus.SETTLED:
        raise HTTPException(status_code=409, detail="Sale is already settled")
    if sale.status == RetailerSaleStatus.VOID:
        raise HTTPException(status_code=409, detail="Sale is void")

    cash_amount = _round_money(payload.payment.cash_amount)
    upi_amount = _round_money(payload.payment.upi_amount)
    total_paid = _round_money(cash_amount + upi_amount)
    if total_paid <= 0:
        raise HTTPException(status_code=422, detail="Payment amount must be greater than zero")
    if total_paid > sale.balance_due:
        raise HTTPException(
            status_code=422,
            detail=f"Payment exceeds balance due ({sale.balance_due})",
        )

    payment = RetailerPayment(
        retailer_sale_id=sale.id,
        cash_amount=cash_amount,
        upi_amount=upi_amount,
        total_paid=total_paid,
        recorded_by_user_id=user.id,
    )
    db.add(payment)
    sale.amount_paid_total = _round_money(sale.amount_paid_total + total_paid)
    sale.balance_due = _round_money(sale.total_amount - sale.amount_paid_total)
    sale.status = _sale_status(sale.total_amount, sale.amount_paid_total)

    shop_id = shop.id if shop is not None else sale.shop_id
    shop_row = shop or await db.get(Shop, sale.shop_id)
    db.add(
        AuditLog(
            user_id=user.id,
            organization_id=shop_row.organization_id if shop_row else None,
            shop_id=shop_id,
            action="retailer_payment.recorded",
            entity_type="retailer_sale",
            entity_id=sale.id,
            details={
                "amount": str(total_paid),
                "balance_after": str(sale.balance_due),
            },
        )
    )
    try:
        await db.flush()
        printed_at = datetime.now(UTC)
        payment_receipt = RetailerSaleReceipt(
            retailer_sale_id=sale.id,
            retailer_payment_id=payment.id,
            receipt_type=RetailerReceiptType.BALANCE_PAYMENT,
            receipt_number=balance_receipt_number(sale.sale_no, printed_at, payment_id=payment.id),
            printed_at=printed_at,
        )
        db.add(payment_receipt)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Receipt number was already saved. Please try again.",
        )

    await db.refresh(
        sale,
        attribute_names=[
            "items",
            "payments",
            "receipts",
            "retailer",
            "shop",
            "amount_paid_total",
            "balance_due",
            "status",
        ],
    )

    logger.info(
        {
            "event": "retailer_payment_recorded",
            "sale_id": str(sale.id),
            "amount": str(total_paid),
            "balance_after": str(sale.balance_due),
            "actor_role": user.role.value,
        }
    )
    sale_read = await _sale_to_read(db, sale)
    payment_receipt_read = next(
        (receipt for receipt in sale_read.receipts if receipt.retailer_payment_id == payment.id),
        None,
    )
    if payment_receipt_read is None:
        raise HTTPException(status_code=500, detail="Payment receipt was not created")
    return RetailerPaymentRecordResponse(sale=sale_read, payment_receipt=payment_receipt_read)


async def get_retailer_sale(
    db: AsyncSession,
    sale_id: UUID,
    *,
    shop_id: UUID | None = None,
) -> RetailerSaleRead:
    sale = await db.scalar(
        select(RetailerSale).options(*_sale_load_options()).where(RetailerSale.id == sale_id)
    )
    if sale is None or (shop_id is not None and sale.shop_id != shop_id):
        raise HTTPException(status_code=404, detail="Sale not found")
    return await _sale_to_read(db, sale)


async def list_retailer_sales(
    db: AsyncSession,
    *,
    shop_id: UUID | None = None,
    retailer_id: UUID | None = None,
    status_filter: RetailerSaleStatus | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    page: int = 1,
    page_size: int = 20,
) -> RetailerSalePage:
    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)
    filters = []
    if shop_id is not None:
        filters.append(RetailerSale.shop_id == shop_id)
    if retailer_id is not None:
        filters.append(RetailerSale.retailer_id == retailer_id)
    if status_filter is not None:
        filters.append(RetailerSale.status == status_filter)
    if start_date is not None:
        filters.append(func.date(RetailerSale.created_at) >= start_date)
    if end_date is not None:
        filters.append(func.date(RetailerSale.created_at) <= end_date)

    count_query = select(func.count()).select_from(RetailerSale)
    if filters:
        count_query = count_query.where(*filters)
    total = int(await db.scalar(count_query) or 0)

    query = (
        select(RetailerSale)
        .options(*_sale_load_options())
        .order_by(RetailerSale.created_at.desc(), RetailerSale.id.desc())
    )
    if filters:
        query = query.where(*filters)
    query = query.offset((page - 1) * page_size).limit(page_size)
    sales = (await db.scalars(query)).all()
    items = [await _sale_to_read(db, sale) for sale in sales]
    return RetailerSalePage(items=items, total=total, page=page, page_size=page_size)


async def list_retailer_sale_receipts(
    db: AsyncSession,
    sale_id: UUID,
    *,
    shop_id: UUID | None = None,
    page: int = 1,
    page_size: int = 20,
) -> RetailerSaleReceiptPage:
    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)
    sale = await db.scalar(
        select(RetailerSale)
        .options(selectinload(RetailerSale.payments), selectinload(RetailerSale.receipts))
        .where(RetailerSale.id == sale_id)
    )
    if sale is None or (shop_id is not None and sale.shop_id != shop_id):
        raise HTTPException(status_code=404, detail="Sale not found")

    payment_totals = {payment.id: payment.total_paid for payment in sale.payments}
    receipts = sorted(sale.receipts, key=_receipt_sort_key)
    total = len(receipts)
    start = (page - 1) * page_size
    page_items = receipts[start : start + page_size]
    return RetailerSaleReceiptPage(
        items=[_receipt_to_read(receipt, payment_totals=payment_totals) for receipt in page_items],
        total=total,
        page=page,
        page_size=page_size,
    )


async def get_retailer_sale_receipt(
    db: AsyncSession,
    sale_id: UUID,
    receipt_id: UUID,
    *,
    shop_id: UUID | None = None,
) -> RetailerSaleReceiptRead:
    sale = await db.scalar(
        select(RetailerSale)
        .options(selectinload(RetailerSale.payments), selectinload(RetailerSale.receipts))
        .where(RetailerSale.id == sale_id)
    )
    if sale is None or (shop_id is not None and sale.shop_id != shop_id):
        raise HTTPException(status_code=404, detail="Sale not found")
    payment_totals = {payment.id: payment.total_paid for payment in sale.payments}
    for receipt in sale.receipts:
        if receipt.id == receipt_id:
            return _receipt_to_read(receipt, payment_totals=payment_totals)
    raise HTTPException(status_code=404, detail="Receipt not found")
