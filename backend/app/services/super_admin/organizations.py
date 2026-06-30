from __future__ import annotations

import logging
from datetime import datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permission_codes import TENANT_FULL_ADMIN_PERMISSIONS
from app.core.logging import log_event
from app.core.redis_cache import cache_delete, super_org_counts_cache_key
from app.db.database import get_session_local
from app.db.tenant_schema import (
    assert_safe_schema_name,
    create_tenant_schema,
    derive_schema_name,
    is_postgres_session,
    run_tenant_migrations_async,
    set_search_path,
    tenant_router,
)
from app.models import AdminRole, AdminRolePermission, Organization, User
from app.schemas.super_admin.organizations import (
    AdminRoleRead,
    OrganizationCounts,
    OrganizationCreate,
    OrganizationRead,
    OrganizationRowsPage,
    OrganizationUpdate,
    slugify_name,
)
from app.services.super_admin._audit import record_super_admin_audit

logger = logging.getLogger(__name__)


async def _create_tenant_full_admin_role(
    db: AsyncSession,
    organization_id: UUID,
) -> None:
    full_role = AdminRole(
        organization_id=organization_id,
        name="TenantFullAdmin",
        is_system=True,
    )
    db.add(full_role)
    await db.flush()
    for code in TENANT_FULL_ADMIN_PERMISSIONS:
        db.add(AdminRolePermission(role_id=full_role.id, permission_code=code))


async def _provision_schema_for_org(db: AsyncSession, org: Organization, schema_name: str) -> None:
    safe_schema = assert_safe_schema_name(schema_name)
    await create_tenant_schema(db, safe_schema)
    try:
        await run_tenant_migrations_async(db, safe_schema)
        await set_search_path(db, safe_schema)
        await _create_tenant_full_admin_role(db, org.id)
        await set_search_path(db, None)
    except Exception:
        from sqlalchemy import text

        await db.execute(text(f'DROP SCHEMA IF EXISTS "{safe_schema}" CASCADE'))
        raise


async def _evict_org_counts_cache() -> None:
    await cache_delete(super_org_counts_cache_key())


def _org_to_read(org: Organization) -> OrganizationRead:
    return OrganizationRead.model_validate(org)


def _require_full_cursor(cursor_created_at: datetime | None, cursor_id: UUID | None) -> None:
    if (cursor_created_at is None) ^ (cursor_id is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="cursor_created_at and cursor_id must be supplied together",
        )


def _cursor_filter(
    model,
    cursor_created_at: datetime | None,
    cursor_id: UUID | None,
):
    if cursor_created_at is None:
        return None
    return or_(
        model.created_at < cursor_created_at,
        and_(model.created_at == cursor_created_at, model.id < cursor_id),
    )


async def create_organization(
    db: AsyncSession,
    payload: OrganizationCreate,
    actor: User,
) -> OrganizationRead:
    slug = payload.slug or slugify_name(payload.name)
    existing = await db.scalar(select(Organization.id).where(Organization.slug == slug))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Slug already exists")

    use_schema_tenant = await is_postgres_session(db)
    org = Organization(
        name=payload.name.strip(),
        slug=slug,
        schema_name=derive_schema_name(slug) if use_schema_tenant else None,
        is_active=True,
    )
    db.add(org)
    await db.flush()

    if org.schema_name:
        await _provision_schema_for_org(db, org, org.schema_name)
        await tenant_router.evict_schema_cache(org.id)
    else:
        await _create_tenant_full_admin_role(db, org.id)

    await record_super_admin_audit(
        db,
        actor=actor,
        action="organization.created",
        entity_type="organization",
        entity_id=org.id,
        organization_id=org.id,
        details={"name": org.name, "slug": org.slug},
    )
    await db.commit()
    await _evict_org_counts_cache()
    await db.refresh(org)
    log_event(
        logger, logging.INFO, "organization_created", "organization created", org_id=str(org.id)
    )
    return _org_to_read(org)


