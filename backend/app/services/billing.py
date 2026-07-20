import base64
import binascii
import hashlib
import hmac
import json
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.ids import uuid7
from app.core.redis_cache import evict_shop_bills_cache
from app.core.timezone import ist_month_key
from app.db.tenant_context_var import get_active_tenant_schema, set_active_tenant_schema
from app.db.tenant_schema import set_search_path, tenant_router
from app.models import (
    AuditLog,
    Bill,
    BillItem,
    BillStatus,
    CheckoutSnapshot,
    DailyPrice,
    InventoryMovement,
    InventoryMovementType,
    Item,
    MonthlyBillSequence,
    Organization,
    Payment,
    Receipt,
    ReceiptStatus,
    Shop,
    ShopItemAllocation,
    User,
)
from app.models.enums import BaseUnit
from app.schemas.billing import (
    BillCheckoutCommitRequest,
    BillCheckoutPreviewRead,
    BillCheckoutRequest,
    BillCreateResult,
    BillEditRequest,
    BillLineRead,
    BillRead,
    BillReceiptStatusUpdate,
    PaymentRead,
    ReceiptRead,
)
from app.services.admin.catalogue import _bill_to_read
from app.services.bill_number import bill_no_from_sequence, bill_number_prefix_from_settings
from app.services.inventory import _available_quantity_at
from app.services.tenant_query import resolve_organization_display_name

TWOPLACES = Decimal("0.01")
THREEPLACES = Decimal("0.001")
CHECKOUT_TOKEN_MAX_AGE_SECONDS = 24 * 60 * 60
CHECKOUT_SNAPSHOT_TTL = timedelta(hours=24)
ADMIN_BILL_MODIFICATION_WINDOW = timedelta(hours=24)
ACTIVE_BILL_STATUSES = (BillStatus.PAID, BillStatus.PENDING_PAYMENT)


def bill_counts_toward_sales_clause():
    """Exclude cancelled bills from sales/dashboard aggregates."""
    return Bill.status.in_(ACTIVE_BILL_STATUSES)


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
    return await resolve_organization_display_name(db, shop.organization_id)


async def _ensure_shop_tenant_session(db: AsyncSession, shop: Shop) -> None:
    """Re-bind tenant search_path after commits on pooled PostgreSQL connections."""
    from app.db.tenant_schema import is_postgres_session

    if not await is_postgres_session(db):
        return

    schema_name = get_active_tenant_schema()
    if schema_name is None:
        schema_name = await tenant_router.resolve_schema(db, shop.organization_id)
        if schema_name is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Tenant schema is not configured for this shop",
            )
        set_active_tenant_schema(schema_name)
    await set_search_path(db, schema_name)


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
            detail="Checkout token expired. Please preview checkout again.",
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


def _line_to_dict(line: PreparedBillLine) -> dict[str, Any]:
    return {
        "item_id": str(line.item_id),
        "item_name": line.item_name,
        "item_tamil_name": line.item_tamil_name,
        "item_unit_type": line.item_unit_type.value if line.item_unit_type is not None else None,
        "item_base_unit": line.item_base_unit.value if line.item_base_unit is not None else None,
        "quantity": _decimal_token(line.quantity),
        "unit": line.unit.value if line.unit is not None else None,
        "price_per_unit": _decimal_token(line.price_per_unit),
        "line_total": _decimal_token(line.line_total),
        "assumption_percent": (
            _decimal_token(line.assumption_percent) if line.assumption_percent is not None else None
        ),
        "assumption_inventory_item_id": (
            str(line.assumption_inventory_item_id)
            if line.assumption_inventory_item_id is not None
            else None
        ),
        "assumption_inventory_category_id": (
            str(line.assumption_inventory_category_id)
            if line.assumption_inventory_category_id is not None
            else None
        ),
    }


def _snapshot_from_prepared(prepared: PreparedCheckout, payload_hash: str) -> dict[str, Any]:
    return {
        "payload_hash": payload_hash,
        "total_amount": _decimal_token(prepared.total_amount),
        "cash_amount": _decimal_token(prepared.cash_amount),
        "upi_amount": _decimal_token(prepared.upi_amount),
        "total_paid": _decimal_token(prepared.total_paid),
        "lines": [_line_to_dict(line) for line in prepared.lines],
    }


