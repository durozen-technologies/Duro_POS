from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tenant_context_var import get_active_tenant_schema, reset_active_tenant_schema, set_active_tenant_schema
from app.db.tenant_schema import set_search_path
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
    # Super-admin audit rows live in public; callers may still be inside tenant_schema_scope.
    saved_schema = get_active_tenant_schema()
    token = set_active_tenant_schema(None)
    await set_search_path(db, None)
    try:
        entry = AuditLog(
            user_id=actor.id,
            organization_id=organization_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            details=details or {},
        )
        db.add(entry)
        # Only flush the audit row — a full session flush would push dirty tenant users to public.
        await db.flush([entry])
    finally:
        reset_active_tenant_schema(token)
        if saved_schema:
            await set_search_path(db, saved_schema)