async def list_organization_rows(
    db: AsyncSession,
    *,
    limit: int = 50,
    cursor_created_at: datetime | None = None,
    cursor_id: UUID | None = None,
    q: str | None = None,
    active: bool | None = None,
) -> OrganizationRowsPage:
    _require_full_cursor(cursor_created_at, cursor_id)
    filters = []
    if q and q.strip():
        like = f"%{q.strip().lower()}%"
        filters.append(
            or_(func.lower(Organization.name).like(like), func.lower(Organization.slug).like(like))
        )
    if active is not None:
        filters.append(Organization.is_active.is_(active))
    cursor = _cursor_filter(Organization, cursor_created_at, cursor_id)
    if cursor is not None:
        filters.append(cursor)

    rows = (
        await db.scalars(
            select(Organization)
            .where(*filters)
            .order_by(Organization.created_at.desc(), Organization.id.desc())
            .limit(limit + 1)
        )
    ).all()
    page_rows = rows[:limit]
    next_created_at = next_id = None
    if len(rows) > limit and page_rows:
        last = page_rows[-1]
        next_created_at = last.created_at
        next_id = last.id
    return OrganizationRowsPage(
        items=[_org_to_read(row) for row in page_rows],
        limit=limit,
        has_more=len(rows) > limit,
        next_cursor_created_at=next_created_at,
        next_cursor_id=next_id,
    )


async def count_organizations(db: AsyncSession) -> OrganizationCounts:
    from app.core.redis_cache import cache_get_json, cache_set_json, super_org_counts_cache_key

    cache_key = super_org_counts_cache_key()
    cached = await cache_get_json(cache_key)
    if isinstance(cached, dict):
        try:
            return OrganizationCounts.model_validate(cached)
        except Exception:
            pass

    total = int(await db.scalar(select(func.count(Organization.id))) or 0)
    active = int(
        await db.scalar(select(func.count(Organization.id)).where(Organization.is_active.is_(True)))
        or 0
    )
    result = OrganizationCounts(all=total, active=active, inactive=total - active)
    await cache_set_json(cache_key, result.model_dump(mode="json"), ttl_seconds=30)
    return result


async def get_organization_or_404(db: AsyncSession, organization_id: UUID) -> Organization:
    org = await db.get(Organization, organization_id)
    if org is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    return org


async def list_organization_admin_roles(
    db: AsyncSession,
    organization_id: UUID,
) -> list[AdminRoleRead]:
    org = await get_organization_or_404(db, organization_id)

    async def _fetch_roles(session: AsyncSession) -> list[AdminRole]:
        return list(
            await session.scalars(
                select(AdminRole)
                .where(AdminRole.organization_id == organization_id)
                .order_by(AdminRole.name.asc())
            )
        )

    if org.schema_name:
        async with get_session_local()() as tenant_db:
            await set_search_path(tenant_db, org.schema_name)
            roles = await _fetch_roles(tenant_db)
    else:
        roles = await _fetch_roles(db)
    return [AdminRoleRead.model_validate(role) for role in roles]


async def update_organization(
    db: AsyncSession,
    organization_id: UUID,
    payload: OrganizationUpdate,
    actor: User,
) -> OrganizationRead:
    org = await get_organization_or_404(db, organization_id)
    if payload.name is not None:
        org.name = payload.name.strip()
    if payload.settings is not None:
        org.settings = payload.settings
    await record_super_admin_audit(
        db,
        actor=actor,
        action="organization.updated",
        entity_type="organization",
        entity_id=org.id,
        organization_id=org.id,
        details={"name": org.name},
    )
    await db.commit()
    await _evict_org_counts_cache()
    await db.refresh(org)
    return _org_to_read(org)


async def set_organization_status(
    db: AsyncSession,
    organization_id: UUID,
    *,
    is_active: bool,
    actor: User,
) -> OrganizationRead:
    org = await get_organization_or_404(db, organization_id)
    org.is_active = is_active
    await record_super_admin_audit(
        db,
        actor=actor,
        action="organization.status_updated",
        entity_type="organization",
        entity_id=org.id,
        organization_id=org.id,
        details={"is_active": is_active},
    )
    await db.commit()
    await _evict_org_counts_cache()
    await db.refresh(org)
    return _org_to_read(org)