def _prepared_from_snapshot(snapshot_json: dict[str, Any]) -> PreparedCheckout:
    from app.models.enums import BaseUnit, UnitType

    lines: list[PreparedBillLine] = []
    for raw in snapshot_json.get("lines", []):
        assumption_percent = raw.get("assumption_percent")
        lines.append(
            PreparedBillLine(
                item_id=UUID(raw["item_id"]),
                item_name=raw["item_name"],
                item_tamil_name=raw.get("item_tamil_name"),
                item_unit_type=UnitType(raw["item_unit_type"]) if raw.get("item_unit_type") else None,
                item_base_unit=BaseUnit(raw["item_base_unit"]) if raw.get("item_base_unit") else None,
                quantity=Decimal(raw["quantity"]),
                unit=BaseUnit(raw["unit"]),
                price_per_unit=Decimal(raw["price_per_unit"]),
                line_total=Decimal(raw["line_total"]),
                assumption_percent=Decimal(assumption_percent) if assumption_percent else None,
                assumption_inventory_item_id=(
                    UUID(raw["assumption_inventory_item_id"])
                    if raw.get("assumption_inventory_item_id")
                    else None
                ),
                assumption_inventory_category_id=(
                    UUID(raw["assumption_inventory_category_id"])
                    if raw.get("assumption_inventory_category_id")
                    else None
                ),
            )
        )
    return PreparedCheckout(
        lines=lines,
        total_amount=Decimal(snapshot_json["total_amount"]),
        cash_amount=Decimal(snapshot_json["cash_amount"]),
        upi_amount=Decimal(snapshot_json["upi_amount"]),
        total_paid=Decimal(snapshot_json["total_paid"]),
    )


async def _org_bill_number_prefix(db: AsyncSession, shop: Shop) -> str:
    org = await db.get(Organization, shop.organization_id)
    return bill_number_prefix_from_settings(org.settings if org is not None else None)


async def _allocate_bill_number(db: AsyncSession, shop: Shop, now: datetime) -> str:
    month_str = ist_month_key(now)
    sequence_row = await db.get(MonthlyBillSequence, month_str, with_for_update=True)
    if sequence_row is None:
        sequence = 1
        db.add(MonthlyBillSequence(month_year=month_str, current_value=sequence))
    else:
        sequence = sequence_row.current_value + 1
        sequence_row.current_value = sequence
    prefix = await _org_bill_number_prefix(db, shop)
    try:
        return bill_no_from_sequence(now, sequence, prefix)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Monthly bill sequence limit reached for this bill format",
        ) from None


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
    shop: Shop, line: PreparedBillLine, *, occurred_at: datetime
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
        occurred_at=occurred_at,
    )


async def _validate_assumption_stock(
    db: AsyncSession,
    shop: Shop,
    lines: list[PreparedBillLine],
    *,
    occurred_at: datetime,
) -> None:
    required: dict[tuple[UUID, UUID | None], Decimal] = {}
    for line in lines:
        movement = _inventory_movement_for_assumption(shop, line, occurred_at=occurred_at)
        if movement is None:
            continue
        key = (movement.inventory_item_id, movement.category_id)
        required[key] = required.get(key, Decimal("0")) + movement.quantity

    for (inventory_item_id, _), quantity in required.items():
        available = await _available_quantity_at(
            db, shop.id, inventory_item_id, as_of=occurred_at
        )
        if quantity > available:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Insufficient inventory for billed item assumptions",
            )


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


async def _load_snapshot_for_token(
    db: AsyncSession,
    shop: Shop,
    checkout_token: str,
) -> CheckoutSnapshot:
    snapshot = await db.scalar(
        select(CheckoutSnapshot).where(CheckoutSnapshot.checkout_token == checkout_token)
    )
    if snapshot is None or snapshot.shop_id != shop.id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Invalid checkout token",
        )
    if _as_utc(snapshot.expires_at) < datetime.now(UTC):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Checkout token expired. Please preview checkout again.",
        )
    return snapshot


