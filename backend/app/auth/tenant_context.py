from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_active_user
from app.core.errors import ORGANIZATION_DISABLED_BY_SUPER_ADMIN
from app.core.redis_cache import (
    cache_get_json,
    cache_set_json,
    permission_cache_key,
)
from app.db.session import get_platform_db
from app.db.tenant_context_var import reset_active_tenant_schema, set_active_tenant_schema
from app.db.tenant_schema import set_search_path, tenant_router
from app.models import AdminRolePermission, AdminUserRole, Organization, User, UserRole
from app.models.enums import is_super_admin, is_tenant_admin, normalize_user_role


@dataclass(frozen=True)
class TenantContext:
    actor: User
    organization_id: UUID | None
    permissions: frozenset[str]
    is_super_admin: bool
    schema_name: str | None = None

    def require_organization_id(self) -> UUID:
        if self.organization_id is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Organization context is required",
            )
        return self.organization_id


async def load_user_permissions(db: AsyncSession, user: User) -> frozenset[str]:
    if is_super_admin(user.role):
        return frozenset({"*"})

    if not is_tenant_admin(user.role):
        return frozenset()

    cache_key = permission_cache_key(str(user.id), user.permissions_version)
    cached = await cache_get_json(cache_key)
    if isinstance(cached, list):
        return frozenset(str(code) for code in cached)

    result = await db.scalars(
        select(AdminRolePermission.permission_code)
        .join(AdminUserRole, AdminUserRole.role_id == AdminRolePermission.role_id)
        .where(AdminUserRole.user_id == user.id)
    )
    permissions = frozenset(result.all())
    await cache_set_json(cache_key, sorted(permissions), ttl_seconds=90)
    return permissions


async def get_tenant_context(
    current_user: User = Depends(get_current_active_user),
    platform_db: AsyncSession = Depends(get_platform_db),
) -> TenantContext:
    org_id = current_user.organization_id
    schema_name = None
    if org_id is not None:
        schema_name = await tenant_router.resolve_schema(platform_db, org_id)
        if schema_name is None and is_tenant_admin(current_user.role):
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Tenant schema is not configured for this organization",
            )

    if schema_name:
        token = set_active_tenant_schema(schema_name)
        try:
            await set_search_path(platform_db, schema_name)
            permissions = await load_user_permissions(platform_db, current_user)
        finally:
            reset_active_tenant_schema(token)
    else:
        permissions = await load_user_permissions(platform_db, current_user)

    return TenantContext(
        actor=current_user,
        organization_id=org_id,
        permissions=permissions,
        is_super_admin=is_super_admin(current_user.role),
        schema_name=schema_name,
    )


async def get_super_admin_context(
    current_user: User = Depends(get_current_active_user),
) -> TenantContext:
    if not is_super_admin(current_user.role):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions",
        )
    return TenantContext(
        actor=current_user,
        organization_id=None,
        permissions=frozenset({"*"}),
        is_super_admin=True,
    )


def user_has_permission(ctx: TenantContext, code: str) -> bool:
    if ctx.is_super_admin or "*" in ctx.permissions:
        return True
    return code in ctx.permissions


def require_permission(code: str):
    async def dependency(ctx: TenantContext = Depends(get_tenant_context)) -> TenantContext:
        if not user_has_permission(ctx, code):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return ctx

    return dependency


async def ensure_organization_active(
    db: AsyncSession,
    organization_id: UUID | None,
) -> None:
    if organization_id is None:
        return
    org = await db.get(Organization, organization_id)
    if org is None or not org.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ORGANIZATION_DISABLED_BY_SUPER_ADMIN,
        )


def session_role_for_user(user: User) -> UserRole:
    return normalize_user_role(user.role)
