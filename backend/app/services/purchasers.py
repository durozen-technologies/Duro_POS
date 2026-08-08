from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import AuditLog, Purchaser
from ..schemas.purchaser import PurchaserCreate, PurchaserRead, PurchaserUpdate
from ..services.tenant_query import resolve_organization_id


def _normalize_optional_text(value: str | None, *, max_length: int) -> str | None:
    if value is None:
        return None
    cleaned = " ".join(value.split())
    if not cleaned:
        return None
    return cleaned[:max_length]


def _purchaser_to_read(purchaser: Purchaser) -> PurchaserRead:
    return PurchaserRead(
        id=purchaser.id,
        name=purchaser.name,
        tamil_name=purchaser.tamil_name,
        shop_name=purchaser.shop_name,
        phone=purchaser.phone,
        address=purchaser.address,
        is_active=purchaser.is_active,
        created_at=purchaser.created_at,
        updated_at=purchaser.updated_at,
    )


async def get_purchaser(db: AsyncSession, purchaser_id: UUID) -> PurchaserRead:
    purchaser = await db.scalar(select(Purchaser).where(Purchaser.id == purchaser_id))
    if purchaser is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Purchaser not found")
    return _purchaser_to_read(purchaser)


async def list_purchasers(
    db: AsyncSession,
    *,
    q: str | None = None,
    active: bool | None = None,
) -> list[PurchaserRead]:
    query = select(Purchaser)
    if active is not None:
        query = query.where(Purchaser.is_active == active)
    if q is not None and q.strip():
        search = f"%{q.strip().lower()}%"
        query = query.where(
            or_(
                func.lower(Purchaser.name).like(search),
                func.lower(Purchaser.tamil_name).like(search),
                func.lower(func.coalesce(Purchaser.shop_name, "")).like(search),
                func.lower(func.coalesce(Purchaser.phone, "")).like(search),
            )
        )
    query = query.order_by(desc(Purchaser.is_active), func.lower(Purchaser.name), Purchaser.id)
    rows = (await db.scalars(query)).all()
    return [_purchaser_to_read(row) for row in rows]


async def create_purchaser(
    db: AsyncSession,
    payload: PurchaserCreate,
    user_id: UUID,
    organization_id: UUID | None = None,
) -> PurchaserRead:
    org_id = organization_id or await resolve_organization_id(db)
    purchaser = Purchaser(
        organization_id=org_id,
        name=payload.name.strip(),
        tamil_name=payload.tamil_name.strip(),
        shop_name=_normalize_optional_text(payload.shop_name, max_length=120),
        phone=_normalize_optional_text(payload.phone, max_length=30),
        address=_normalize_optional_text(payload.address, max_length=500),
        is_active=payload.is_active,
    )
    db.add(purchaser)
    await db.flush()

    db.add(
        AuditLog(
            user_id=user_id,
            action="purchaser_created",
            entity_type="purchaser",
            entity_id=purchaser.id,
            details={
                "name": purchaser.name,
                "tamil_name": purchaser.tamil_name,
                "shop_name": purchaser.shop_name,
                "is_active": purchaser.is_active,
            },
        )
    )
    await db.commit()
    await db.refresh(purchaser)
    return _purchaser_to_read(purchaser)


async def update_purchaser(
    db: AsyncSession,
    purchaser_id: UUID,
    payload: PurchaserUpdate,
    user_id: UUID,
) -> PurchaserRead:
    purchaser = await db.scalar(
        select(Purchaser).where(Purchaser.id == purchaser_id).with_for_update()
    )
    if purchaser is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Purchaser not found")

    changes: dict[str, object] = {}
    if payload.name is not None and payload.name.strip() != purchaser.name:
        changes["name_before"] = purchaser.name
        changes["name_after"] = payload.name.strip()
        purchaser.name = payload.name.strip()
    if payload.tamil_name is not None and payload.tamil_name.strip() != purchaser.tamil_name:
        changes["tamil_name_before"] = purchaser.tamil_name
        changes["tamil_name_after"] = payload.tamil_name.strip()
        purchaser.tamil_name = payload.tamil_name.strip()
    if "shop_name" in payload.model_fields_set:
        next_shop = _normalize_optional_text(payload.shop_name, max_length=120)
        if next_shop != purchaser.shop_name:
            changes["shop_name_before"] = purchaser.shop_name
            changes["shop_name_after"] = next_shop
            purchaser.shop_name = next_shop
    if "phone" in payload.model_fields_set:
        next_phone = _normalize_optional_text(payload.phone, max_length=30)
        if next_phone != purchaser.phone:
            changes["phone_before"] = purchaser.phone
            changes["phone_after"] = next_phone
            purchaser.phone = next_phone
    if "address" in payload.model_fields_set:
        next_address = _normalize_optional_text(payload.address, max_length=500)
        if next_address != purchaser.address:
            changes["address_before"] = purchaser.address
            changes["address_after"] = next_address
            purchaser.address = next_address
    if payload.is_active is not None and payload.is_active != purchaser.is_active:
        changes["is_active_before"] = purchaser.is_active
        changes["is_active_after"] = payload.is_active
        purchaser.is_active = payload.is_active

    if changes:
        db.add(
            AuditLog(
                user_id=user_id,
                action="purchaser_updated",
                entity_type="purchaser",
                entity_id=purchaser.id,
                details=changes,
            )
        )
        await db.commit()
        await db.refresh(purchaser)

    return _purchaser_to_read(purchaser)


async def resolve_active_purchaser(
    db: AsyncSession,
    purchaser_id: UUID | None,
) -> tuple[UUID | None, str | None, str | None]:
    """Validate optional purchaser for Add Stock; return (id, name, tamil_name)."""
    if purchaser_id is None:
        return None, None, None
    purchaser = await db.scalar(select(Purchaser).where(Purchaser.id == purchaser_id))
    if purchaser is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Purchaser not found")
    if not purchaser.is_active:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Purchaser is inactive"
        )
    return purchaser.id, purchaser.name, purchaser.tamil_name
