"""Record inventory purchases from retailers and credit wallet balance."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.ids import uuid7
from app.core.timezone import ist_midnight
from app.models import (
    InventoryMovement,
    InventoryMovementType,
    Retailer,
    RetailerInventoryPurchase,
    RetailerInventoryPurchaseLine,
    RetailerInventoryPurchaseStatus,
    Shop,
    User,
)
from app.schemas.retailer_inventory import (
    RetailerInventoryPurchaseCreate,
    RetailerInventoryPurchaseLineRead,
    RetailerInventoryPurchasePage,
    RetailerInventoryPurchaseRead,
)
from app.services.retailer_sales import (
    reverse_purchase_settlement_payments,
    settle_purchase_against_open_sales,
)
from app.services.retailers import ensure_retailer_at_shop

from .inventory import (
    _available_quantity_at,
    _get_allocated_inventory_item_for_shop,
    _normalize_quantity,
    _prepare_occurred_at,
)

TWOPLACES = Decimal("0.01")


def _round_money(value: Decimal) -> Decimal:
    return value.quantize(TWOPLACES, rounding=ROUND_HALF_UP)


async def _lock_retailer(db: AsyncSession, retailer_id: UUID) -> Retailer:
    retailer = await db.scalar(
        select(Retailer).where(Retailer.id == retailer_id).with_for_update()
    )
    if retailer is None or not retailer.is_active:
        raise HTTPException(status_code=404, detail="Retailer not found")
    return retailer


def _purchase_to_read(purchase: RetailerInventoryPurchase) -> RetailerInventoryPurchaseRead:
    retailer = purchase.retailer
    shop = purchase.shop
    return RetailerInventoryPurchaseRead(
        id=purchase.id,
        shop_id=purchase.shop_id,
        shop_name=shop.name if shop is not None else None,
        retailer_id=purchase.retailer_id,
        retailer_name=retailer.name if retailer is not None else None,
        total_amount=purchase.total_amount,
        amount_applied_to_outstanding=purchase.amount_applied_to_outstanding,
        amount_deposited_to_wallet=purchase.amount_deposited_to_wallet,
        status=purchase.status.value,
        notes=purchase.notes,
        created_at=purchase.created_at,
        voided_at=purchase.voided_at,
        lines=[
            RetailerInventoryPurchaseLineRead(
                id=line.id,
                inventory_item_id=line.inventory_item_id,
                item_name=line.item_name,
                quantity=line.quantity,
                price_per_unit=line.price_per_unit,
                line_total=line.line_total,
            )
            for line in purchase.lines
        ],
    )


async def create_retailer_inventory_purchase(
    db: AsyncSession,
    shop: Shop,
    payload: RetailerInventoryPurchaseCreate,
    *,
    actor: User | None = None,
) -> RetailerInventoryPurchaseRead:
    if actor is None:
        raise HTTPException(status_code=422, detail="Actor is required to record purchase")
    await ensure_retailer_at_shop(db, retailer_id=payload.retailer_id, shop_id=shop.id)
    occurred_at = await _prepare_occurred_at(db, actor=actor, shop=shop, raw=payload.occurred_at)

    prepared_lines: list[tuple] = []
    total_amount = Decimal("0.00")
    for line in payload.lines:
        item, _allocation = await _get_allocated_inventory_item_for_shop(
            db, shop, line.inventory_item_id
        )
        quantity = _normalize_quantity(item.base_unit, line.quantity)
        price_per_unit = _round_money(line.price_per_unit)
        line_total = _round_money(price_per_unit * quantity)
        if line_total <= 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Invalid line total for {item.name}",
            )
        total_amount += line_total
        prepared_lines.append((item, quantity, price_per_unit, line_total))

    total_amount = _round_money(total_amount)
    retailer = await _lock_retailer(db, payload.retailer_id)

    purchase = RetailerInventoryPurchase(
        id=uuid7(),
        shop_id=shop.id,
        retailer_id=payload.retailer_id,
        total_amount=total_amount,
        amount_applied_to_outstanding=Decimal("0.00"),
        amount_deposited_to_wallet=Decimal("0.00"),
        status=RetailerInventoryPurchaseStatus.ACTIVE,
        notes=payload.notes,
        created_by_user_id=actor.id,
    )
    db.add(purchase)
    await db.flush()

    for item, quantity, price_per_unit, line_total in prepared_lines:
        movement = InventoryMovement(
            shop_id=shop.id,
            inventory_item_id=item.id,
            movement_type=InventoryMovementType.ADD,
            quantity=quantity,
            occurred_at=occurred_at,
        )
        db.add(movement)
        await db.flush()
        purchase_line = RetailerInventoryPurchaseLine(
            purchase_id=purchase.id,
            inventory_item_id=item.id,
            inventory_movement_id=movement.id,
            item_name=item.name,
            quantity=quantity,
            price_per_unit=price_per_unit,
            line_total=line_total,
        )
        db.add(purchase_line)

    retailer.credit_balance = _round_money(retailer.credit_balance + total_amount)
    applied = await settle_purchase_against_open_sales(
        db,
        shop,
        actor,
        retailer_id=payload.retailer_id,
        purchase_id=purchase.id,
        settlement_pool=total_amount,
    )
    deposited = _round_money(total_amount - applied)
    purchase.amount_applied_to_outstanding = applied
    purchase.amount_deposited_to_wallet = deposited

    await db.commit()

    loaded = await db.scalar(
        select(RetailerInventoryPurchase)
        .where(RetailerInventoryPurchase.id == purchase.id)
        .options(
            selectinload(RetailerInventoryPurchase.lines),
            selectinload(RetailerInventoryPurchase.retailer),
            selectinload(RetailerInventoryPurchase.shop),
        )
    )
    if loaded is None:
        raise HTTPException(status_code=500, detail="Purchase was not saved")
    return _purchase_to_read(loaded)


async def void_retailer_inventory_purchase(
    db: AsyncSession,
    shop: Shop,
    purchase_id: UUID,
    *,
    actor: User | None = None,
) -> RetailerInventoryPurchaseRead:
    purchase = await db.scalar(
        select(RetailerInventoryPurchase)
        .where(
            RetailerInventoryPurchase.id == purchase_id,
            RetailerInventoryPurchase.shop_id == shop.id,
        )
        .options(
            selectinload(RetailerInventoryPurchase.lines),
            selectinload(RetailerInventoryPurchase.retailer),
            selectinload(RetailerInventoryPurchase.shop),
        )
        .with_for_update()
    )
    if purchase is None:
        raise HTTPException(status_code=404, detail="Purchase not found")
    if purchase.status == RetailerInventoryPurchaseStatus.VOID:
        raise HTTPException(status_code=409, detail="Purchase is already void")

    retailer = await _lock_retailer(db, purchase.retailer_id)
    voided_at = datetime.now(UTC)

    await reverse_purchase_settlement_payments(db, purchase.retailer_id, purchase.id)
    retailer.credit_balance = _round_money(retailer.credit_balance - purchase.total_amount)

    for line in purchase.lines:
        item, _allocation = await _get_allocated_inventory_item_for_shop(
            db, shop, line.inventory_item_id
        )
        available = await _available_quantity_at(db, shop.id, item.id, as_of=voided_at)
        if line.quantity > available:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot void purchase: insufficient stock for {line.item_name}",
            )
        reversal = InventoryMovement(
            shop_id=shop.id,
            inventory_item_id=item.id,
            movement_type=InventoryMovementType.USE,
            quantity=line.quantity,
            occurred_at=voided_at,
        )
        db.add(reversal)

    purchase.status = RetailerInventoryPurchaseStatus.VOID
    purchase.voided_at = voided_at
    purchase.voided_by_user_id = actor.id if actor is not None else None
    await db.commit()

    await db.refresh(purchase, attribute_names=["lines", "retailer", "shop", "status", "voided_at"])
    return _purchase_to_read(purchase)


async def list_retailer_inventory_purchases(
    db: AsyncSession,
    *,
    shop_id: UUID | None = None,
    retailer_id: UUID | None = None,
    reference_date: date | None = None,
    range_start_date: date | None = None,
    range_end_date: date | None = None,
    limit: int = 100,
) -> RetailerInventoryPurchasePage:
    query = select(RetailerInventoryPurchase).options(
        selectinload(RetailerInventoryPurchase.lines),
        selectinload(RetailerInventoryPurchase.retailer),
        selectinload(RetailerInventoryPurchase.shop),
    )
    if shop_id is not None:
        query = query.where(RetailerInventoryPurchase.shop_id == shop_id)
    if retailer_id is not None:
        query = query.where(RetailerInventoryPurchase.retailer_id == retailer_id)
    if range_start_date is not None or range_end_date is not None:
        if range_start_date is not None:
            query = query.where(
                RetailerInventoryPurchase.created_at >= ist_midnight(range_start_date)
            )
        if range_end_date is not None:
            query = query.where(
                RetailerInventoryPurchase.created_at
                < ist_midnight(range_end_date + timedelta(days=1))
            )
    elif reference_date is not None:
        query = query.where(
            RetailerInventoryPurchase.created_at >= ist_midnight(reference_date),
            RetailerInventoryPurchase.created_at
            < ist_midnight(reference_date + timedelta(days=1)),
        )
    rows = (
        await db.scalars(
            query.order_by(
                RetailerInventoryPurchase.created_at.desc(),
                RetailerInventoryPurchase.id.desc(),
            ).limit(limit + 1)
        )
    ).all()
    page_rows = rows[:limit]
    return RetailerInventoryPurchasePage(
        items=[_purchase_to_read(row) for row in page_rows],
        limit=limit,
        has_more=len(rows) > limit,
    )
