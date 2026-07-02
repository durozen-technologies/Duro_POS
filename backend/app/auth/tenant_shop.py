"""Tenant-scoped shop lookups (no lazy ORM relationships)."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Shop, User, UserRole


async def shop_for_user(db: AsyncSession, user: User) -> Shop | None:
    if user.role != UserRole.SHOP_ACCOUNT:
        return None
    return await db.scalar(select(Shop).where(Shop.owner_user_id == user.id))
