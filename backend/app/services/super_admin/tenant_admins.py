from __future__ import annotations

import logging
from datetime import datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import log_event
from app.core.security import get_password_hash
from app.services.session_invalidation import invalidate_user_sessions
from app.db.tenant_schema import tenant_schema_scope
from app.models import AdminRole, AdminUserRole, Organization, Shop, User, UserAuthIndex, UserRole
from app.schemas.auth import normalize_username
from app.schemas.super_admin.hard_delete import HardDeleteRequest
from app.schemas.super_admin.tenant_admins import (
    TenantAdminCounts,
    TenantAdminCreate,
    TenantAdminRead,
    TenantAdminRowsPage,
)
from app.services.super_admin._audit import record_hard_delete_audit, record_super_admin_audit
from app.services.super_admin._credentials import verify_super_admin_credentials
from app.services.super_admin.organizations import get_organization_or_404
from app.services.user_auth_index import (
    delete_auth_index,
    upsert_auth_index,
    username_is_globally_taken,
)

logger = logging.getLogger(__name__)


async def _bump_permission_version(user: User) -> None:
    await invalidate_user_sessions(user)


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


async def _default_tenant_role_id(db: AsyncSession, organization_id: UUID) -> UUID | None:
    return await db.scalar(
        select(AdminRole.id).where(
            AdminRole.organization_id == organization_id,
            AdminRole.name == "TenantFullAdmin",
        )
    )


async def _require_org_schema(platform_db: AsyncSession, org: Organization) -> str:
    if not org.schema_name:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Organization has no tenant schema",
        )
    return org.schema_name


async def _auth_entry_for_user(
    platform_db: AsyncSession,
    user_id: UUID,
) -> UserAuthIndex | None:
    return await platform_db.scalar(select(UserAuthIndex).where(UserAuthIndex.user_id == user_id))


async def _tenant_admin_read(
    tenant_db: AsyncSession,
    user: User,
    org_name: str,
) -> TenantAdminRead:
    role_ids = await _role_ids_for_user(tenant_db, user.id)
    return _tenant_admin_to_read(user, org_name, role_ids)


async def _list_tenant_admins_in_schema(
    tenant_db: AsyncSession,
    *,
    org: Organization,
    limit: int,
    cursor_created_at: datetime | None,
    cursor_id: UUID | None,
    q: str | None,
    active: bool | None,
) -> list[TenantAdminRead]:
    filters = [User.role == UserRole.TENANT_ADMIN, User.organization_id == org.id]
    if q and q.strip():
        filters.append(func.lower(User.username).like(f"%{q.strip().lower()}%"))
    if active is not None:
        filters.append(User.is_active.is_(active))
    cursor = _cursor_filter(User, cursor_created_at, cursor_id)
    if cursor is not None:
        filters.append(cursor)

    rows = (
        await tenant_db.scalars(
            select(User)
            .where(*filters)
            .order_by(User.created_at.desc(), User.id.desc())
            .limit(limit)
        )
    ).all()
    role_ids_by_user = await _role_ids_by_user_id(tenant_db, [user.id for user in rows])
    return [
        _tenant_admin_to_read(user, org.name, role_ids_by_user.get(user.id, [])) for user in rows
    ]


