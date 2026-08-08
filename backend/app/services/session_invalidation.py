"""Invalidate outstanding JWTs by bumping permissions_version."""

from __future__ import annotations

from app.models import User


async def invalidate_user_sessions(user: User) -> None:
    user.permissions_version += 1