async def _load_bill_for_shop(db: AsyncSession, shop: Shop, bill_id: UUID) -> Bill:
    bill = await db.scalar(
        select(Bill)
        .where(Bill.id == bill_id, Bill.shop_id == shop.id)
        .options(
            selectinload(Bill.items),
            selectinload(Bill.payment),
            selectinload(Bill.receipt),
            selectinload(Bill.shop).selectinload(Shop.organization),
        )
    )
    if bill is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bill not found")
    return bill


async def _organization_name_for_bill(db: AsyncSession, bill: Bill) -> str:
    organization_id = bill.shop.organization_id if bill.shop is not None else None
    if organization_id is None and bill.shop_id is not None:
        organization_id = await db.scalar(
            select(Shop.organization_id).where(Shop.id == bill.shop_id)
        )
    return await resolve_organization_display_name(db, organization_id)


async def _bill_read_for_shop(
    db: AsyncSession,
    shop: Shop,
    bill_id: UUID,
    *,
    created_by_name: str | None = None,
) -> BillRead:
    bill = await _load_bill_for_shop(db, shop, bill_id)
    read = _bill_to_read(
        bill,
        organization_name=await _organization_name_for_bill(db, bill),
    )
    if created_by_name is None and bill.created_by_user_id is not None:
        user = await db.get(User, bill.created_by_user_id)
        created_by_name = user.username if user is not None else None
    return read.model_copy(update={"created_by_name": created_by_name})


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
    """Validate cart, freeze prices in a snapshot, return printable preview without bill_no."""
    await _ensure_shop_tenant_session(db, shop)
    prepared = await _prepare_checkout(db, shop, payload)
    now = datetime.now(UTC)
    payload_hash = _payload_fingerprint(payload)
    snapshot_id = uuid7()
    token_payload = {
        "snapshot_id": str(snapshot_id),
        "issued_at": now.isoformat(),
        "payload_hash": payload_hash,
        "shop_id": str(shop.id),
    }
    checkout_token = _encode_checkout_token(token_payload)
    snapshot = CheckoutSnapshot(
        id=snapshot_id,
        checkout_token=checkout_token,
        shop_id=shop.id,
        snapshot_json=_snapshot_from_prepared(prepared, payload_hash),
        expires_at=now + CHECKOUT_SNAPSHOT_TTL,
    )
    db.add(snapshot)
    await db.commit()

    organization_name = await _shop_organization_name(db, shop)
    return BillCheckoutPreviewRead(
        id=snapshot_id,
        bill_no=None,
        shop_id=shop.id,
        shop_name=shop.name,
        organization_name=organization_name,
        total_amount=prepared.total_amount,
        status=BillStatus.PAID,
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
            receipt_number="PENDING",
            receipt_status=ReceiptStatus.PENDING,
            print_attempts=0,
            printed_at=None,
        ),
        checkout_token=checkout_token,
    )


