from decimal import Decimal
from datetime import date, timedelta
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import ist_day_bounds, ist_midnight

from ..models import (
    AuditLog,
    InventoryItem,
    InventoryTransfer,
    Shop,
    TransferShop,
    User,
)
from ..schemas.transfer import (
    InventoryTransferCreate,
    InventoryTransferPage,
    InventoryTransferRead,
    TransferShopCreate,
    TransferShopRead,
    TransferShopUpdate,
)
from ..services.tenant_query import resolve_organization_id
from .inventory import (
    _bird_availability_for_transaction,
    _get_allocated_inventory_item_for_shop,
    _quantity_availability_for_transaction,
    _resolve_inventory_actor,
    _validate_bird_count_ceiling,
)
from .inventory_backdate import prepare_inventory_occurred_at

# =====================================================================
# Transfer Shop CRUD
# =====================================================================


def _transfer_shop_to_read(shop: TransferShop, *, has_history: bool) -> TransferShopRead:
    return TransferShopRead(
        id=shop.id,
        name=shop.name,
        tamil_name=shop.tamil_name,
        is_active=shop.is_active,
        has_history=has_history,
        created_at=shop.created_at,
        updated_at=shop.updated_at,
    )


async def _transfer_shop_has_history(db: AsyncSession, transfer_shop_id: UUID) -> bool:
    return bool(
        await db.scalar(
            select(
                select(InventoryTransfer.id)
                .where(InventoryTransfer.transfer_shop_id == transfer_shop_id)
                .limit(1)
                .exists()
            )
        )
    )


async def get_transfer_shop(db: AsyncSession, transfer_shop_id: UUID) -> TransferShopRead:
    shop = await db.scalar(select(TransferShop).where(TransferShop.id == transfer_shop_id))
    if shop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transfer shop not found")
    has_history = await _transfer_shop_has_history(db, transfer_shop_id)
    return _transfer_shop_to_read(shop, has_history=has_history)


async def list_transfer_shops(
    db: AsyncSession,
    *,
    q: str | None = None,
    active: bool | None = None,
) -> list[TransferShopRead]:
    has_history_expr = (
        select(InventoryTransfer.id)
        .where(InventoryTransfer.transfer_shop_id == TransferShop.id)
        .limit(1)
        .exists()
    ).label("has_history")
    query = select(TransferShop, has_history_expr)
    if active is not None:
        query = query.where(TransferShop.is_active == active)
    if q is not None and q.strip():
        search = f"%{q.strip().lower()}%"
        query = query.where(
            or_(
                func.lower(TransferShop.name).like(search),
                func.lower(TransferShop.tamil_name).like(search),
            )
        )
    query = query.order_by(desc(TransferShop.is_active), func.lower(TransferShop.name), TransferShop.id)
    rows = (await db.execute(query)).all()
    return [
        _transfer_shop_to_read(shop, has_history=bool(has_history)) for shop, has_history in rows
    ]


async def create_transfer_shop(
    db: AsyncSession,
    payload: TransferShopCreate,
    user_id: UUID,
    organization_id: UUID | None = None,
) -> TransferShopRead:
    org_id = organization_id or await resolve_organization_id(db)
    shop = TransferShop(
        name=payload.name,
        tamil_name=payload.tamil_name,
        is_active=payload.is_active,
        organization_id=org_id,
    )
    db.add(shop)
    await db.flush()

    audit_log = AuditLog(
        user_id=user_id,
        action="transfer_shop_created",
        entity_type="transfer_shop",
        entity_id=shop.id,
        details={"name": shop.name, "tamil_name": shop.tamil_name, "is_active": shop.is_active},
    )
    db.add(audit_log)

    await db.commit()
    await db.refresh(shop)
    return _transfer_shop_to_read(shop, has_history=False)


