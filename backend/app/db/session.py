from collections.abc import AsyncGenerator
from uuid import UUID

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.tenant_context import TenantContext, get_tenant_context
from app.db.database import get_session_local
from app.db.tenant_schema import set_search_path, tenant_router


async def get_platform_db() -> AsyncGenerator[AsyncSession, None]:
    async with get_session_local()() as db:
        try:
            await set_search_path(db, None)
            yield db
        except Exception:
            await db.rollback()
            raise


async def get_tenant_db(
    ctx: TenantContext = Depends(get_tenant_context),
) -> AsyncGenerator[AsyncSession, None]:
    async with get_session_local()() as db:
        try:
            schema_name = ctx.schema_name
            if schema_name is None and ctx.organization_id is not None:
                schema_name = await tenant_router.resolve_schema(db, ctx.organization_id)
            await set_search_path(db, schema_name)
            yield db
        except Exception:
            await db.rollback()
            raise


async def get_db_for_org(organization_id: UUID) -> AsyncGenerator[AsyncSession, None]:
    """Open a session scoped to a tenant schema (or public for legacy orgs)."""
    async with get_session_local()() as db:
        try:
            schema_name = await tenant_router.resolve_schema(db, organization_id)
            await set_search_path(db, schema_name)
            yield db
        except Exception:
            await db.rollback()
            raise
