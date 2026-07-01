"""Tenant-scoped database session (depends on auth tenant context)."""

from collections.abc import AsyncGenerator

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.tenant_context import TenantContext, get_tenant_context
from app.db.database import get_session_local
from app.db.tenant_context_var import reset_active_tenant_schema, set_active_tenant_schema
from app.db.tenant_schema import set_search_path, tenant_router


async def get_tenant_db(
    ctx: TenantContext = Depends(get_tenant_context),
) -> AsyncGenerator[AsyncSession, None]:
    async with get_session_local()() as db:
        schema_name = ctx.schema_name
        if schema_name is None and ctx.organization_id is not None:
            schema_name = await tenant_router.resolve_schema(db, ctx.organization_id)
        if schema_name is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Tenant schema is not configured for this organization",
            )
        token = set_active_tenant_schema(schema_name)
        try:
            await set_search_path(db, schema_name)
            yield db
        except Exception:
            await db.rollback()
            raise
        finally:
            reset_active_tenant_schema(token)
