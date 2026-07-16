"""Tenant-scoped query helpers."""

from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Organization, Shop, User, UserRole


async def resolve_organization_id(
    db: AsyncSession,
    *,
    actor: User | None = None,
    shop_id: UUID | None = None,
) -> UUID:
    if actor is not None and actor.organization_id is not None:
        return actor.organization_id
    if shop_id is not None:
        org_id = await db.scalar(select(Shop.organization_id).where(Shop.id == shop_id))
        if org_id is not None:
            return org_id
    first_org_id = await db.scalar(
        select(Organization.id).order_by(Organization.created_at).limit(1)
    )
    if first_org_id is not None:
        return first_org_id
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="No organization context available",
    )


async def shop_belongs_to_org(db: AsyncSession, shop_id: UUID, organization_id: UUID) -> bool:
    shop_org_id = await db.scalar(select(Shop.organization_id).where(Shop.id == shop_id))
    return shop_org_id == organization_id


async def get_shop_for_tenant_or_404(
    db: AsyncSession,
    shop_id: UUID,
    organization_id: UUID,
) -> Shop:
    shop = await db.get(Shop, shop_id)
    if shop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shop not found")
    return shop


async def list_organization_shops(
    db: AsyncSession,
    organization_id: UUID,
    *,
    shop_ids: list[UUID] | None = None,
) -> list[tuple[UUID, str]]:
    unique_shop_ids = list(dict.fromkeys(shop_ids or []))
    query = (
        select(Shop.id, Shop.name)
        .where(Shop.organization_id == organization_id)
        .order_by(Shop.name, Shop.id)
    )
    if unique_shop_ids:
        query = query.where(Shop.id.in_(unique_shop_ids))
    rows = (await db.execute(query)).all()
    if unique_shop_ids:
        found_shop_ids = {row.id for row in rows}
        if set(unique_shop_ids) - found_shop_ids:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shop not found")
    return [(row.id, row.name) for row in rows]


async def list_organization_shop_ids(
    db: AsyncSession,
    organization_id: UUID,
) -> list[UUID]:
    return list(await db.scalars(select(Shop.id).where(Shop.organization_id == organization_id)))


async def resolve_organization_display_name(
    db: AsyncSession,
    organization_id: UUID | None,
) -> str:
    if organization_id is None:
        return "Organization"
    tenant_admin_shop_name = await db.scalar(
        select(User.shop_name)
        .where(
            User.organization_id == organization_id,
            User.role == UserRole.TENANT_ADMIN,
            User.shop_name.is_not(None),
            func.length(func.trim(User.shop_name)) > 0,
        )
        .order_by(User.created_at.desc(), User.id.desc())
        .limit(1)
    )
    if tenant_admin_shop_name:
        return tenant_admin_shop_name.strip()
    org = await db.get(Organization, organization_id)
    return org.name if org is not None else "Organization"


def org_filter_for_shop(organization_id: UUID):
    return Shop.organization_id == organization_id
