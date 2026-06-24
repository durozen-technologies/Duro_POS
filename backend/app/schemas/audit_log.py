from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from .common import ORMModel


class AuditLogCreate(BaseModel):
    user_id: UUID | None = None
    shop_id: UUID | None = None
    action: str
    entity_type: str
    entity_id: UUID | None = None
    details: dict[str, object | None] = {}


class AuditLogRead(ORMModel):
    id: UUID
    user_id: UUID | None
    shop_id: UUID | None
    action: str
    entity_type: str
    entity_id: UUID | None
    details: dict[str, object | None]
    created_at: datetime
