from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_super_admin_context
from app.db.database import get_db
from app.schemas.super_admin.audit import AuditLogRowsPage
from app.services.super_admin import audit as audit_service

router = APIRouter()


@router.get("/audit-logs/rows", response_model=AuditLogRowsPage)
async def list_audit_log_rows(
    db: AsyncSession = Depends(get_db),
    ctx=Depends(get_super_admin_context),
    limit: int = Query(50, ge=1, le=100),
    cursor_created_at: datetime | None = None,
    cursor_id: UUID | None = None,
    organization_id: UUID | None = None,
) -> AuditLogRowsPage:
    return await audit_service.list_audit_log_rows(
        db,
        limit=limit,
        cursor_created_at=cursor_created_at,
        cursor_id=cursor_id,
        organization_id=organization_id,
    )
