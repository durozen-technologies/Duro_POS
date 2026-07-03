from __future__ import annotations

import logging
from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permission_codes import TENANT_FULL_ADMIN_PERMISSIONS
from app.core.errors import BRANCH_LIMIT_REACHED_DETAIL
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
    tenant_schema_scope,
)
from app.models import AdminRole, AdminRolePermission, Organization, Shop, User
from app.schemas.super_admin.hard_delete import HardDeleteRequest
from app.schemas.super_admin.organizations import (
    AdminRoleRead,
    OrganizationCounts,
    OrganizationCreate,
    OrganizationRead,
    OrganizationRowsPage,
    OrganizationUpdate,
    slugify_name,
)
from app.services.super_admin._audit import record_hard_delete_audit, record_super_admin_audit
from app.services.super_admin._credentials import verify_super_admin_credentials
from app.services.bill_number import (
    BILL_NUMBER_PREFIX_SETTING,
    bill_number_prefix_from_settings,
    normalize_bill_number_prefix,
)
from app.services.tenant_data_migration import purge_organization_rows_for_hard_delete

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
    for code in TENANT_FULL_ADMIN_PERMISSIONS:
        full_role.permissions.append(AdminRolePermission(permission_code=code))
    db.add(full_role)
    await db.flush()


async def _provision_schema_for_org(db: AsyncSession, org: Organization, schema_name: str) -> None:
    safe_schema = assert_safe_schema_name(schema_name)
    await create_tenant_schema(db, safe_schema)
    try:
        async with tenant_schema_scope(db, safe_schema):
            await run_tenant_migrations_async(db, safe_schema)
            await _create_tenant_full_admin_role(db, org.id)
    except Exception:
        from sqlalchemy import text

        await set_search_path(db, None)
        await db.execute(text(f'DROP SCHEMA IF EXISTS "{safe_schema}" CASCADE'))
        raise


async def _evict_org_counts_cache() -> None:
    await cache_delete(super_org_counts_cache_key())


def _org_to_read(org: Organization, *, branch_count: int = 0) -> OrganizationRead:
    remaining = max(0, org.max_branches - branch_count)
    return OrganizationRead(
        id=org.id,
        name=org.name,
        slug=org.slug,
        is_active=org.is_active,
        max_branches=org.max_branches,
        branch_count=branch_count,
        remaining_branches=remaining,
        bill_number_prefix=bill_number_prefix_from_settings(org.settings),
        settings=dict(org.settings or {}),
        created_at=org.created_at,
        updated_at=org.updated_at,
    )


async def _require_org_schema(org: Organization) -> str:
    if not org.schema_name:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Tenant schema is not configured for this organization",
        )
    return org.schema_name


async def count_organization_branches(db: AsyncSession, organization_id: UUID) -> int:
    org = await db.get(Organization, organization_id)
    if org is None:
        return 0
    schema_name = await _require_org_schema(org) if await is_postgres_session(db) else org.schema_name
    if not schema_name:
        return int(
            await db.scalar(
                select(func.count(Shop.id)).where(Shop.organization_id == organization_id)
            )
            or 0
        )
    async with tenant_schema_scope(db, schema_name):
        return int(
            await db.scalar(
                select(func.count(Shop.id)).where(Shop.organization_id == organization_id)
            )
            or 0
        )


async def assert_organization_can_add_branch(db: AsyncSession, organization_id: UUID) -> None:
    org = await get_organization_or_404(db, organization_id)
    branch_count = await count_organization_branches(db, organization_id)
    if branch_count >= org.max_branches:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=BRANCH_LIMIT_REACHED_DETAIL,
        )


async def _branch_counts_for_orgs(
    db: AsyncSession, organization_ids: list[UUID]
) -> dict[UUID, int]:
    if not organization_ids:
        return {}
    counts: dict[UUID, int] = {}
    orgs = list(
        await db.scalars(select(Organization).where(Organization.id.in_(organization_ids)))
    )
    for org in orgs:
        counts[org.id] = await count_organization_branches(db, org.id)
    return counts


