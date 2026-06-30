"""Super Admin API routes."""

from fastapi import APIRouter, Depends

from app.auth import get_super_admin_context
from app.routers.super_admin import audit, organizations, tenant_admins

router = APIRouter(
    tags=["Super Admin"],
    dependencies=[Depends(get_super_admin_context)],
)

router.include_router(organizations.router)
router.include_router(tenant_admins.router)
router.include_router(audit.router)
