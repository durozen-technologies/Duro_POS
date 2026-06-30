from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_super_admin_context
from app.db.database import get_db
from app.schemas.super_admin.tenant_admins import (
    TenantAdminCounts,
    TenantAdminCreate,
    TenantAdminPasswordReset,
    TenantAdminRead,
    TenantAdminRolesUpdate,
    TenantAdminRowsPage,
    TenantAdminStatusUpdate,
)
from app.services.super_admin import tenant_admins as tenant_admin_service

router = APIRouter()


@router.post("/tenant-admins", response_model=TenantAdminRead, status_code=201)
async def create_tenant_admin(
    payload: TenantAdminCreate,
    db: AsyncSession = Depends(get_db),
    ctx=Depends(get_super_admin_context),
) -> TenantAdminRead:
    return await tenant_admin_service.create_tenant_admin(db, payload, ctx.actor)


@router.get("/tenant-admins/rows", response_model=TenantAdminRowsPage)
async def list_tenant_admin_rows(
    db: AsyncSession = Depends(get_db),
    ctx=Depends(get_super_admin_context),
    limit: int = Query(50, ge=1, le=100),
    cursor_created_at: datetime | None = None,
    cursor_id: UUID | None = None,
    organization_id: UUID | None = None,
    q: str | None = None,
    active: bool | None = None,
) -> TenantAdminRowsPage:
    return await tenant_admin_service.list_tenant_admin_rows(
        db,
        limit=limit,
        cursor_created_at=cursor_created_at,
        cursor_id=cursor_id,
        organization_id=organization_id,
        q=q,
        active=active,
    )


@router.get("/tenant-admins/counts", response_model=TenantAdminCounts)
async def tenant_admin_counts(
    db: AsyncSession = Depends(get_db),
    ctx=Depends(get_super_admin_context),
    organization_id: UUID | None = None,
) -> TenantAdminCounts:
    return await tenant_admin_service.count_tenant_admins(db, organization_id=organization_id)


@router.get("/tenant-admins/{user_id}", response_model=TenantAdminRead)
async def get_tenant_admin(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx=Depends(get_super_admin_context),
) -> TenantAdminRead:
    return await tenant_admin_service.get_tenant_admin(db, user_id)


@router.delete("/tenant-admins/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tenant_admin(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx=Depends(get_super_admin_context),
) -> Response:
    await tenant_admin_service.delete_tenant_admin(db, user_id, ctx.actor)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/tenant-admins/{user_id}/status", response_model=TenantAdminRead)
async def update_tenant_admin_status(
    user_id: UUID,
    payload: TenantAdminStatusUpdate,
    db: AsyncSession = Depends(get_db),
    ctx=Depends(get_super_admin_context),
) -> TenantAdminRead:
    return await tenant_admin_service.set_tenant_admin_status(
        db, user_id, is_active=payload.is_active, actor=ctx.actor
    )


@router.put("/tenant-admins/{user_id}/roles", response_model=TenantAdminRead)
async def update_tenant_admin_roles(
    user_id: UUID,
    payload: TenantAdminRolesUpdate,
    db: AsyncSession = Depends(get_db),
    ctx=Depends(get_super_admin_context),
) -> TenantAdminRead:
    return await tenant_admin_service.update_tenant_admin_roles(
        db, user_id, payload.role_ids, ctx.actor
    )


@router.post("/tenant-admins/{user_id}/reset-password", response_model=TenantAdminRead)
async def reset_tenant_admin_password(
    user_id: UUID,
    payload: TenantAdminPasswordReset,
    db: AsyncSession = Depends(get_db),
    ctx=Depends(get_super_admin_context),
) -> TenantAdminRead:
    return await tenant_admin_service.reset_tenant_admin_password(
        db, user_id, payload.password, ctx.actor
    )
