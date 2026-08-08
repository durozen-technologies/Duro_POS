"""Overnight inventory weight-loss application (grams/day x remaining birds)."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.ids import uuid7
from app.core.timezone import ist_midnight, to_ist, today_ist
from app.models import (
    BaseUnit,
    InventoryItem,
    InventoryMovement,
    InventoryMovementType,
    InventoryWeightLossApplication,
    ShopInventoryAllocation,
)
from app.schemas.inventory import InventoryWeightLossItemRead
from app.services.inventory import (
    ZERO,
    _available_bird_count_at,
    _available_quantity_at,
)

_GRAMS_PER_KG = Decimal("1000")
_QTY_QUANTUM = Decimal("0.001")


def compute_weight_loss_kg(*, grams_per_day: int, bird_count: int) -> Decimal:
    """Return loss kg from grams/day x birds, quantized to 3 decimals."""
    if grams_per_day <= 0 or bird_count <= 0:
        return ZERO
    raw = (Decimal(grams_per_day) * Decimal(bird_count)) / _GRAMS_PER_KG
    return raw.quantize(_QTY_QUANTUM, rounding=ROUND_HALF_UP)


async def _first_add_date_ist(
    db: AsyncSession,
    shop_id: UUID,
    item_id: UUID,
) -> date | None:
    first_occurred = await db.scalar(
        select(func.min(InventoryMovement.occurred_at)).where(
            InventoryMovement.shop_id == shop_id,
            InventoryMovement.inventory_item_id == item_id,
            InventoryMovement.movement_type == InventoryMovementType.ADD,
        )
    )
    if first_occurred is None:
        return None
    return to_ist(first_occurred).date()


async def _applied_loss_dates(
    db: AsyncSession,
    shop_id: UUID,
    item_id: UUID,
) -> set[date]:
    rows = (
        await db.scalars(
            select(InventoryWeightLossApplication.loss_for_date).where(
                InventoryWeightLossApplication.shop_id == shop_id,
                InventoryWeightLossApplication.inventory_item_id == item_id,
            )
        )
    ).all()
    return set(rows)


async def _apply_weight_loss_for_night(
    db: AsyncSession,
    *,
    shop_id: UUID,
    item: InventoryItem,
    loss_for_date: date,
) -> InventoryWeightLossApplication | None:
    """Apply overnight loss after loss_for_date (snapshot at start of next day)."""
    grams = int(item.weight_loss_grams_per_day or 0)
    if grams <= 0:
        return None

    as_of = ist_midnight(loss_for_date + timedelta(days=1))
    birds = await _available_bird_count_at(db, shop_id, item.id, as_of=as_of)
    available_kg = await _available_quantity_at(db, shop_id, item.id, as_of=as_of)
    loss_kg = compute_weight_loss_kg(grams_per_day=grams, bird_count=birds)
    if loss_kg <= ZERO or available_kg <= ZERO:
        application = InventoryWeightLossApplication(
            id=uuid7(),
            shop_id=shop_id,
            inventory_item_id=item.id,
            loss_for_date=loss_for_date,
            grams_per_day=grams,
            bird_count=birds,
            quantity_kg=ZERO,
            movement_id=None,
        )
        db.add(application)
        return application

    if loss_kg > available_kg:
        loss_kg = available_kg.quantize(_QTY_QUANTUM, rounding=ROUND_HALF_UP)

    movement = InventoryMovement(
        id=uuid7(),
        shop_id=shop_id,
        inventory_item_id=item.id,
        category_id=None,
        movement_type=InventoryMovementType.USE,
        quantity=loss_kg,
        bird_count=0,
        occurred_at=as_of,
        driver_name="Weight Loss",
    )
    db.add(movement)
    await db.flush()

    application = InventoryWeightLossApplication(
        id=uuid7(),
        shop_id=shop_id,
        inventory_item_id=item.id,
        loss_for_date=loss_for_date,
        grams_per_day=grams,
        bird_count=birds,
        quantity_kg=loss_kg,
        movement_id=movement.id,
    )
    db.add(application)
    return application


async def ensure_shop_weight_loss_applied(
    db: AsyncSession,
    shop_id: UUID,
    *,
    as_of_date: date | None = None,
) -> int:
    """Apply missing overnight weight-loss USE rows through yesterday (IST)."""
    today = as_of_date or today_ist()
    yesterday = today - timedelta(days=1)
    if yesterday < date(2000, 1, 1):
        return 0

    rows = (
        await db.execute(
            select(InventoryItem, ShopInventoryAllocation)
            .join(
                ShopInventoryAllocation,
                ShopInventoryAllocation.inventory_item_id == InventoryItem.id,
            )
            .where(
                ShopInventoryAllocation.shop_id == shop_id,
                ShopInventoryAllocation.is_active.is_(True),
                InventoryItem.is_active.is_(True),
                InventoryItem.base_unit == BaseUnit.KG,
                InventoryItem.weight_loss_grams_per_day > 0,
            )
        )
    ).all()
    if not rows:
        return 0

    created = 0
    for item, _allocation in rows:
        first_add = await _first_add_date_ist(db, shop_id, item.id)
        if first_add is None:
            continue
        start_loss_date = first_add
        if start_loss_date > yesterday:
            continue

        applied = await _applied_loss_dates(db, shop_id, item.id)
        loss_date = start_loss_date
        while loss_date <= yesterday:
            if loss_date not in applied:
                result = await _apply_weight_loss_for_night(
                    db,
                    shop_id=shop_id,
                    item=item,
                    loss_for_date=loss_date,
                )
                if result is not None:
                    created += 1
                    applied.add(loss_date)
            loss_date += timedelta(days=1)

    if created:
        await db.commit()
    return created


async def ensure_all_shops_weight_loss_applied(
    db: AsyncSession,
    shop_ids: list[UUID],
    *,
    as_of_date: date | None = None,
) -> int:
    total = 0
    for shop_id in shop_ids:
        total += await ensure_shop_weight_loss_applied(db, shop_id, as_of_date=as_of_date)
    return total


async def list_inventory_weight_loss_items(
    db: AsyncSession,
) -> list[InventoryWeightLossItemRead]:
    items = (
        await db.scalars(
            select(InventoryItem)
            .where(InventoryItem.base_unit == BaseUnit.KG)
            .order_by(InventoryItem.sort_order, func.lower(InventoryItem.name), InventoryItem.id)
        )
    ).all()
    return [
        InventoryWeightLossItemRead(
            item_id=item.id,
            item_name=item.name,
            item_tamil_name=item.tamil_name,
            base_unit=item.base_unit,
            is_active=item.is_active,
            weight_loss_grams_per_day=int(item.weight_loss_grams_per_day or 0),
        )
        for item in items
    ]


async def update_inventory_weight_loss(
    db: AsyncSession,
    item_id: UUID,
    grams_per_day: int,
) -> InventoryWeightLossItemRead:
    if grams_per_day < 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="weight_loss_grams_per_day must be >= 0",
        )
    item = await db.scalar(select(InventoryItem).where(InventoryItem.id == item_id))
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Inventory item not found"
        )
    if item.base_unit != BaseUnit.KG:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Weight loss applies only to KG inventory items",
        )
    item.weight_loss_grams_per_day = grams_per_day
    await db.commit()
    await db.refresh(item)
    return InventoryWeightLossItemRead(
        item_id=item.id,
        item_name=item.name,
        item_tamil_name=item.tamil_name,
        base_unit=item.base_unit,
        is_active=item.is_active,
        weight_loss_grams_per_day=int(item.weight_loss_grams_per_day or 0),
    )
