from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import contains_eager

from app.core.logging import log_event
from app.db.tenant_schema import tenant_schema_scope
from app.models import Bill, DailyPrice, Shop, User
from app.schemas.admin import ShopRead
from app.schemas.super_admin.hard_delete import HardDeleteRequest
from app.services.super_admin._audit import record_hard_delete_audit
from app.services.super_admin._credentials import verify_super_admin_credentials
from app.services.super_admin.organizations import get_organization_or_404
from app.services.user_auth_index import delete_auth_index

logger = logging.getLogger(__name__)


@asynccontextmanager
async def _branch_scope(
    db: AsyncSession, schema_name: str | None
) -> AsyncIterator[None]:
    if schema_name:
        async with tenant_schema_scope(db, schema_name):
            yield
    else:
        yield


async def list_organization_branches(
    db: AsyncSession,
    organization_id: UUID,
) -> list[ShopRead]:
    org = await get_organization_or_404(db, organization_id)

    async def _fetch(session: AsyncSession) -> list[ShopRead]:
        rows = await session.execute(
            select(
                Shop.id,
                Shop.name,
                Shop.is_active,
                Shop.created_at,
                User.username,
                User.last_login_at,
            )
            .join(Shop.owner)
            .where(Shop.organization_id == organization_id)
            .order_by(Shop.name.asc())
        )
        return [
            ShopRead(
                id=row.id,
                name=row.name,
                is_active=row.is_active,
                created_at=row.created_at,
                username=row.username,
                last_active_at=row.last_login_at,
            )
            for row in rows
        ]

    async with _branch_scope(db, org.schema_name):
        return await _fetch(db)


async def _load_shop_for_delete(
    db: AsyncSession,
    *,
    organization_id: UUID,
    shop_id: UUID,
) -> Shop:
    result = await db.execute(
        select(Shop)
        .join(Shop.owner)
        .options(contains_eager(Shop.owner))
        .where(Shop.id == shop_id, Shop.organization_id == organization_id)
        .with_for_update()
    )
    shop = result.scalar_one_or_none()
    if shop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found")
    return shop


async def _assert_shop_can_be_deleted(db: AsyncSession, shop_id: UUID) -> None:
    existence_row = (
        await db.execute(
            select(
                select(Bill.id).where(Bill.shop_id == shop_id).exists().label("has_bills"),
                select(DailyPrice.id)
                .where(DailyPrice.shop_id == shop_id)
                .exists()
                .label("has_prices"),
            )
        )
    ).one()
    has_bills, has_prices = existence_row
    if has_bills:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete a branch that already has billing history",
        )
    if has_prices:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete a branch that already has price history",
        )


async def hard_delete_branch(
    platform_db: AsyncSession,
    organization_id: UUID,
    shop_id: UUID,
    payload: HardDeleteRequest,
    actor: User,
    *,
    client_ip: str | None = None,
) -> None:
    org = await get_organization_or_404(platform_db, organization_id)
    resource_name = str(shop_id)
    owner_username: str | None = None

    try:
        await verify_super_admin_credentials(
            platform_db,
            actor,
            username=payload.username,
            password=payload.password,
        )

        async with _branch_scope(platform_db, org.schema_name):
            shop = await _load_shop_for_delete(
                platform_db, organization_id=organization_id, shop_id=shop_id
            )
            resource_name = shop.name
            owner_username = shop.owner.username
            await _assert_shop_can_be_deleted(platform_db, shop_id)
            owner_id = shop.owner.id
            await platform_db.delete(shop)
            await platform_db.delete(shop.owner)
            await platform_db.flush()
            await delete_auth_index(platform_db, user_id=owner_id)

        await record_hard_delete_audit(
            platform_db,
            actor=actor,
            action="branch.hard_delete",
            entity_type="shop",
            entity_id=shop_id,
            organization_id=organization_id,
            resource_name=resource_name,
            result="success",
            client_ip=client_ip,
            extra={"branch_username": owner_username},
        )
        await platform_db.commit()
        log_event(
            logger,
            logging.INFO,
            "branch_hard_deleted",
            "branch hard deleted",
            shop_id=str(shop_id),
            org_id=str(organization_id),
        )
    except HTTPException as exc:
        await platform_db.rollback()
        await record_hard_delete_audit(
            platform_db,
            actor=actor,
            action="branch.hard_delete",
            entity_type="shop",
            entity_id=shop_id,
            organization_id=organization_id,
            resource_name=resource_name,
            result="failed",
            client_ip=client_ip,
            error=str(exc.detail),
        )
        await platform_db.commit()
        raise
