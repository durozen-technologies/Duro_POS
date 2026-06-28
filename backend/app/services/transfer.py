from datetime import UTC, date, datetime, time
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

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
from .inventory import _available_quantity_at, _get_allocated_inventory_item_for_shop, _resolve_inventory_actor
from .inventory_backdate import prepare_inventory_occurred_at

# =====================================================================
# Transfer Shop CRUD
# =====================================================================

async def get_transfer_shop(db: AsyncSession, transfer_shop_id: UUID) -> TransferShopRead:
    shop = await db.scalar(select(TransferShop).where(TransferShop.id == transfer_shop_id))
    if shop is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Transfer shop not found"
        )
    return TransferShopRead.model_validate(shop)


async def list_transfer_shops(
    db: AsyncSession,
    *,
    q: str | None = None,
    active: bool | None = None,
) -> list[TransferShopRead]:
    query = select(TransferShop)
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
    query = query.order_by(func.lower(TransferShop.name), TransferShop.id)
    shops = (await db.scalars(query)).all()
    return [TransferShopRead.model_validate(shop) for shop in shops]


async def create_transfer_shop(
    db: AsyncSession, payload: TransferShopCreate, user_id: UUID
) -> TransferShopRead:
    shop = TransferShop(
        name=payload.name,
        tamil_name=payload.tamil_name,
        is_active=payload.is_active,
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
    return TransferShopRead.model_validate(shop)


async def update_transfer_shop(
    db: AsyncSession, transfer_shop_id: UUID, payload: TransferShopUpdate, user_id: UUID
) -> TransferShopRead:
    shop = await db.scalar(
        select(TransferShop).where(TransferShop.id == transfer_shop_id).with_for_update()
    )
    if shop is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Transfer shop not found"
        )

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

    return TransferShopRead.model_validate(shop)


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
        select(InventoryItem)
        .where(InventoryItem.id == inventory_item_id)
        .with_for_update()
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
    item, allocation = await _get_allocated_inventory_item_for_shop(db, source_shop, inventory_item_id)
    if not allocation.is_active:
         raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Item allocation is inactive for this shop"
        )

    # 4. Check decimal validity
    from ..schemas.inventory import validate_inventory_quantity_for_unit
    validate_inventory_quantity_for_unit(item.base_unit, payload.quantity)

    # 5. Check available stock
    available_quantity = await _available_quantity_at(db, source_shop.id, item.id, as_of=occurred_at)
    if payload.quantity > available_quantity:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Transfer quantity exceeds available stock",
        )

    # 6. Create transfer record
    transfer = InventoryTransfer(
        source_shop_id=source_shop.id,
        transfer_shop_id=transfer_shop.id,
        inventory_item_id=item.id,
        quantity=payload.quantity,
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
    limit: int = 100,
    offset: int = 0,
) -> InventoryTransferPage:
    query = (
        select(InventoryTransfer, Shop, TransferShop, InventoryItem)
        .join(Shop, InventoryTransfer.source_shop_id == Shop.id)
        .join(TransferShop, InventoryTransfer.transfer_shop_id == TransferShop.id)
        .join(InventoryItem, InventoryTransfer.inventory_item_id == InventoryItem.id)
    )

    if transfer_shop_id is not None:
        query = query.where(InventoryTransfer.transfer_shop_id == transfer_shop_id)
    if source_shop_id is not None:
        query = query.where(InventoryTransfer.source_shop_id == source_shop_id)
    if inventory_item_id is not None:
        query = query.where(InventoryTransfer.inventory_item_id == inventory_item_id)

    if reference_date is not None:
        start_dt = datetime.combine(reference_date, time.min, tzinfo=UTC)
        end_dt = datetime.combine(reference_date, time.max, tzinfo=UTC)
        query = query.where(InventoryTransfer.occurred_at.between(start_dt, end_dt))
    else:
        if range_start_date is not None:
            start_dt = datetime.combine(range_start_date, time.min, tzinfo=UTC)
            query = query.where(InventoryTransfer.occurred_at >= start_dt)
        if range_end_date is not None:
            end_dt = datetime.combine(range_end_date, time.max, tzinfo=UTC)
            query = query.where(InventoryTransfer.occurred_at <= end_dt)

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
