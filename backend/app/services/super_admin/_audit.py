from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, User


async def record_super_admin_audit(
    db: AsyncSession,
    *,
    actor: User,
    action: str,
    entity_type: str,
    entity_id: UUID | None = None,
    organization_id: UUID | None = None,
    details: dict[str, object] | None = None,
) -> None:
    db.add(
        AuditLog(
            user_id=actor.id,
            organization_id=organization_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            details=details or {},
        )
    )
