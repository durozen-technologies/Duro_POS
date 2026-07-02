from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_super_admin_context
from app.db.session import get_platform_db
from app.schemas.super_admin.hard_delete import HardDeleteRequest
from app.schemas.super_admin.organizations import (
    AdminRoleRead,
    OrganizationCounts,
    OrganizationCreate,
    OrganizationRead,
    OrganizationRowsPage,
    OrganizationStatusUpdate,
    OrganizationUpdate,
)
from app.services.super_admin import organizations as org_service

router = APIRouter()


@router.post("/organizations", response_model=OrganizationRead, status_code=201)
async def create_organization(
    payload: OrganizationCreate,
    db: AsyncSession = Depends(get_platform_db),
    ctx=Depends(get_super_admin_context),
) -> OrganizationRead:
    return await org_service.create_organization(db, payload, ctx.actor)


@router.get("/organizations/rows", response_model=OrganizationRowsPage)
async def list_organization_rows(
    db: AsyncSession = Depends(get_platform_db),
    ctx=Depends(get_super_admin_context),
    limit: int = Query(50, ge=1, le=100),
    cursor_created_at: datetime | None = None,
    cursor_id: UUID | None = None,
    q: str | None = None,
    active: bool | None = None,
) -> OrganizationRowsPage:
    return await org_service.list_organization_rows(
        db,
        limit=limit,
        cursor_created_at=cursor_created_at,
        cursor_id=cursor_id,
        q=q,
        active=active,
    )


@router.get("/organizations/counts", response_model=OrganizationCounts)
async def organization_counts(
    db: AsyncSession = Depends(get_platform_db),
    ctx=Depends(get_super_admin_context),
) -> OrganizationCounts:
    return await org_service.count_organizations(db)


@router.get("/organizations/{organization_id}/admin-roles", response_model=list[AdminRoleRead])
async def list_organization_admin_roles(
    organization_id: UUID,
    db: AsyncSession = Depends(get_platform_db),
    ctx=Depends(get_super_admin_context),
) -> list[AdminRoleRead]:
    return await org_service.list_organization_admin_roles(db, organization_id)


@router.patch("/organizations/{organization_id}", response_model=OrganizationRead)
async def update_organization(
    organization_id: UUID,
    payload: OrganizationUpdate,
    db: AsyncSession = Depends(get_platform_db),
    ctx=Depends(get_super_admin_context),
) -> OrganizationRead:
    return await org_service.update_organization(db, organization_id, payload, ctx.actor)


@router.patch("/organizations/{organization_id}/status", response_model=OrganizationRead)
async def update_organization_status(
    organization_id: UUID,
    payload: OrganizationStatusUpdate,
    db: AsyncSession = Depends(get_platform_db),
    ctx=Depends(get_super_admin_context),
) -> OrganizationRead:
    return await org_service.set_organization_status(
        db, organization_id, is_active=payload.is_active, actor=ctx.actor
    )


@router.post(
    "/organizations/{organization_id}/hard-delete",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def hard_delete_organization(
    organization_id: UUID,
    payload: HardDeleteRequest,
    request: Request,
    db: AsyncSession = Depends(get_platform_db),
    ctx=Depends(get_super_admin_context),
) -> Response:
    client_ip = request.client.host if request.client else None
    await org_service.hard_delete_organization(
        db,
        organization_id,
        payload,
        ctx.actor,
        client_ip=client_ip,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
