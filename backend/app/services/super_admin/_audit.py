from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tenant_context_var import (
    get_active_tenant_schema,
    reset_active_tenant_schema,
    set_active_tenant_schema,
)
from app.db.tenant_schema import set_search_path
from app.models import AuditLog, User


def _hard_delete_details(
    *,
    actor_username: str,
    resource_name: str,
    result: str,
    client_ip: str | None = None,
    error: str | None = None,
    extra: dict[str, object] | None = None,
) -> dict[str, object]:
    details: dict[str, object] = {
        "super_admin_username": actor_username,
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
    actor: User | None = None,
    actor_id: UUID | None = None,
    actor_username: str | None = None,
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
    # Prefer captured scalars — callers often record after rollback when `actor` is expired.
    resolved_id = actor_id if actor_id is not None else (actor.id if actor is not None else None)
    resolved_username = (
        actor_username
        if actor_username is not None
        else (actor.username if actor is not None else "")
    )
    if resolved_id is None:
        raise ValueError("actor_id or actor is required for hard-delete audit")
    await record_super_admin_audit(
        db,
        actor_id=resolved_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        organization_id=organization_id,
        details=_hard_delete_details(
            actor_username=resolved_username,
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
    actor: User | None = None,
    actor_id: UUID | None = None,
    action: str,
    entity_type: str,
    entity_id: UUID | None = None,
    organization_id: UUID | None = None,
    details: dict[str, object] | None = None,
) -> None:
    # Super-admin audit rows live in public; callers may still be inside tenant_schema_scope.
    resolved_id = actor_id if actor_id is not None else (actor.id if actor is not None else None)
    if resolved_id is None:
        raise ValueError("actor_id or actor is required for super-admin audit")
    saved_schema = get_active_tenant_schema()
    token = set_active_tenant_schema(None)
    await set_search_path(db, None)
    try:
        entry = AuditLog(
            user_id=resolved_id,
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