async def create_tenant_admin(
    platform_db: AsyncSession,
    payload: TenantAdminCreate,
    actor: User,
) -> TenantAdminRead:
    org = await get_organization_or_404(platform_db, payload.organization_id)
    schema_name = await _require_org_schema(platform_db, org)
    username = normalize_username(payload.username)

    if await username_is_globally_taken(platform_db, username):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")

    async with tenant_schema_scope(platform_db, schema_name):
        user = User(
            username=username,
            password_hash=get_password_hash(payload.password),
            role=UserRole.TENANT_ADMIN,
            organization_id=org.id,
            is_active=True,
        )
        platform_db.add(user)
        await platform_db.flush()

        role_ids = list(payload.role_ids)
        if not role_ids:
            default_role_id = await _default_tenant_role_id(platform_db, org.id)
            if default_role_id is not None:
                role_ids = [default_role_id]

        for role_id in role_ids:
            role = await platform_db.scalar(
                select(AdminRole.id).where(
                    AdminRole.id == role_id,
                    AdminRole.organization_id == org.id,
                )
            )
            if role is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
            platform_db.add(AdminUserRole(user_id=user.id, role_id=role_id))

        await _bump_permission_version(user)
        await upsert_auth_index(platform_db, user=user, schema_name=schema_name)
        await platform_db.flush()
        await record_super_admin_audit(
            platform_db,
            actor=actor,
            action="tenant_admin.created",
            entity_type="user",
            entity_id=user.id,
            organization_id=org.id,
            details={"username": user.username},
        )
        await platform_db.commit()
        await platform_db.refresh(user)
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
    platform_db: AsyncSession,
    *,
    limit: int = 50,
    cursor_created_at: datetime | None = None,
    cursor_id: UUID | None = None,
    organization_id: UUID | None = None,
    q: str | None = None,
    active: bool | None = None,
) -> TenantAdminRowsPage:
    _require_full_cursor(cursor_created_at, cursor_id)

    if organization_id is not None:
        org = await get_organization_or_404(platform_db, organization_id)
        if not org.schema_name:
            return TenantAdminRowsPage(items=[], limit=limit, has_more=False)
        async with tenant_schema_scope(platform_db, org.schema_name):
            items = await _list_tenant_admins_in_schema(
                platform_db,
                org=org,
                limit=limit + 1,
                cursor_created_at=cursor_created_at,
                cursor_id=cursor_id,
                q=q,
                active=active,
            )
        page_rows = items[:limit]
        has_more = len(items) > limit
        next_created_at = next_id = None
        if has_more and page_rows:
            last = page_rows[-1]
            next_created_at = last.created_at
            next_id = last.id
        return TenantAdminRowsPage(
            items=page_rows,
            limit=limit,
            has_more=has_more,
            next_cursor_created_at=next_created_at,
            next_cursor_id=next_id,
        )

    # ponytail: fan-out across tenant schemas; acceptable for super-admin list scale
    orgs = list(
        await platform_db.scalars(
            select(Organization)
            .where(Organization.schema_name.isnot(None))
            .order_by(Organization.created_at.desc())
        )
    )
    merged: list[TenantAdminRead] = []
    for org in orgs:
        async with tenant_schema_scope(platform_db, org.schema_name):
            merged.extend(
                await _list_tenant_admins_in_schema(
                    platform_db,
                    org=org,
                    limit=10_000,
                    cursor_created_at=None,
                    cursor_id=None,
                    q=q,
                    active=active,
                )
            )
    merged.sort(key=lambda row: (row.created_at, row.id), reverse=True)

    if cursor_created_at is not None and cursor_id is not None:
        merged = [
            row for row in merged if (row.created_at, row.id) < (cursor_created_at, cursor_id)
        ]

    page_rows = merged[:limit]
    has_more = len(merged) > limit
    next_created_at = next_id = None
    if has_more and page_rows:
        last = page_rows[-1]
        next_created_at = last.created_at
        next_id = last.id
    return TenantAdminRowsPage(
        items=page_rows,
        limit=limit,
        has_more=has_more,
        next_cursor_created_at=next_created_at,
        next_cursor_id=next_id,
    )