async def update_transfer_shop(
    db: AsyncSession, transfer_shop_id: UUID, payload: TransferShopUpdate, user_id: UUID
) -> TransferShopRead:
    shop = await db.scalar(
        select(TransferShop).where(TransferShop.id == transfer_shop_id).with_for_update()
    )
    if shop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transfer shop not found")

    changes = {}
    if payload.name is not None and payload.name != shop.name:
        changes["name_before"] = shop.name
        changes["name_after"] = payload.name
        shop.name = payload.name
    if payload.tamil_name is not None and payload.tamil_name != shop.tamil_name:
        changes["tamil_name_before"] = shop.tamil_name
        changes["tamil_name_after"] = payload.tamil_name
        shop.tamil_name = payload.tamil_name
    if payload.is_active is not None and payload.is_active != shop.is_active:
        changes["is_active_before"] = shop.is_active
        changes["is_active_after"] = payload.is_active
        shop.is_active = payload.is_active

    if changes:
        audit_log = AuditLog(
            user_id=user_id,
            action="transfer_shop_updated",
            entity_type="transfer_shop",
            entity_id=shop.id,
            details=changes,
        )
        db.add(audit_log)
        await db.commit()
        await db.refresh(shop)

    has_history = await _transfer_shop_has_history(db, transfer_shop_id)
    return _transfer_shop_to_read(shop, has_history=has_history)


async def delete_transfer_shop(
    db: AsyncSession, transfer_shop_id: UUID, user_id: UUID
) -> None:
    shop = await db.scalar(
        select(TransferShop).where(TransferShop.id == transfer_shop_id).with_for_update()
    )
    if shop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transfer shop not found")

    if await _transfer_shop_has_history(db, transfer_shop_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete transfer shop with transfer history",
        )

    audit_log = AuditLog(
        user_id=user_id,
        action="transfer_shop_deleted",
        entity_type="transfer_shop",
        entity_id=shop.id,
        details={"name": shop.name, "tamil_name": shop.tamil_name},
    )
    db.add(audit_log)
    await db.delete(shop)
    await db.commit()


# =====================================================================
# Inventory Transfers
# =====================================================================


async def create_inventory_transfer(
    db: AsyncSession,
    source_shop: Shop,
    inventory_item_id: UUID,
    payload: InventoryTransferCreate,
    user_id: UUID,
    *,
    actor: User | None = None,
) -> InventoryTransferRead:
    # 1. Validate destination
    transfer_shop = await db.scalar(
        select(TransferShop).where(TransferShop.id == payload.transfer_shop_id)
    )
    if transfer_shop is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Transfer destination not found"
        )
    if not transfer_shop.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Transfer destination is inactive"
        )

    # 2. Validate inventory item
    item = await db.scalar(
        select(InventoryItem).where(InventoryItem.id == inventory_item_id).with_for_update()
    )
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Inventory item not found"
        )
    if not item.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Inventory item is inactive"
        )

    # 3. Check allocation (is it allocated to source_shop?)
    occurred_at = await prepare_inventory_occurred_at(
        db,
        actor=await _resolve_inventory_actor(db, source_shop, actor),
        raw=payload.occurred_at,
    )
    item, allocation = await _get_allocated_inventory_item_for_shop(
        db, source_shop, inventory_item_id
    )
    if not allocation.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Item allocation is inactive for this shop",
        )

    # 4. Check decimal validity
    from ..schemas.inventory import validate_inventory_quantity_for_unit

    validate_inventory_quantity_for_unit(item.base_unit, payload.quantity)

    # 5. Check available stock
    available_quantity = await _quantity_availability_for_transaction(
        db,
        source_shop.id,
        item.id,
        raw_occurred_at=payload.occurred_at,
        occurred_at=occurred_at,
    )
    if payload.quantity > available_quantity:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Transfer quantity exceeds available stock",
        )
    added_bird_count, available_bird_count = await _bird_availability_for_transaction(
        db,
        source_shop.id,
        item.id,
        raw_occurred_at=payload.occurred_at,
        occurred_at=occurred_at,
    )
    _validate_bird_count_ceiling(
        item,
        payload.bird_count,
        available_bird_count=available_bird_count,
        added_bird_count=added_bird_count,
    )

    # 6. Create transfer record
    transfer = InventoryTransfer(
        source_shop_id=source_shop.id,
        transfer_shop_id=transfer_shop.id,
        inventory_item_id=item.id,
        quantity=payload.quantity,
        bird_count=payload.bird_count,
        unit=item.base_unit,
        occurred_at=occurred_at,
    )
    db.add(transfer)
    await db.flush()

    # 7. Create audit log
    audit_log = AuditLog(
        user_id=user_id,
        shop_id=source_shop.id,
        action="inventory_transfer_created",
        entity_type="inventory_transfer",
        entity_id=transfer.id,
        details={
            "quantity": float(payload.quantity),
            "unit": item.base_unit.value,
            "transfer_shop_name": transfer_shop.name,
            "item_name": item.name,
        },
    )
    db.add(audit_log)

    await db.commit()

    return InventoryTransferRead(
        **transfer.__dict__,
        source_shop_name=source_shop.name,
        transfer_shop_name=transfer_shop.name,
        inventory_item_name=item.name,
        inventory_item_tamil_name=item.tamil_name,
    )