async def create_bill(
    db: AsyncSession,
    shop: Shop,
    payload: BillCheckoutCommitRequest,
    *,
    actor: User | None = None,
) -> BillCreateResult:
    """Persist bill in one transaction; idempotent on checkout_token."""
    await _ensure_shop_tenant_session(db, shop)
    token_payload = _decode_checkout_token(payload.checkout_token)
    if token_payload.get("shop_id") != str(shop.id) or token_payload.get(
        "payload_hash"
    ) != _payload_fingerprint(payload):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Checkout token does not match this checkout request",
        )

    snapshot_id_raw = token_payload.get("snapshot_id")
    if not isinstance(snapshot_id_raw, str):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Invalid checkout token",
        )

    snapshot = await _load_snapshot_for_token(db, shop, payload.checkout_token)
    if str(snapshot.id) != snapshot_id_raw:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Invalid checkout token",
        )

    if snapshot.snapshot_json.get("payload_hash") != _payload_fingerprint(payload):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Checkout snapshot does not match this checkout request",
        )

    if snapshot.bill_id is not None:
        bill_read = await _bill_read_for_shop(db, shop, snapshot.bill_id)
        return BillCreateResult(bill=bill_read, created=False)

    existing_bill_id = await db.scalar(
        select(Bill.id).where(Bill.checkout_token == payload.checkout_token)
    )
    if existing_bill_id is not None:
        snapshot.bill_id = existing_bill_id
        await db.commit()
        bill_read = await _bill_read_for_shop(db, shop, existing_bill_id)
        return BillCreateResult(bill=bill_read, created=False)

    prepared = _prepared_from_snapshot(snapshot.snapshot_json)
    now = datetime.now(UTC)
    await _validate_assumption_stock(db, shop, prepared.lines, occurred_at=now)

    try:
        bill_no = await _allocate_bill_number(db, shop, now)
        total_quantity = sum((line.quantity for line in prepared.lines), Decimal("0"))
        bill = Bill(
            bill_no=bill_no,
            shop_id=shop.id,
            checkout_token=payload.checkout_token,
            created_by_user_id=actor.id if actor is not None else None,
            item_count=len(prepared.lines),
            total_quantity=total_quantity,
            total_amount=prepared.total_amount,
            status=BillStatus.PAID,
            created_at=now,
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
            receipt_status=ReceiptStatus.PENDING,
            print_attempts=0,
            printed_at=None,
        )
        assumption_movements = [
            movement
            for line in prepared.lines
            if (movement := _inventory_movement_for_assumption(shop, line, occurred_at=now))
            is not None
        ]
        snapshot.bill_id = bill.id
        db.add_all([payment, receipt, *assumption_movements])
        await db.flush()
        await db.commit()
    except IntegrityError:
        await db.rollback()
        existing_id = await db.scalar(
            select(Bill.id).where(Bill.checkout_token == payload.checkout_token)
        )
        if existing_id is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Bill could not be saved. Please retry checkout.",
            ) from None
        bill_read = await _bill_read_for_shop(db, shop, existing_id)
        return BillCreateResult(bill=bill_read, created=False)

    bill_read = await _bill_read_for_shop(
        db,
        shop,
        bill.id,
        created_by_name=actor.username if actor is not None else None,
    )
    await evict_shop_bills_cache(shop.id)
    return BillCreateResult(bill=bill_read, created=True)


async def update_bill_receipt_status(
    db: AsyncSession,
    shop: Shop,
    bill_id: UUID,
    payload: BillReceiptStatusUpdate,
) -> BillRead:
    bill = await _load_bill_for_shop(db, shop, bill_id)
    receipt = bill.receipt
    if receipt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Receipt not found")

    receipt.print_attempts += 1
    if payload.status == ReceiptStatus.PRINTED:
        receipt.receipt_status = ReceiptStatus.PRINTED
        receipt.printed_at = datetime.now(UTC)
        receipt.last_print_error = None
    elif payload.status == ReceiptStatus.FAILED:
        receipt.receipt_status = ReceiptStatus.FAILED
        receipt.last_print_error = (payload.error or "Printing failed")[:2000]
    else:
        receipt.receipt_status = ReceiptStatus.PENDING

    await db.commit()
    await evict_shop_bills_cache(shop.id)
    return await _bill_read_for_shop(db, shop, bill_id)


async def begin_bill_reprint(db: AsyncSession, shop: Shop, bill_id: UUID) -> BillRead:
    bill = await _load_bill_for_shop(db, shop, bill_id)
    if bill.receipt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Receipt not found")
    bill.receipt.print_attempts += 1
    await db.commit()
    return await _bill_read_for_shop(db, shop, bill_id)


def _bill_created_at_utc(created_at: datetime) -> datetime:
    if created_at.tzinfo is None:
        return created_at.replace(tzinfo=UTC)
    return created_at.astimezone(UTC)


def _assert_bill_within_admin_modification_window(bill: Bill) -> None:
    age = datetime.now(UTC) - _bill_created_at_utc(bill.created_at)
    if age >= ADMIN_BILL_MODIFICATION_WINDOW:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Bill can only be modified within 24 hours of creation",
        )


def _assert_bill_admin_modifiable(bill: Bill) -> None:
    if bill.status == BillStatus.CANCELLED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Bill is already cancelled")
    _assert_bill_within_admin_modification_window(bill)