async def count_tenant_admins(
    platform_db: AsyncSession,
    *,
    organization_id: UUID | None = None,
) -> TenantAdminCounts:
    async def _count_in_schema(tenant_db: AsyncSession, org_id: UUID) -> tuple[int, int]:
        filters = [User.role == UserRole.TENANT_ADMIN, User.organization_id == org_id]
        total = int(await tenant_db.scalar(select(func.count(User.id)).where(*filters)) or 0)
        active = int(
            await tenant_db.scalar(
                select(func.count(User.id)).where(*filters, User.is_active.is_(True))
            )
            or 0
        )
        return total, active

    if organization_id is not None:
        org = await get_organization_or_404(platform_db, organization_id)
        if not org.schema_name:
            return TenantAdminCounts(all=0, active=0, inactive=0)
        async with tenant_schema_scope(platform_db, org.schema_name):
            total, active = await _count_in_schema(platform_db, org.id)
        return TenantAdminCounts(all=total, active=active, inactive=total - active)

    orgs = list(
        await platform_db.scalars(select(Organization).where(Organization.schema_name.isnot(None)))
    )
    total = active = 0
    for org in orgs:
        async with tenant_schema_scope(platform_db, org.schema_name):
            org_total, org_active = await _count_in_schema(platform_db, org.id)
        total += org_total
        active += org_active
    return TenantAdminCounts(all=total, active=active, inactive=total - active)


async def _load_tenant_admin_in_schema(
    platform_db: AsyncSession,
    *,
    schema_name: str,
    user_id: UUID,
) -> User:
    async with tenant_schema_scope(platform_db, schema_name):
        user = await platform_db.scalar(
            select(User).where(
                User.id == user_id,
                User.role == UserRole.TENANT_ADMIN,
            )
        )
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant admin not found")
    return user


async def get_tenant_admin_or_404(platform_db: AsyncSession, user_id: UUID) -> User:
    entry = await _auth_entry_for_user(platform_db, user_id)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant admin not found")
    return await _load_tenant_admin_in_schema(
        platform_db,
        schema_name=entry.schema_name,
        user_id=user_id,
    )


async def get_tenant_admin(platform_db: AsyncSession, user_id: UUID) -> TenantAdminRead:
    entry = await _auth_entry_for_user(platform_db, user_id)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant admin not found")
    org = await get_organization_or_404(platform_db, entry.organization_id)
    async with tenant_schema_scope(platform_db, entry.schema_name):
        user = await platform_db.scalar(select(User).where(User.id == user_id))
        if user is None or user.role != UserRole.TENANT_ADMIN:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Tenant admin not found"
            )
        return await _tenant_admin_read(platform_db, user, org.name)


async def hard_delete_tenant_admin(
    platform_db: AsyncSession,
    user_id: UUID,
    payload: HardDeleteRequest,
    actor: User,
    *,
    client_ip: str | None = None,
) -> None:
    entry = await _auth_entry_for_user(platform_db, user_id)
    resource_name = str(user_id)
    organization_id: UUID | None = None

    try:
        await verify_super_admin_credentials(
            platform_db,
            actor,
            username=payload.username,
            password=payload.password,
        )

        if entry is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Tenant admin not found"
            )

        async with tenant_schema_scope(platform_db, entry.schema_name):
            user = await platform_db.scalar(select(User).where(User.id == user_id))
            if user is None or user.role != UserRole.TENANT_ADMIN:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="Tenant admin not found"
                )

            owns_shop = await platform_db.scalar(
                select(Shop.id).where(Shop.owner_user_id == user.id)
            )
            if owns_shop is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Cannot delete a tenant admin that owns a branch",
                )

            resource_name = user.username
            organization_id = user.organization_id
            await evict_user_permission_cache(user.id, user.permissions_version)
            await platform_db.delete(user)
            # Flush tenant-side relationship work before search_path resets to public.
            await platform_db.flush()

        await delete_auth_index(platform_db, user_id=user_id)
        await record_hard_delete_audit(
            platform_db,
            actor=actor,
            action="tenant_admin.hard_delete",
            entity_type="user",
            entity_id=user_id,
            organization_id=organization_id,
            resource_name=resource_name,
            result="success",
            client_ip=client_ip,
        )
        await platform_db.commit()
        log_event(
            logger,
            logging.INFO,
            "tenant_admin_hard_deleted",
            "tenant admin hard deleted",
            user_id=str(user_id),
            org_id=str(organization_id) if organization_id else None,
        )
    except HTTPException as exc:
        await platform_db.rollback()
        await record_hard_delete_audit(
            platform_db,
            actor=actor,
            action="tenant_admin.hard_delete",
            entity_type="user",
            entity_id=user_id,
            organization_id=organization_id,
            resource_name=resource_name,
            result="failed",
            client_ip=client_ip,
            error=str(exc.detail),
        )
        await platform_db.commit()
        raise