async def list_inventory_transfers(
    db: AsyncSession,
    *,
    transfer_shop_id: UUID | None = None,
    source_shop_id: UUID | None = None,
    inventory_item_id: UUID | None = None,
    reference_date: date | None = None,
    range_start_date: date | None = None,
    range_end_date: date | None = None,
    q: str | None = None,
    unit: str | None = None,
    quantity: Decimal | None = None,
    limit: int = 100,
    offset: int = 0,
) -> InventoryTransferPage:
    query = (
        select(InventoryTransfer, Shop, TransferShop, InventoryItem)
        .join(Shop, InventoryTransfer.source_shop_id == Shop.id)
        .join(TransferShop, InventoryTransfer.transfer_shop_id == TransferShop.id)
        .join(InventoryItem, InventoryTransfer.inventory_item_id == InventoryItem.id)
    )

    if q:
        search = f"%{q.strip().lower()}%"
        query = query.where(
            or_(
                func.lower(InventoryItem.name).like(search),
                func.lower(InventoryItem.tamil_name).like(search),
                func.lower(Shop.name).like(search)
            )
        )
    if unit:
        query = query.where(InventoryTransfer.unit == unit)
    if quantity is not None:
        query = query.where(InventoryTransfer.quantity == quantity)

    if transfer_shop_id is not None:
        query = query.where(InventoryTransfer.transfer_shop_id == transfer_shop_id)
    if source_shop_id is not None:
        query = query.where(InventoryTransfer.source_shop_id == source_shop_id)
    if inventory_item_id is not None:
        query = query.where(InventoryTransfer.inventory_item_id == inventory_item_id)

    if reference_date is not None:
        start_dt, end_dt = ist_day_bounds(reference_date)
        query = query.where(
            InventoryTransfer.occurred_at >= start_dt,
            InventoryTransfer.occurred_at < end_dt,
        )
    else:
        if range_start_date is not None:
            query = query.where(InventoryTransfer.occurred_at >= ist_midnight(range_start_date))
        if range_end_date is not None:
            query = query.where(
                InventoryTransfer.occurred_at < ist_midnight(range_end_date + timedelta(days=1))
            )

    query = query.order_by(desc(InventoryTransfer.occurred_at), desc(InventoryTransfer.id))
    query = query.limit(limit + 1).offset(offset)

    rows = (await db.execute(query)).all()
    page_rows = rows[:limit]
    has_more = len(rows) > limit

    items = []
    for transfer, s_shop, t_shop, i_item in page_rows:
        items.append(
            InventoryTransferRead(
                **transfer.__dict__,
                source_shop_name=s_shop.name,
                transfer_shop_name=t_shop.name,
                inventory_item_name=i_item.name,
                inventory_item_tamil_name=i_item.tamil_name,
            )
        )

    return InventoryTransferPage(items=items, limit=limit, has_more=has_more)