async def _ensure_unique_organization_name(
    db: AsyncSession,
    name: str,
    *,
    exclude_organization_id: UUID | None = None,
) -> None:
    filters = [func.lower(Organization.name) == name.strip().lower()]
    if exclude_organization_id is not None:
        filters.append(Organization.id != exclude_organization_id)
    existing = await db.scalar(select(Organization.id).where(*filters))
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Organization name already exists",
        )


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

    org_name = payload.name.strip()
    await _ensure_unique_organization_name(db, org_name)

    use_schema_tenant = await is_postgres_session(db)
    if not use_schema_tenant:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Organization provisioning requires PostgreSQL",
        )

    org = Organization(
        name=org_name,
        slug=slug,
        schema_name=derive_schema_name(slug),
        is_active=True,
        max_branches=payload.max_branches,
    )
    db.add(org)
    await db.flush()

    await _provision_schema_for_org(db, org, org.schema_name)
    await tenant_router.evict_schema_cache(org.id)

    await record_super_admin_audit(
        db,
        actor=actor,
        action="organization.created",
        entity_type="organization",
        entity_id=org.id,
        organization_id=org.id,
        details={"name": org.name, "slug": org.slug, "max_branches": org.max_branches},
    )
    await db.commit()
    await _evict_org_counts_cache()
    await db.refresh(org)
    log_event(
        logger, logging.INFO, "organization_created", "organization created", org_id=str(org.id)
    )
    return _org_to_read(org, branch_count=0)


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
    branch_counts = await _branch_counts_for_orgs(db, [row.id for row in page_rows])
    next_created_at = next_id = None
    if len(rows) > limit and page_rows:
        last = page_rows[-1]
        next_created_at = last.created_at
        next_id = last.id
    return OrganizationRowsPage(
        items=[
            _org_to_read(row, branch_count=branch_counts.get(row.id, 0)) for row in page_rows
        ],
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
    await cache_set_json(cache_key, result.model_dump(mode="json"), ttl_seconds=5)
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

    schema_name = await _require_org_schema(org) if await is_postgres_session(db) else org.schema_name

    async def _fetch_roles(session: AsyncSession) -> list[AdminRole]:
        return list(
            await session.scalars(
                select(AdminRole)
                .where(AdminRole.organization_id == organization_id)
                .order_by(AdminRole.name.asc())
            )
        )

    if schema_name:
        async with get_session_local()() as tenant_db:
            await set_search_path(tenant_db, schema_name)
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
    modified_at = datetime.now(UTC).isoformat()

    if payload.name is not None:
        new_name = payload.name.strip()
        if new_name != org.name:
            await _ensure_unique_organization_name(
                db, new_name, exclude_organization_id=organization_id
            )
            previous_name = org.name
            org.name = new_name
            await record_super_admin_audit(
                db,
                actor=actor,
                action="organization.renamed",
                entity_type="organization",
                entity_id=org.id,
                organization_id=org.id,
                details={
                    "previous_name": previous_name,
                    "updated_name": new_name,
                    "modified_by": actor.username,
                    "modified_at": modified_at,
                },
            )

    if payload.max_branches is not None and payload.max_branches != org.max_branches:
        branch_count = await count_organization_branches(db, organization_id)
        if payload.max_branches < branch_count:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=(
                    f"Branch limit cannot be lower than the current branch count ({branch_count})"
                ),
            )
        previous_limit = org.max_branches
        org.max_branches = payload.max_branches
        await record_super_admin_audit(
            db,
            actor=actor,
            action="organization.branch_limit_updated",
            entity_type="organization",
            entity_id=org.id,
            organization_id=org.id,
            details={
                "previous_max_branches": previous_limit,
                "updated_max_branches": payload.max_branches,
                "branch_count": branch_count,
                "modified_by": actor.username,
                "modified_at": modified_at,
            },
        )

    if payload.bill_number_prefix is not None:
        try:
            prefix = normalize_bill_number_prefix(payload.bill_number_prefix)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=str(exc),
            ) from exc
        previous_prefix = bill_number_prefix_from_settings(org.settings)
        settings = dict(org.settings or {})
        settings[BILL_NUMBER_PREFIX_SETTING] = prefix
        org.settings = settings
        if prefix != previous_prefix:
            await record_super_admin_audit(
                db,
                actor=actor,
                action="organization.bill_number_prefix_updated",
                entity_type="organization",
                entity_id=org.id,
                organization_id=org.id,
                details={
                    "previous_bill_number_prefix": previous_prefix,
                    "updated_bill_number_prefix": prefix,
                    "modified_by": actor.username,
                    "modified_at": modified_at,
                },
            )

    if payload.settings is not None:
        org.settings = payload.settings
        await record_super_admin_audit(
            db,
            actor=actor,
            action="organization.updated",
            entity_type="organization",
            entity_id=org.id,
            organization_id=org.id,
            details={"settings": payload.settings},
        )

    await db.commit()
    await _evict_org_counts_cache()
    await db.refresh(org)
    branch_count = await count_organization_branches(db, organization_id)
    return _org_to_read(org, branch_count=branch_count)


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
    branch_count = await count_organization_branches(db, organization_id)
    return _org_to_read(org, branch_count=branch_count)


