from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_super_admin_context
from app.db.session import get_platform_db
from app.schemas.admin import ShopRead
from app.schemas.super_admin.hard_delete import HardDeleteRequest
from app.services.super_admin import branches as branch_service

router = APIRouter()


@router.get("/organizations/{organization_id}/branches", response_model=list[ShopRead])
async def list_organization_branches(
    organization_id: UUID,
    db: AsyncSession = Depends(get_platform_db),
    ctx=Depends(get_super_admin_context),
) -> list[ShopRead]:
    return await branch_service.list_organization_branches(db, organization_id)


@router.post(
    "/organizations/{organization_id}/branches/{shop_id}/hard-delete",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def hard_delete_branch(
    organization_id: UUID,
    shop_id: UUID,
    payload: HardDeleteRequest,
    request: Request,
    db: AsyncSession = Depends(get_platform_db),
    ctx=Depends(get_super_admin_context),
) -> Response:
    client_ip = request.client.host if request.client else None
    await branch_service.hard_delete_branch(
        db,
        organization_id,
        shop_id,
        payload,
        ctx.actor,
        client_ip=client_ip,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
