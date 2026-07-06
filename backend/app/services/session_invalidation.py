"""Invalidate outstanding JWTs by bumping permissions_version."""

from __future__ import annotations

from app.core.redis_cache import evict_user_permission_cache
from app.models import User


async def invalidate_user_sessions(user: User) -> None:
    await evict_user_permission_cache(user.id, user.permissions_version)
    user.permissions_version += 1
