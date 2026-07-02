"""Maintain platform user_auth_index for tenant login routing."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.ids import uuid7
from app.db.tenant_schema import tenant_router
from app.models import User, UserAuthIndex
from app.schemas.auth import normalize_username


class UsernameTakenError(ValueError):
    """Raised when a username is already registered globally."""


async def username_is_globally_taken(
    db: AsyncSession,
    username: str,
    *,
    exclude_user_id: UUID | None = None,
) -> bool:
    username_lower = normalize_username(username)

    auth_q = select(UserAuthIndex.id).where(UserAuthIndex.username_lower == username_lower)
    if exclude_user_id is not None:
        auth_q = auth_q.where(UserAuthIndex.user_id != exclude_user_id)
    if await db.scalar(auth_q):
        return True

    platform_q = select(User.id).where(
        func.lower(User.username) == username_lower,
        User.organization_id.is_(None),
    )
    if exclude_user_id is not None:
        platform_q = platform_q.where(User.id != exclude_user_id)
    return await db.scalar(platform_q) is not None


async def upsert_auth_index(
    db: AsyncSession,
    *,
    user: User,
    schema_name: str | None = None,
) -> None:
    if user.organization_id is None:
        return
    if schema_name is None:
        schema_name = await tenant_router.resolve_schema(db, user.organization_id)
    if not schema_name:
        raise UsernameTakenError(
            f"No tenant schema for organization {user.organization_id}"
        )

    username_lower = normalize_username(user.username)
    if await username_is_globally_taken(db, user.username, exclude_user_id=user.id):
        raise UsernameTakenError(user.username)

    row = await db.scalar(select(UserAuthIndex).where(UserAuthIndex.user_id == user.id))
    if row is None:
        db.add(
            UserAuthIndex(
                id=uuid7(),
                username_lower=username_lower,
                organization_id=user.organization_id,
                schema_name=schema_name,
                user_id=user.id,
            )
        )
    else:
        row.username_lower = username_lower
        row.organization_id = user.organization_id
        row.schema_name = schema_name


async def delete_auth_index(
    db: AsyncSession,
    *,
    user_id: UUID | None = None,
    organization_id: UUID | None = None,
    username_lower: str | None = None,
) -> None:
    if user_id is None and organization_id is None and username_lower is None:
        return
    stmt = delete(UserAuthIndex)
    if user_id is not None:
        stmt = stmt.where(UserAuthIndex.user_id == user_id)
    elif organization_id is not None and username_lower is not None:
        stmt = stmt.where(
            UserAuthIndex.organization_id == organization_id,
            UserAuthIndex.username_lower == username_lower,
        )
    elif organization_id is not None:
        stmt = stmt.where(UserAuthIndex.organization_id == organization_id)
    elif username_lower is not None:
        stmt = stmt.where(UserAuthIndex.username_lower == username_lower)
    await db.execute(stmt)


if __name__ == "__main__":
    assert normalize_username("Admin") == "admin"
    print("user_auth_index self-check ok")
