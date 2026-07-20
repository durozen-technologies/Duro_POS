"""Retailer sale checkout, payments, and sale reads."""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import logging
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
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
from app.models import (
    AuditLog,
    Item,
    MonthlyRetailerSaleSequence,
    Retailer,
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
from app.models.enums import BaseUnit
from app.schemas.retailers import (
    RetailerBulkSettleCreate,
    RetailerBulkSettleRead,
    RetailerBulkSettleSaleLine,
    RetailerCatalogItemRead,
    RetailerPaymentCreate,
    RetailerPaymentRead,
    RetailerPaymentRecordResponse,
    RetailerSaleCheckoutCommitRequest,
    RetailerSaleCheckoutRequest,
    RetailerSaleEditRequest,
    RetailerSaleLineRead,
    RetailerSalePage,
    RetailerSalePreviewRead,
    RetailerSaleRead,
    RetailerSaleReceiptPage,
    RetailerSaleReceiptRead,
)
from app.services.global_image_templates import (
    build_image_paths_for_row,
    load_templates_for_item_rows,
)
from app.services.retailer_receipt_number import balance_receipt_number, invoice_receipt_number
from app.services.retailer_sale_number import retailer_sale_no_from_sequence
from app.services.retailers import (
    is_retailer_allocated_to_shop,
    retailer_item_prices_as_of_subquery,
)
from app.services.tenant_query import resolve_organization_display_name

logger = logging.getLogger(__name__)

TWOPLACES = Decimal("0.01")
CHECKOUT_TOKEN_MAX_AGE_SECONDS = 15 * 60
ADMIN_SALE_MODIFICATION_WINDOW = timedelta(hours=24)


def _resolved_party_name(stored: str | None, live_name: str | None) -> str:
    if stored:
        return stored
    return live_name or ""


def _retailer_shop_snapshot_name(retailer: Retailer) -> str:
    if retailer.shop_name is None:
        return ""
    return retailer.shop_name.strip()


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
    wallet_amount: Decimal
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
        "include_opening_balance": payload.include_opening_balance,
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
            "wallet_amount": _decimal_token(_round_money(payload.payment.wallet_amount)),
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
    return await resolve_organization_display_name(db, shop.organization_id)


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


async def _debit_retailer_wallet(
    db: AsyncSession,
    retailer_id: UUID,
    wallet_amount: Decimal,
) -> None:
    if wallet_amount <= 0:
        return
    retailer = await db.scalar(select(Retailer).where(Retailer.id == retailer_id).with_for_update())
    if retailer is None:
        raise HTTPException(status_code=404, detail="Retailer not found")
    if wallet_amount > retailer.credit_balance:
        raise HTTPException(
            status_code=422,
            detail=f"Wallet amount exceeds available credit ({retailer.credit_balance})",
        )
    retailer.credit_balance = _round_money(retailer.credit_balance - wallet_amount)


async def _credit_retailer_wallet(
    db: AsyncSession,
    retailer_id: UUID,
    wallet_amount: Decimal,
) -> None:
    if wallet_amount <= 0:
        return
    retailer = await db.scalar(select(Retailer).where(Retailer.id == retailer_id).with_for_update())
    if retailer is None:
        raise HTTPException(status_code=404, detail="Retailer not found")
    retailer.credit_balance = _round_money(retailer.credit_balance + wallet_amount)


async def apply_purchase_wallet_settlement_to_sale(
    db: AsyncSession,
    shop: Shop,
    user: User,
    sale: RetailerSale,
    wallet_amount: Decimal,
    purchase_id: UUID,
) -> None:
    wallet_amount = _round_money(wallet_amount)
    if wallet_amount <= 0:
        return
    if wallet_amount > sale.balance_due:
        raise HTTPException(
            status_code=422,
            detail=f"Settlement exceeds balance due ({sale.balance_due})",
        )

    opening_balance = await _retailer_opening_balance_excluding_sale(
        db, sale.retailer_id, exclude_sale_id=sale.id
    )
    await _debit_retailer_wallet(db, sale.retailer_id, wallet_amount)
    payment = RetailerPayment(
        retailer_sale_id=sale.id,
        cash_amount=Decimal("0.00"),
        upi_amount=Decimal("0.00"),
        wallet_amount=wallet_amount,
        total_paid=wallet_amount,
        recorded_by_user_id=user.id,
        retailer_inventory_purchase_id=purchase_id,
    )
    db.add(payment)
    sale.amount_paid_total = _round_money(sale.amount_paid_total + wallet_amount)
    sale.balance_due = _round_money(sale.total_amount - sale.amount_paid_total)
    sale.status = _sale_status(sale.total_amount, sale.amount_paid_total)
    await db.flush()
    printed_at = datetime.now(UTC)
    db.add(
        RetailerSaleReceipt(
            retailer_sale_id=sale.id,
            retailer_payment_id=payment.id,
            receipt_type=RetailerReceiptType.BALANCE_PAYMENT,
            receipt_number=balance_receipt_number(sale.sale_no, printed_at, payment_id=payment.id),
            printed_at=printed_at,
            opening_balance=opening_balance,
        )
    )


async def settle_purchase_against_open_sales(
    db: AsyncSession,
    shop: Shop,
    user: User,
    *,
    retailer_id: UUID,
    purchase_id: UUID,
    settlement_pool: Decimal,
) -> Decimal:
    applied = Decimal("0.00")
    remaining = _round_money(settlement_pool)
    while remaining > 0:
        sale = await db.scalar(
            select(RetailerSale)
            .where(
                RetailerSale.retailer_id == retailer_id,
                RetailerSale.shop_id == shop.id,
                RetailerSale.status.in_([RetailerSaleStatus.OPEN, RetailerSaleStatus.PARTIAL]),
                RetailerSale.balance_due > 0,
            )
            .order_by(RetailerSale.created_at.asc(), RetailerSale.id.asc())
            .with_for_update()
        )
        if sale is None:
            break
        pay_amount = _round_money(min(remaining, sale.balance_due))
        if pay_amount <= 0:
            break
        await apply_purchase_wallet_settlement_to_sale(
            db, shop, user, sale, pay_amount, purchase_id
        )
        applied = _round_money(applied + pay_amount)
        remaining = _round_money(remaining - pay_amount)
    return applied


async def reverse_purchase_settlement_payments(
    db: AsyncSession,
    retailer_id: UUID,
    purchase_id: UUID,
) -> None:
    payments = (
        await db.scalars(
            select(RetailerPayment)
            .where(RetailerPayment.retailer_inventory_purchase_id == purchase_id)
            .options(
                selectinload(RetailerPayment.sale),
                selectinload(RetailerPayment.receipt),
            )
            .order_by(RetailerPayment.paid_at.desc(), RetailerPayment.id.desc())
        )
    ).all()
    for payment in payments:
        sale = payment.sale
        if sale is None:
            continue
        sale.amount_paid_total = _round_money(sale.amount_paid_total - payment.total_paid)
        sale.balance_due = _round_money(sale.total_amount - sale.amount_paid_total)
        sale.status = _sale_status(sale.total_amount, sale.amount_paid_total)
        await _credit_retailer_wallet(db, retailer_id, payment.wallet_amount)
        if payment.receipt is not None:
            await db.delete(payment.receipt)
        await db.delete(payment)


def _take_cash_upi(
    amount: Decimal,
    cash_left: Decimal,
    upi_left: Decimal,
) -> tuple[Decimal, Decimal, Decimal, Decimal]:
    """Allocate amount from cash-first then UPI. Returns used cash, used upi, remaining pools."""
    amount = _round_money(amount)
    cash_used = _round_money(min(amount, cash_left))
    remaining = _round_money(amount - cash_used)
    upi_used = _round_money(min(remaining, upi_left))
    return (
        cash_used,
        upi_used,
        _round_money(cash_left - cash_used),
        _round_money(upi_left - upi_used),
    )


async def _apply_cash_upi_settlement_to_sale(
    db: AsyncSession,
    user: User,
    sale: RetailerSale,
    cash_amount: Decimal,
    upi_amount: Decimal,
) -> RetailerPayment:
    cash_amount = _round_money(cash_amount)
    upi_amount = _round_money(upi_amount)
    total_paid = _round_money(cash_amount + upi_amount)
    if total_paid <= 0:
        raise HTTPException(status_code=422, detail="Payment amount must be greater than zero")
    if total_paid > sale.balance_due:
        raise HTTPException(
            status_code=422,
            detail=f"Payment exceeds balance due ({sale.balance_due})",
        )

    opening_balance = await _retailer_opening_balance_excluding_sale(
        db, sale.retailer_id, exclude_sale_id=sale.id
    )
    payment = RetailerPayment(
        retailer_sale_id=sale.id,
        cash_amount=cash_amount,
        upi_amount=upi_amount,
        wallet_amount=Decimal("0.00"),
        total_paid=total_paid,
        recorded_by_user_id=user.id,
    )
    db.add(payment)
    sale.amount_paid_total = _round_money(sale.amount_paid_total + total_paid)
    sale.balance_due = _round_money(sale.total_amount - sale.amount_paid_total)
    sale.status = _sale_status(sale.total_amount, sale.amount_paid_total)
    await db.flush()
    printed_at = datetime.now(UTC)
    db.add(
        RetailerSaleReceipt(
            retailer_sale_id=sale.id,
            retailer_payment_id=payment.id,
            receipt_type=RetailerReceiptType.BALANCE_PAYMENT,
            receipt_number=balance_receipt_number(sale.sale_no, printed_at, payment_id=payment.id),
            printed_at=printed_at,
            opening_balance=opening_balance,
        )
    )
    return payment


async def settle_retailer_outstanding_payment(
    db: AsyncSession,
    user: User,
    retailer_id: UUID,
    payload: RetailerBulkSettleCreate,
    *,
    shop: Shop | None = None,
    admin_override: bool = False,
) -> RetailerBulkSettleRead:
    """FIFO settle: opening balance first, then oldest open/partial sales. Cash then UPI."""
    del admin_override  # presence of shop already distinguishes shop vs admin scope
    cash_amount = _round_money(payload.cash_amount)
    upi_amount = _round_money(payload.upi_amount)
    total_paid = _round_money(cash_amount + upi_amount)
    if cash_amount < 0 or upi_amount < 0:
        raise HTTPException(status_code=422, detail="Payment amounts cannot be negative")
    if total_paid <= 0:
        raise HTTPException(status_code=422, detail="Payment amount must be greater than zero")

    retailer = await _get_active_retailer(db, retailer_id, shop=shop)
    retailer = await db.scalar(select(Retailer).where(Retailer.id == retailer_id).with_for_update())
    if retailer is None or not retailer.is_active:
        raise HTTPException(status_code=404, detail="Retailer not found")

    sale_filters = [
        RetailerSale.retailer_id == retailer_id,
        RetailerSale.status.in_([RetailerSaleStatus.OPEN, RetailerSaleStatus.PARTIAL]),
        RetailerSale.balance_due > 0,
    ]
    if shop is not None:
        sale_filters.append(RetailerSale.shop_id == shop.id)

    pending_sales = (
        await db.scalars(
            select(RetailerSale)
            .where(*sale_filters)
            .order_by(RetailerSale.created_at.asc(), RetailerSale.id.asc())
            .with_for_update()
        )
    ).all()

    bills_outstanding_before = _round_money(
        sum((sale.balance_due for sale in pending_sales), Decimal("0.00"))
    )
    opening_before = _round_money(retailer.opening_balance)
    outstanding_before = _round_money(opening_before + bills_outstanding_before)
    if total_paid > outstanding_before:
        raise HTTPException(
            status_code=422,
            detail=f"Payment exceeds outstanding balance ({outstanding_before})",
        )

    cash_left = cash_amount
    upi_left = upi_amount

    applied_opening = _round_money(min(total_paid, opening_before))
    opening_cash = Decimal("0.00")
    opening_upi = Decimal("0.00")
    if applied_opening > 0:
        opening_cash, opening_upi, cash_left, upi_left = _take_cash_upi(
            applied_opening, cash_left, upi_left
        )
        retailer.opening_balance = _round_money(opening_before - applied_opening)

    sale_lines: list[RetailerBulkSettleSaleLine] = []
    applied_to_bills = Decimal("0.00")
    remaining_pool = _round_money(cash_left + upi_left)

    for sale in pending_sales:
        if remaining_pool <= 0:
            break
        pay_amount = _round_money(min(remaining_pool, sale.balance_due))
        if pay_amount <= 0:
            continue
        cash_used, upi_used, cash_left, upi_left = _take_cash_upi(pay_amount, cash_left, upi_left)
        payment = await _apply_cash_upi_settlement_to_sale(db, user, sale, cash_used, upi_used)
        applied_to_bills = _round_money(applied_to_bills + pay_amount)
        remaining_pool = _round_money(cash_left + upi_left)
        sale_lines.append(
            RetailerBulkSettleSaleLine(
                sale_id=sale.id,
                sale_no=sale.sale_no,
                shop_id=sale.shop_id,
                payment_id=payment.id,
                cash_amount=cash_used,
                upi_amount=upi_used,
                amount_applied=pay_amount,
                balance_due_after=sale.balance_due,
                status=sale.status,
            )
        )

    opening_after = _round_money(retailer.opening_balance)
    bills_after = _round_money(sum((sale.balance_due for sale in pending_sales), Decimal("0.00")))
    outstanding_after = _round_money(opening_after + bills_after)

    shop_id = shop.id if shop is not None else None
    organization_id = shop.organization_id if shop is not None else None
    if shop is None and sale_lines:
        first_shop = await db.get(Shop, sale_lines[0].shop_id)
        if first_shop is not None:
            shop_id = first_shop.id
            organization_id = first_shop.organization_id

    db.add(
        AuditLog(
            user_id=user.id,
            organization_id=organization_id,
            shop_id=shop_id,
            action="retailer_payment.bulk_settled",
            entity_type="retailer",
            entity_id=retailer.id,
            details={
                "cash_amount": str(cash_amount),
                "upi_amount": str(upi_amount),
                "total_paid": str(total_paid),
                "applied_to_opening": str(applied_opening),
                "opening_cash_amount": str(opening_cash),
                "opening_upi_amount": str(opening_upi),
                "applied_to_bills": str(applied_to_bills),
                "outstanding_before": str(outstanding_before),
                "outstanding_after": str(outstanding_after),
                "sale_ids": [str(line.sale_id) for line in sale_lines],
            },
        )
    )
    await db.commit()

    logger.info(
        {
            "event": "retailer_bulk_settle",
            "retailer_id": str(retailer.id),
            "total_paid": str(total_paid),
            "applied_to_opening": str(applied_opening),
            "applied_to_bills": str(applied_to_bills),
            "outstanding_after": str(outstanding_after),
            "actor_role": user.role.value,
        }
    )

    return RetailerBulkSettleRead(
        retailer_id=retailer.id,
        retailer_name=retailer.name,
        cash_amount=cash_amount,
        upi_amount=upi_amount,
        total_paid=total_paid,
        applied_to_opening=applied_opening,
        opening_cash_amount=opening_cash,
        opening_upi_amount=opening_upi,
        applied_to_bills=applied_to_bills,
        opening_balance_before=opening_before,
        opening_balance_after=opening_after,
        bills_outstanding_before=bills_outstanding_before,
        bills_outstanding_after=bills_after,
        outstanding_before=outstanding_before,
        outstanding_after=outstanding_after,
        sales=sale_lines,
    )


async def _prepare_retailer_checkout(
    db: AsyncSession,
    shop: Shop,
    payload: RetailerSaleCheckoutRequest,
    *,
    max_payable: Decimal | None = None,
) -> PreparedRetailerCheckout:
    await _get_active_retailer(db, payload.retailer_id, shop=shop)
    item_ids = [line.item_id for line in payload.items]

    price_as_of = retailer_item_prices_as_of_subquery(
        payload.retailer_id, shop.id, func.current_date()
    )
    price_rows = (
        await db.execute(
            select(
                price_as_of.c.item_id,
                price_as_of.c.price_per_unit,
                Item.name,
                Item.tamil_name,
                Item.unit_type,
                Item.base_unit,
                ShopItemAllocation.display_name,
                ShopItemAllocation.tamil_name.label("allocation_tamil_name"),
            )
            .join(Item, Item.id == price_as_of.c.item_id)
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
                price_as_of.c.item_id.in_(item_ids),
                price_as_of.c.rn == 1,
                price_as_of.c.is_active.is_(True),
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
    wallet_amount = _round_money(payload.payment.wallet_amount)
    total_paid = _round_money(cash_amount + upi_amount + wallet_amount)
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
        wallet_amount=wallet_amount,
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
        opening_balance=receipt.opening_balance,
    )


async def _retailer_opening_balance_excluding_sale(
    db: AsyncSession,
    retailer_id: UUID,
    *,
    exclude_sale_id: UUID | None = None,
    include_stored_opening: bool = True,
) -> Decimal:
    retailer = await db.get(Retailer, retailer_id)
    stored_opening = (
        retailer.opening_balance
        if retailer is not None and include_stored_opening
        else Decimal("0.00")
    )
    query = select(func.coalesce(func.sum(RetailerSale.balance_due), Decimal("0.00"))).where(
        RetailerSale.retailer_id == retailer_id,
        RetailerSale.status.in_([RetailerSaleStatus.OPEN, RetailerSaleStatus.PARTIAL]),
    )
    if exclude_sale_id is not None:
        query = query.where(RetailerSale.id != exclude_sale_id)
    sales_opening = await db.scalar(query)
    return _round_money(stored_opening + (sales_opening or Decimal("0.00")))


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
        retailer_name=_resolved_party_name(sale.retailer_name, retailer.name if retailer else None),
        shop_id=sale.shop_id,
        shop_name=_resolved_party_name(
            sale.shop_name,
            _retailer_shop_snapshot_name(retailer) if retailer else None,
        ),
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
    price_as_of = retailer_item_prices_as_of_subquery(retailer_id, shop.id, func.current_date())
    rows = (
        await db.execute(
            select(
                Item.id,
                price_as_of.c.price_per_unit,
                Item.name,
                Item.tamil_name,
                Item.unit_type,
                Item.base_unit,
                Item.image_object_key,
                Item.image_content_type,
                Item.image_thumbnail_object_key,
                Item.image_thumbnail_content_type,
                Item.global_image_template_id,
                ShopItemAllocation.display_name,
            )
            .join(Item, Item.id == price_as_of.c.item_id)
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
                price_as_of.c.rn == 1,
                price_as_of.c.is_active.is_(True),
                Item.is_active.is_(True),
            )
            .order_by(Item.sort_order.asc(), Item.name.asc())
        )
    ).all()
    templates_by_id = await load_templates_for_item_rows(list(rows))
    return [
        RetailerCatalogItemRead(
            item_id=row.id,
            item_name=(row.display_name or row.name).strip(),
            item_tamil_name=row.tamil_name,
            item_unit_type=row.unit_type,
            item_base_unit=row.base_unit,
            price_per_unit=row.price_per_unit,
            image_path=build_image_paths_for_row(row, templates_by_id)[0],
            image_thumb_path=build_image_paths_for_row(row, templates_by_id)[1],
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
    opening_balance = await _retailer_opening_balance_excluding_sale(
        db,
        payload.retailer_id,
        include_stored_opening=payload.include_opening_balance,
    )
    preview_payment_id = uuid7()
    preview_receipt = RetailerSaleReceiptRead(
        id=uuid7(),
        receipt_number=invoice_receipt_number(sale_no),
        receipt_type=RetailerReceiptType.SALE_INVOICE,
        retailer_payment_id=preview_payment_id,
        printed_at=now,
        payment_total=prepared.total_paid,
        opening_balance=opening_balance,
    )
    preview = RetailerSalePreviewRead(
        id=uuid7(),
        sale_no=sale_no,
        retailer_id=payload.retailer_id,
        retailer_name=retailer.name,
        shop_id=shop.id,
        shop_name=_retailer_shop_snapshot_name(retailer),
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
                wallet_amount=prepared.wallet_amount,
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
    retailer = await _get_active_retailer(db, payload.retailer_id, shop=shop)
    sale = RetailerSale(
        sale_no=sale_no,
        retailer_id=payload.retailer_id,
        shop_id=shop.id,
        retailer_name=retailer.name,
        shop_name=_retailer_shop_snapshot_name(retailer),
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
        await _debit_retailer_wallet(db, payload.retailer_id, prepared.wallet_amount)
        payment = RetailerPayment(
            retailer_sale_id=sale.id,
            cash_amount=prepared.cash_amount,
            upi_amount=prepared.upi_amount,
            wallet_amount=prepared.wallet_amount,
            total_paid=prepared.total_paid,
            recorded_by_user_id=user.id,
        )
        db.add(payment)
        await db.flush()
        opening_balance = await _retailer_opening_balance_excluding_sale(
            db,
            sale.retailer_id,
            exclude_sale_id=sale.id,
            include_stored_opening=payload.include_opening_balance,
        )
        printed_at = datetime.now(UTC)
        receipt = RetailerSaleReceipt(
            retailer_sale_id=sale.id,
            retailer_payment_id=payment.id,
            receipt_type=RetailerReceiptType.SALE_INVOICE,
            receipt_number=invoice_receipt_number(sale.sale_no),
            printed_at=printed_at,
            opening_balance=opening_balance,
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
    if sale.status == RetailerSaleStatus.CANCELLED:
        raise HTTPException(status_code=409, detail="Sale is cancelled")

    cash_amount = _round_money(payload.payment.cash_amount)
    upi_amount = _round_money(payload.payment.upi_amount)
    wallet_amount = _round_money(payload.payment.wallet_amount)
    total_paid = _round_money(cash_amount + upi_amount + wallet_amount)
    if total_paid <= 0:
        raise HTTPException(status_code=422, detail="Payment amount must be greater than zero")
    if total_paid > sale.balance_due:
        raise HTTPException(
            status_code=422,
            detail=f"Payment exceeds balance due ({sale.balance_due})",
        )

    opening_balance = await _retailer_opening_balance_excluding_sale(
        db, sale.retailer_id, exclude_sale_id=sale.id
    )

    await _debit_retailer_wallet(db, sale.retailer_id, wallet_amount)
    payment = RetailerPayment(
        retailer_sale_id=sale.id,
        cash_amount=cash_amount,
        upi_amount=upi_amount,
        wallet_amount=wallet_amount,
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
            opening_balance=opening_balance,
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


def _sale_created_at_utc(created_at: datetime) -> datetime:
    if created_at.tzinfo is None:
        return created_at.replace(tzinfo=UTC)
    return created_at.astimezone(UTC)


def _assert_sale_within_admin_modification_window(sale: RetailerSale) -> None:
    age = datetime.now(UTC) - _sale_created_at_utc(sale.created_at)
    if age >= ADMIN_SALE_MODIFICATION_WINDOW:
        raise HTTPException(
            status_code=409,
            detail="Bill can only be modified within 24 hours of creation",
        )


def _assert_sale_admin_modifiable(sale: RetailerSale) -> None:
    if sale.status == RetailerSaleStatus.CANCELLED:
        raise HTTPException(status_code=409, detail="Bill is already cancelled")
    if sale.status == RetailerSaleStatus.VOID:
        raise HTTPException(status_code=409, detail="Bill is void")
    _assert_sale_within_admin_modification_window(sale)
    if any(payment.retailer_inventory_purchase_id for payment in sale.payments):
        raise HTTPException(
            status_code=409,
            detail="Bills settled from inventory purchase cannot be modified",
        )


def _prepare_retailer_sale_edit_lines(
    sale: RetailerSale,
    payload: RetailerSaleEditRequest,
) -> list[PreparedRetailerLine]:
    existing_by_item = {line.item_id: line for line in sale.items}
    payload_item_ids = {line.item_id for line in payload.items}
    if set(existing_by_item) != payload_item_ids:
        raise HTTPException(
            status_code=422,
            detail="Edited items must match the original bill items",
        )

    lines: list[PreparedRetailerLine] = []
    total_amount = Decimal("0.00")
    for line_input in payload.items:
        existing = existing_by_item[line_input.item_id]
        item_name = (existing.item_name or "").strip()
        if (
            existing.item_base_unit == BaseUnit.UNIT
            and line_input.quantity != line_input.quantity.to_integral_value()
        ):
            raise HTTPException(
                status_code=422,
                detail=f"{item_name or 'Item'} only accepts integer unit quantities",
            )
        price_per_unit = _round_money(existing.price_per_unit)
        line_total = _round_money(price_per_unit * line_input.quantity)
        total_amount += line_total
        lines.append(
            PreparedRetailerLine(
                item_id=existing.item_id,
                item_name=item_name,
                item_tamil_name=existing.item_tamil_name,
                item_unit_type=existing.item_unit_type,
                item_base_unit=existing.item_base_unit,
                quantity=line_input.quantity,
                unit=existing.unit,
                price_per_unit=price_per_unit,
                line_total=line_total,
            )
        )

    return lines


async def cancel_retailer_sale(
    db: AsyncSession,
    user: User,
    sale_id: UUID,
) -> RetailerSaleRead:
    sale = await db.scalar(
        select(RetailerSale).options(*_sale_load_options()).where(RetailerSale.id == sale_id)
    )
    if sale is None:
        raise HTTPException(status_code=404, detail="Sale not found")
    _assert_sale_admin_modifiable(sale)

    sale.status = RetailerSaleStatus.CANCELLED
    shop = sale.shop or await db.get(Shop, sale.shop_id)
    db.add(
        AuditLog(
            user_id=user.id,
            organization_id=shop.organization_id if shop else None,
            shop_id=sale.shop_id,
            action="retailer_sale.cancelled",
            entity_type="retailer_sale",
            entity_id=sale.id,
            details={"sale_no": sale.sale_no},
        )
    )
    await db.commit()
    await db.refresh(
        sale, attribute_names=["items", "payments", "receipts", "retailer", "shop", "status"]
    )
    return await _sale_to_read(db, sale)


async def edit_retailer_sale(
    db: AsyncSession,
    user: User,
    sale_id: UUID,
    payload: RetailerSaleEditRequest,
) -> RetailerSaleRead:
    sale = await db.scalar(
        select(RetailerSale).options(*_sale_load_options()).where(RetailerSale.id == sale_id)
    )
    if sale is None:
        raise HTTPException(status_code=404, detail="Sale not found")
    _assert_sale_admin_modifiable(sale)

    lines = _prepare_retailer_sale_edit_lines(sale, payload)
    total_amount = _round_money(sum((line.line_total for line in lines), Decimal("0.00")))
    cash_amount = _round_money(payload.payment.cash_amount)
    upi_amount = _round_money(payload.payment.upi_amount)
    wallet_amount = _round_money(payload.payment.wallet_amount)
    total_paid = _round_money(cash_amount + upi_amount + wallet_amount)
    if total_paid <= 0:
        raise HTTPException(status_code=422, detail="At least some payment is required")
    if total_paid > total_amount:
        raise HTTPException(
            status_code=422,
            detail=f"Payment exceeds bill total ({total_amount})",
        )

    invoice_receipt = next(
        (
            receipt
            for receipt in sale.receipts
            if receipt.receipt_type == RetailerReceiptType.SALE_INVOICE
        ),
        None,
    )
    if invoice_receipt is None:
        raise HTTPException(status_code=409, detail="Sale invoice receipt not found")

    for payment in list(sale.payments):
        await _credit_retailer_wallet(db, sale.retailer_id, payment.wallet_amount)

    invoice_payment = next(
        (payment for payment in sale.payments if payment.id == invoice_receipt.retailer_payment_id),
        None,
    )
    if invoice_payment is None:
        raise HTTPException(status_code=409, detail="Sale invoice payment not found")
    for payment in list(sale.payments):
        if payment.id == invoice_payment.id:
            continue
        receipt = payment.receipt
        if receipt is not None:
            await db.delete(receipt)
        await db.delete(payment)

    for item in list(sale.items):
        await db.delete(item)
    await db.flush()

    sale.items = [
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
        for line in lines
    ]

    invoice_payment.cash_amount = cash_amount
    invoice_payment.upi_amount = upi_amount
    invoice_payment.wallet_amount = wallet_amount
    invoice_payment.total_paid = total_paid
    invoice_payment.recorded_by_user_id = user.id
    invoice_payment.paid_at = datetime.now(UTC)

    await _debit_retailer_wallet(db, sale.retailer_id, wallet_amount)

    sale.total_amount = total_amount
    sale.amount_paid_total = total_paid
    sale.balance_due = _round_money(total_amount - total_paid)
    sale.status = _sale_status(total_amount, total_paid)

    shop = sale.shop or await db.get(Shop, sale.shop_id)
    db.add(
        AuditLog(
            user_id=user.id,
            organization_id=shop.organization_id if shop else None,
            shop_id=sale.shop_id,
            action="retailer_sale.edited",
            entity_type="retailer_sale",
            entity_id=sale.id,
            details={
                "sale_no": sale.sale_no,
                "total_amount": str(total_amount),
                "cash_amount": str(cash_amount),
                "upi_amount": str(upi_amount),
                "wallet_amount": str(wallet_amount),
                "balance_due": str(sale.balance_due),
            },
        )
    )
    await db.commit()
    await db.refresh(
        sale,
        attribute_names=[
            "items",
            "payments",
            "receipts",
            "retailer",
            "shop",
            "total_amount",
            "amount_paid_total",
            "balance_due",
            "status",
        ],
    )
    return await _sale_to_read(db, sale)