async def delete_tenant_admin(platform_db: AsyncSession, user_id: UUID, actor: User) -> None:
    """Deprecated: use hard_delete_tenant_admin with credential verification."""
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="Use POST /tenant-admins/{user_id}/hard-delete with super admin credentials",
    )


async def set_tenant_admin_status(
    platform_db: AsyncSession,
    user_id: UUID,
    *,
    is_active: bool,
    actor: User,
) -> TenantAdminRead:
    entry = await _auth_entry_for_user(platform_db, user_id)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant admin not found")
    org = await get_organization_or_404(platform_db, entry.organization_id)

    async with tenant_schema_scope(platform_db, entry.schema_name):
        user = await platform_db.scalar(select(User).where(User.id == user_id))
        if user is None or user.role != UserRole.TENANT_ADMIN:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Tenant admin not found"
            )
        user.is_active = is_active
        await _bump_permission_version(user)
        await platform_db.flush()
        await record_super_admin_audit(
            platform_db,
            actor=actor,
            action="tenant_admin.status_updated",
            entity_type="user",
            entity_id=user.id,
            organization_id=user.organization_id,
            details={"is_active": is_active},
        )
        await platform_db.commit()
        await platform_db.refresh(user)
        return await _tenant_admin_read(platform_db, user, org.name)


async def update_tenant_admin_roles(
    platform_db: AsyncSession,
    user_id: UUID,
    role_ids: list[UUID],
    actor: User,
) -> TenantAdminRead:
    entry = await _auth_entry_for_user(platform_db, user_id)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant admin not found")
    org = await get_organization_or_404(platform_db, entry.organization_id)

    async with tenant_schema_scope(platform_db, entry.schema_name):
        user = await platform_db.scalar(select(User).where(User.id == user_id))
        if user is None or user.role != UserRole.TENANT_ADMIN:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Tenant admin not found"
            )
        if user.organization_id is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="User has no org"
            )

        for role_id in role_ids:
            found = await platform_db.scalar(
                select(AdminRole.id).where(
                    AdminRole.id == role_id,
                    AdminRole.organization_id == user.organization_id,
                )
            )
            if found is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")

        await platform_db.execute(delete(AdminUserRole).where(AdminUserRole.user_id == user.id))
        for role_id in role_ids:
            platform_db.add(AdminUserRole(user_id=user.id, role_id=role_id))
        await _bump_permission_version(user)
        await platform_db.flush()
        await record_super_admin_audit(
            platform_db,
            actor=actor,
            action="tenant_admin.roles_updated",
            entity_type="user",
            entity_id=user.id,
            organization_id=user.organization_id,
            details={"role_ids": [str(rid) for rid in role_ids]},
        )
        await platform_db.commit()
        await platform_db.refresh(user)
        return await _tenant_admin_read(platform_db, user, org.name)


async def reset_tenant_admin_password(
    platform_db: AsyncSession,
    user_id: UUID,
    password: str,
    actor: User,
) -> TenantAdminRead:
    entry = await _auth_entry_for_user(platform_db, user_id)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant admin not found")
    org = await get_organization_or_404(platform_db, entry.organization_id)

    async with tenant_schema_scope(platform_db, entry.schema_name):
        user = await platform_db.scalar(select(User).where(User.id == user_id))
        if user is None or user.role != UserRole.TENANT_ADMIN:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Tenant admin not found"
            )
        user.password_hash = get_password_hash(password)
        await _bump_permission_version(user)
        await platform_db.flush()
        await record_super_admin_audit(
            platform_db,
            actor=actor,
            action="tenant_admin.password_reset",
            entity_type="user",
            entity_id=user.id,
            organization_id=user.organization_id,
            details={},
        )
        await platform_db.commit()
        await platform_db.refresh(user)
        return await _tenant_admin_read(platform_db, user, org.name)
