from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog
from app.schemas.super_admin.audit import AuditLogRead, AuditLogRowsPage


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


async def list_audit_log_rows(
    db: AsyncSession,
    *,
    limit: int = 50,
    cursor_created_at: datetime | None = None,
    cursor_id: UUID | None = None,
    organization_id: UUID | None = None,
) -> AuditLogRowsPage:
    _require_full_cursor(cursor_created_at, cursor_id)
    filters = []
    if organization_id is not None:
        filters.append(AuditLog.organization_id == organization_id)
    cursor = _cursor_filter(AuditLog, cursor_created_at, cursor_id)
    if cursor is not None:
        filters.append(cursor)

    rows = (
        await db.scalars(
            select(AuditLog)
            .where(*filters)
            .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
            .limit(limit + 1)
        )
    ).all()
    page_rows = rows[:limit]
    next_created_at = next_id = None
    if len(rows) > limit and page_rows:
        last = page_rows[-1]
        next_created_at = last.created_at
        next_id = last.id
    return AuditLogRowsPage(
        items=[AuditLogRead.model_validate(row) for row in page_rows],
        limit=limit,
        has_more=len(rows) > limit,
        next_cursor_created_at=next_created_at,
        next_cursor_id=next_id,
    )