def _prepare_bill_edit_lines(
    bill: Bill,
    payload: BillEditRequest,
) -> list[PreparedBillLine]:
    existing_by_item = {line.item_id: line for line in bill.items}
    payload_item_ids = {line.item_id for line in payload.items}
    if set(existing_by_item) != payload_item_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Edited items must match the original bill items",
        )

    lines: list[PreparedBillLine] = []
    for line_input in payload.items:
        existing = existing_by_item[line_input.item_id]
        item_name = (existing.item_name or "").strip()
        if (
            existing.item_base_unit == BaseUnit.UNIT
            and line_input.quantity != line_input.quantity.to_integral_value()
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"{item_name or 'Item'} only accepts integer unit quantities",
            )
        price_per_unit = _round_money(existing.price_per_unit)
        line_total = _round_money(price_per_unit * line_input.quantity)
        lines.append(
            PreparedBillLine(
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


async def _load_bill_for_admin(
    db: AsyncSession,
    bill_id: UUID,
    organization_id: UUID,
) -> Bill:
    result = await db.execute(
        select(Bill)
        .join(Shop, Shop.id == Bill.shop_id)
        .options(
            selectinload(Bill.items).selectinload(BillItem.item),
            selectinload(Bill.payment),
            selectinload(Bill.receipt),
            selectinload(Bill.shop).selectinload(Shop.organization),
        )
        .where(Bill.id == bill_id, Shop.organization_id == organization_id)
    )
    bill = result.scalar_one_or_none()
    if bill is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bill not found")
    if bill.payment is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Bill payment not found")
    return bill


async def cancel_shop_bill(
    db: AsyncSession,
    user: User,
    bill_id: UUID,
    organization_id: UUID,
) -> BillRead:
    bill = await _load_bill_for_admin(db, bill_id, organization_id)
    _assert_bill_admin_modifiable(bill)

    bill.status = BillStatus.CANCELLED
    shop = bill.shop or await db.get(Shop, bill.shop_id)
    db.add(
        AuditLog(
            user_id=user.id,
            organization_id=shop.organization_id if shop else None,
            shop_id=bill.shop_id,
            action="bill.cancelled",
            entity_type="bill",
            entity_id=bill.id,
            details={"bill_no": bill.bill_no},
        )
    )
    await db.commit()
    return _bill_to_read(
        bill,
        organization_name=await _organization_name_for_bill(db, bill),
    )


async def edit_shop_bill(
    db: AsyncSession,
    user: User,
    bill_id: UUID,
    organization_id: UUID,
    payload: BillEditRequest,
) -> BillRead:
    bill = await _load_bill_for_admin(db, bill_id, organization_id)
    _assert_bill_admin_modifiable(bill)

    lines = _prepare_bill_edit_lines(bill, payload)
    total_amount = _round_money(sum((line.line_total for line in lines), Decimal("0.00")))
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

    existing_by_item = {line.item_id: line for line in bill.items}
    for prepared in lines:
        existing = existing_by_item[prepared.item_id]
        existing.quantity = prepared.quantity
        existing.line_total = prepared.line_total

    bill.total_amount = total_amount
    bill.item_count = len(lines)
    bill.total_quantity = sum((line.quantity for line in lines), Decimal("0"))

    payment = bill.payment
    payment.cash_amount = cash_amount
    payment.upi_amount = upi_amount
    payment.total_paid = total_paid
    payment.balance = Decimal("0.00")
    payment.is_settled = True

    shop = bill.shop or await db.get(Shop, bill.shop_id)
    db.add(
        AuditLog(
            user_id=user.id,
            organization_id=shop.organization_id if shop else None,
            shop_id=bill.shop_id,
            action="bill.edited",
            entity_type="bill",
            entity_id=bill.id,
            details={
                "bill_no": bill.bill_no,
                "total_amount": str(total_amount),
                "cash_amount": str(cash_amount),
                "upi_amount": str(upi_amount),
            },
        )
    )
    await db.commit()
    await evict_shop_bills_cache(bill.shop_id)
    return _bill_to_read(
        bill,
        organization_name=await _organization_name_for_bill(db, bill),
    )
