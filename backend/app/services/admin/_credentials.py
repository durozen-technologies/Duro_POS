from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import verify_password
from app.models import User, UserRole
from app.schemas.auth import normalize_username


async def verify_tenant_admin_credentials(
    db: AsyncSession,
    actor: User,
    *,
    username: str,
    password: str,
) -> None:
    """Re-auth the current tenant admin before irreversible admin actions."""
    normalized = normalize_username(username)
    if normalized != normalize_username(actor.username):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid tenant admin credentials",
        )

    admin = await db.scalar(
        select(User).where(
            User.id == actor.id,
            User.role == UserRole.TENANT_ADMIN,
            User.is_active.is_(True),
        )
    )
    if admin is None or not verify_password(password, admin.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid tenant admin credentials",
        )