async def _purge_legacy_tenant_data(db: AsyncSession, organization_id: UUID) -> None:
    from app.models import AdminRole

    shops = (
        await db.scalars(select(Shop).where(Shop.organization_id == organization_id))
    ).all()
    for shop in shops:
        owner = await db.get(User, shop.owner_user_id)
        await db.delete(shop)
        if owner is not None:
            await db.delete(owner)
    users = (
        await db.scalars(select(User).where(User.organization_id == organization_id))
    ).all()
    for user in users:
        await db.delete(user)
    roles = (
        await db.scalars(select(AdminRole).where(AdminRole.organization_id == organization_id))
    ).all()
    for role in roles:
        await db.delete(role)
    await db.flush()


async def _purge_organization_rows_for_hard_delete(
    db: AsyncSession,
    organization_id: UUID,
    *,
    skip_schema: str | None,
) -> None:
    if not await is_postgres_session(db):
        return

    def _run(sync_session) -> None:
        purge_organization_rows_for_hard_delete(
            sync_session.connection(),
            organization_id,
            skip_schema=skip_schema,
        )

    await db.run_sync(_run)


async def hard_delete_organization(
    db: AsyncSession,
    organization_id: UUID,
    payload: HardDeleteRequest,
    actor: User,
    *,
    client_ip: str | None = None,
) -> None:
    org = await get_organization_or_404(db, organization_id)
    resource_name = org.name
    org_id = org.id
    slug = org.slug
    schema_name = org.schema_name

    try:
        await verify_super_admin_credentials(
            db,
            actor,
            username=payload.username,
            password=payload.password,
        )

        dropped_schema: str | None = None
        if not schema_name or not await is_postgres_session(db):
            if not await is_postgres_session(db):
                await _purge_legacy_tenant_data(db, organization_id)
            else:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Tenant schema is not configured for this organization",
                )
        else:
            safe_schema = assert_safe_schema_name(schema_name)
            from sqlalchemy import text

            await set_search_path(db, None)
            await db.execute(text(f'DROP SCHEMA IF EXISTS "{safe_schema}" CASCADE'))
            dropped_schema = safe_schema

        await _purge_organization_rows_for_hard_delete(
            db, organization_id, skip_schema=dropped_schema
        )
        await db.flush()
        await delete_auth_index(db, organization_id=organization_id)

        await record_hard_delete_audit(
            db,
            actor=actor,
            action="organization.hard_delete",
            entity_type="organization",
            entity_id=org_id,
            organization_id=org_id,
            resource_name=resource_name,
            result="success",
            client_ip=client_ip,
            extra={"slug": slug, "schema_name": schema_name},
        )
        # Core delete — ORM db.delete(org) would SELECT public.shops (tenant-only table).
        await db.execute(delete(Organization).where(Organization.id == org_id))
        await tenant_router.evict_schema_cache(org_id)
        await db.commit()
        await _evict_org_counts_cache()
        log_event(
            logger,
            logging.INFO,
            "organization_hard_deleted",
            "organization hard deleted",
            org_id=str(org_id),
        )
    except HTTPException as exc:
        await db.rollback()
        await record_hard_delete_audit(
            db,
            actor=actor,
            action="organization.hard_delete",
            entity_type="organization",
            entity_id=org_id,
            organization_id=org_id,
            resource_name=resource_name,
            result="failed",
            client_ip=client_ip,
            error=str(exc.detail),
            extra={"slug": slug},
        )
        await db.commit()
        raise
