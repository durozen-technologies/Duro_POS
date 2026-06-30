"""Tenant-scoped query helpers."""

from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Organization, Shop, User

DEFAULT_ORG_SLUG = "default"


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
    default_org_id = await db.scalar(
        select(Organization.id).where(Organization.slug == DEFAULT_ORG_SLUG)
    )
    if default_org_id is not None:
        return default_org_id
    first_org_id = await db.scalar(select(Organization.id).order_by(Organization.created_at).limit(1))
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
    if shop is None or shop.organization_id != organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shop not found")
    return shop


def org_filter_for_shop(organization_id: UUID):
    return Shop.organization_id == organization_id
