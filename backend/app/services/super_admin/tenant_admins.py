from __future__ import annotations

import logging
from datetime import datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.logging import log_event
from app.core.redis_cache import evict_user_permission_cache
from app.core.security import get_password_hash
from app.models import AdminRole, AdminUserRole, Shop, User, UserRole
from app.schemas.auth import normalize_username
from app.schemas.super_admin.tenant_admins import (
    TenantAdminCounts,
    TenantAdminCreate,
    TenantAdminRead,
    TenantAdminRowsPage,
)
from app.services.super_admin._audit import record_super_admin_audit
from app.services.super_admin.organizations import get_organization_or_404

logger = logging.getLogger(__name__)


async def _bump_permission_version(user: User) -> None:
    await evict_user_permission_cache(user.id, user.permissions_version)
    user.permissions_version += 1


def _tenant_admin_to_read(user: User, org_name: str, role_ids: list[UUID]) -> TenantAdminRead:
    return TenantAdminRead(
        id=user.id,
        username=user.username,
        role=user.role,
        organization_id=user.organization_id,
        organization_name=org_name,
        is_active=user.is_active,
        role_ids=role_ids,
        created_at=user.created_at,
        last_login_at=user.last_login_at,
    )


def _require_full_cursor(cursor_created_at: datetime | None, cursor_id: UUID | None) -> None:
    if (cursor_created_at is None) ^ (cursor_id is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="cursor_created_at and cursor_id must be supplied together",
        )


def _cursor_filter(model, cursor_created_at: datetime | None, cursor_id: UUID | None):
    if cursor_created_at is None:
        return None
    return or_(
        model.created_at < cursor_created_at,
        and_(model.created_at == cursor_created_at, model.id < cursor_id),
    )


async def _role_ids_for_user(db: AsyncSession, user_id: UUID) -> list[UUID]:
    return list(
        await db.scalars(select(AdminUserRole.role_id).where(AdminUserRole.user_id == user_id))
    )


async def _role_ids_by_user_id(db: AsyncSession, user_ids: list[UUID]) -> dict[UUID, list[UUID]]:
    if not user_ids:
        return {}
    rows = await db.execute(
        select(AdminUserRole.user_id, AdminUserRole.role_id).where(
            AdminUserRole.user_id.in_(user_ids)
        )
    )
    grouped: dict[UUID, list[UUID]] = {user_id: [] for user_id in user_ids}
    for user_id, role_id in rows.all():
        grouped[user_id].append(role_id)
    return grouped


async def _tenant_admin_read_for_user(db: AsyncSession, user: User) -> TenantAdminRead:
    role_ids = await _role_ids_for_user(db, user.id)
    org_name = user.organization.name if user.organization else ""
    return _tenant_admin_to_read(user, org_name, role_ids)


async def _default_tenant_role_id(db: AsyncSession, organization_id: UUID) -> UUID | None:
    return await db.scalar(
        select(AdminRole.id).where(
            AdminRole.organization_id == organization_id,
            AdminRole.name == "TenantFullAdmin",
        )
    )


async def create_tenant_admin(
    db: AsyncSession,
    payload: TenantAdminCreate,
    actor: User,
) -> TenantAdminRead:
    org = await get_organization_or_404(db, payload.organization_id)
    username = normalize_username(payload.username)

    existing = await db.scalar(
        select(User.id).where(
            func.lower(User.username) == username,
            User.organization_id == org.id,
        )
    )
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")

    user = User(
        username=username,
        password_hash=get_password_hash(payload.password),
        role=UserRole.TENANT_ADMIN,
        organization_id=org.id,
        is_active=True,
    )
    db.add(user)
    await db.flush()

    role_ids = list(payload.role_ids)
    if not role_ids:
        default_role_id = await _default_tenant_role_id(db, org.id)
        if default_role_id is not None:
            role_ids = [default_role_id]

    for role_id in role_ids:
        role = await db.scalar(
            select(AdminRole.id).where(
                AdminRole.id == role_id,
                AdminRole.organization_id == org.id,
            )
        )
        if role is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
        db.add(AdminUserRole(user_id=user.id, role_id=role_id))

    await _bump_permission_version(user)
    await record_super_admin_audit(
        db,
        actor=actor,
        action="tenant_admin.created",
        entity_type="user",
        entity_id=user.id,
        organization_id=org.id,
        details={"username": user.username},
    )
    await db.commit()
    await db.refresh(user)
    log_event(
        logger,
        logging.INFO,
        "tenant_admin_created",
        "tenant admin created",
        user_id=str(user.id),
        org_id=str(org.id),
    )
    return _tenant_admin_to_read(user, org.name, role_ids)


