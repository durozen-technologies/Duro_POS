from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tenant_context_var import get_active_tenant_schema, reset_active_tenant_schema, set_active_tenant_schema
from app.db.tenant_schema import set_search_path
from app.models import AuditLog, User


def _hard_delete_details(
    *,
    actor: User,
    resource_name: str,
    result: str,
    client_ip: str | None = None,
    error: str | None = None,
    extra: dict[str, object] | None = None,
) -> dict[str, object]:
    details: dict[str, object] = {
        "super_admin_username": actor.username,
        "resource_name": resource_name,
        "result": result,
        "attempted_at": datetime.now(UTC).isoformat(),
    }
    if client_ip:
        details["client_ip"] = client_ip
    if error:
        details["error"] = error
    if extra:
        details.update(extra)
    return details


async def record_hard_delete_audit(
    db: AsyncSession,
    *,
    actor: User,
    action: str,
    entity_type: str,
    entity_id: UUID | None,
    organization_id: UUID | None,
    resource_name: str,
    result: str,
    client_ip: str | None = None,
    error: str | None = None,
    extra: dict[str, object] | None = None,
) -> None:
    await record_super_admin_audit(
        db,
        actor=actor,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        organization_id=organization_id,
        details=_hard_delete_details(
            actor=actor,
            resource_name=resource_name,
            result=result,
            client_ip=client_ip,
            error=error,
            extra=extra,
        ),
    )


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
