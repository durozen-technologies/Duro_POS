from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.schemas.common import ORMModel


class AuditLogRead(ORMModel):
    id: UUID
    user_id: UUID | None
    organization_id: UUID | None
    shop_id: UUID | None
    action: str
    entity_type: str
    entity_id: UUID | None
    details: dict[str, object]
    created_at: datetime


class AuditLogRowsPage(BaseModel):
    items: list[AuditLogRead]
    limit: int
    has_more: bool
    next_cursor_created_at: datetime | None = None
    next_cursor_id: UUID | None = None
