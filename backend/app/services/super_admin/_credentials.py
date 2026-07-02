from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import verify_password
from app.models import User, UserRole
from app.schemas.auth import normalize_username


async def verify_super_admin_credentials(
    db: AsyncSession,
    actor: User,
    *,
    username: str,
    password: str,
) -> None:
    normalized = normalize_username(username)
    if normalized != normalize_username(actor.username):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid super admin credentials",
        )

    super_user = await db.scalar(
        select(User).where(
            User.id == actor.id,
            User.role == UserRole.SUPER_ADMIN,
            User.organization_id.is_(None),
        )
    )
    if super_user is None or not verify_password(password, super_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid super admin credentials",
        )
