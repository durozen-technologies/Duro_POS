"""Tenant schema resolution for WhatsApp Bot (Postgres schema-per-tenant)."""

from __future__ import annotations

from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import TypeVar
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.db.tenant_schema import assert_safe_schema_name, set_search_path
from backend.app.models import Organization, Shop

T = TypeVar("T")


async def list_active_tenant_schemas(session: AsyncSession) -> list[str]:
    rows = await session.scalars(
        select(Organization.schema_name).where(
            Organization.schema_name.isnot(None),
            Organization.is_active.is_(True),
        )
    )
    return [name for name in rows.all() if name]


async def resolve_schema_for_shop(session: AsyncSession, shop_id: UUID) -> str | None:
    await set_search_path(session, None)
    for schema_name in await list_active_tenant_schemas(session):
        safe = assert_safe_schema_name(schema_name)
        await set_search_path(session, safe)
        shop = await session.get(Shop, shop_id)
        if shop is not None:
            return safe
    return None


async def resolve_schema_for_whatsapp_phone(session: AsyncSession, phone_number: str) -> str | None:
    from backend.app.models import WhatsAppUser

    await set_search_path(session, None)
    for schema_name in await list_active_tenant_schemas(session):
        safe = assert_safe_schema_name(schema_name)
        await set_search_path(session, safe)
        found = await session.scalar(
            select(WhatsAppUser.id).where(
                WhatsAppUser.phone_number == phone_number,
                WhatsAppUser.is_active.is_(True),
            )
        )
        if found is not None:
            return safe
    return None


@asynccontextmanager
async def tenant_session_for_shop(
    session: AsyncSession,
    shop_id: UUID,
) -> AsyncGenerator[str, None]:
    schema_name = await resolve_schema_for_shop(session, shop_id)
    if schema_name is None:
        raise LookupError(f"No tenant schema contains shop {shop_id}")
    await set_search_path(session, schema_name)
    try:
        yield schema_name
    finally:
        await set_search_path(session, None)


async def with_tenant_for_shop(
    session: AsyncSession,
    shop_id: UUID,
    callback: Callable[[AsyncSession], Awaitable[T]],
) -> T:
    async with tenant_session_for_shop(session, shop_id):
        return await callback(session)


async def list_shops_across_tenants(session: AsyncSession) -> list[Shop]:
    """Aggregate active shops from all tenant schemas."""
    await set_search_path(session, None)
    shops: list[Shop] = []
    for schema_name in await list_active_tenant_schemas(session):
        safe = assert_safe_schema_name(schema_name)
        await set_search_path(session, safe)
        result = await session.scalars(
            select(Shop).where(Shop.is_active.is_(True)).order_by(Shop.name.asc())
        )
        shops.extend(result.all())
    shops.sort(key=lambda shop: shop.name.lower())
    return shops