async def list_tenant_admin_rows(
    db: AsyncSession,
    *,
    limit: int = 50,
    cursor_created_at: datetime | None = None,
    cursor_id: UUID | None = None,
    organization_id: UUID | None = None,
    q: str | None = None,
    active: bool | None = None,
) -> TenantAdminRowsPage:
    _require_full_cursor(cursor_created_at, cursor_id)
    filters = [User.role == UserRole.TENANT_ADMIN]
    if organization_id is not None:
        filters.append(User.organization_id == organization_id)
    if q and q.strip():
        filters.append(func.lower(User.username).like(f"%{q.strip().lower()}%"))
    if active is not None:
        filters.append(User.is_active.is_(active))
    cursor = _cursor_filter(User, cursor_created_at, cursor_id)
    if cursor is not None:
        filters.append(cursor)

    rows = (
        await db.scalars(
            select(User)
            .options(selectinload(User.organization))
            .where(*filters)
            .order_by(User.created_at.desc(), User.id.desc())
            .limit(limit + 1)
        )
    ).all()
    page_rows = rows[:limit]
    role_ids_by_user = await _role_ids_by_user_id(db, [user.id for user in page_rows])
    items: list[TenantAdminRead] = []
    for user in page_rows:
        org_name = user.organization.name if user.organization else ""
        items.append(_tenant_admin_to_read(user, org_name, role_ids_by_user.get(user.id, [])))

    next_created_at = next_id = None
    if len(rows) > limit and page_rows:
        last = page_rows[-1]
        next_created_at = last.created_at
        next_id = last.id
    return TenantAdminRowsPage(
        items=items,
        limit=limit,
        has_more=len(rows) > limit,
        next_cursor_created_at=next_created_at,
        next_cursor_id=next_id,
    )


async def count_tenant_admins(
    db: AsyncSession,
    *,
    organization_id: UUID | None = None,
) -> TenantAdminCounts:
    filters = [User.role == UserRole.TENANT_ADMIN]
    if organization_id is not None:
        filters.append(User.organization_id == organization_id)
    total = int(await db.scalar(select(func.count(User.id)).where(*filters)) or 0)
    active = int(
        await db.scalar(select(func.count(User.id)).where(*filters, User.is_active.is_(True))) or 0
    )
    return TenantAdminCounts(all=total, active=active, inactive=total - active)


async def get_tenant_admin_or_404(db: AsyncSession, user_id: UUID) -> User:
    user = await db.scalar(
        select(User)
        .options(selectinload(User.organization))
        .where(
            User.id == user_id,
            User.role == UserRole.TENANT_ADMIN,
        )
    )
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant admin not found")
    return user


async def get_tenant_admin(db: AsyncSession, user_id: UUID) -> TenantAdminRead:
    user = await get_tenant_admin_or_404(db, user_id)
    return await _tenant_admin_read_for_user(db, user)


async def delete_tenant_admin(db: AsyncSession, user_id: UUID, actor: User) -> None:
    user = await get_tenant_admin_or_404(db, user_id)
    owns_shop = await db.scalar(select(Shop.id).where(Shop.owner_user_id == user.id))
    if owns_shop is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete a tenant admin that owns a shop",
        )

    username = user.username
    organization_id = user.organization_id
    await evict_user_permission_cache(user.id, user.permissions_version)
    await record_super_admin_audit(
        db,
        actor=actor,
        action="tenant_admin.deleted",
        entity_type="user",
        entity_id=user.id,
        organization_id=organization_id,
        details={"username": username},
    )
    await db.delete(user)
    await db.commit()
    log_event(
        logger,
        logging.INFO,
        "tenant_admin_deleted",
        "tenant admin deleted",
        user_id=str(user_id),
        org_id=str(organization_id) if organization_id else None,
    )


async def set_tenant_admin_status(
    db: AsyncSession,
    user_id: UUID,
    *,
    is_active: bool,
    actor: User,
) -> TenantAdminRead:
    user = await get_tenant_admin_or_404(db, user_id)
    user.is_active = is_active
    await _bump_permission_version(user)
    await record_super_admin_audit(
        db,
        actor=actor,
        action="tenant_admin.status_updated",
        entity_type="user",
        entity_id=user.id,
        organization_id=user.organization_id,
        details={"is_active": is_active},
    )
    await db.commit()
    await db.refresh(user)
    return await _tenant_admin_read_for_user(db, user)


async def update_tenant_admin_roles(
    db: AsyncSession,
    user_id: UUID,
    role_ids: list[UUID],
    actor: User,
) -> TenantAdminRead:
    user = await get_tenant_admin_or_404(db, user_id)
    if user.organization_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="User has no org"
        )

    for role_id in role_ids:
        found = await db.scalar(
            select(AdminRole.id).where(
                AdminRole.id == role_id,
                AdminRole.organization_id == user.organization_id,
            )
        )
        if found is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")

    await db.execute(delete(AdminUserRole).where(AdminUserRole.user_id == user.id))
    for role_id in role_ids:
        db.add(AdminUserRole(user_id=user.id, role_id=role_id))
    await _bump_permission_version(user)
    await record_super_admin_audit(
        db,
        actor=actor,
        action="tenant_admin.roles_updated",
        entity_type="user",
        entity_id=user.id,
        organization_id=user.organization_id,
        details={"role_ids": [str(rid) for rid in role_ids]},
    )
    await db.commit()
    await db.refresh(user)
    return await _tenant_admin_read_for_user(db, user)


async def reset_tenant_admin_password(
    db: AsyncSession,
    user_id: UUID,
    password: str,
    actor: User,
) -> TenantAdminRead:
    user = await get_tenant_admin_or_404(db, user_id)
    user.password_hash = get_password_hash(password)
    await _bump_permission_version(user)
    await record_super_admin_audit(
        db,
        actor=actor,
        action="tenant_admin.password_reset",
        entity_type="user",
        entity_id=user.id,
        organization_id=user.organization_id,
        details={},
    )
    await db.commit()
    await db.refresh(user)
    return await _tenant_admin_read_for_user(db, user)
