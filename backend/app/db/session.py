from collections.abc import AsyncGenerator
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_session_local
from app.db.tenant_context_var import reset_active_tenant_schema, set_active_tenant_schema
from app.db.tenant_schema import set_search_path, tenant_router


async def get_platform_db() -> AsyncGenerator[AsyncSession, None]:
    token = set_active_tenant_schema(None)
    async with get_session_local()() as db:
        try:
            await set_search_path(db, None)
            yield db
        except Exception:
            await db.rollback()
            raise
        finally:
            reset_active_tenant_schema(token)


async def get_db_for_org(organization_id: UUID) -> AsyncGenerator[AsyncSession, None]:
    """Open a session scoped to a tenant schema."""
    async with get_session_local()() as db:
        schema_name = await tenant_router.resolve_schema(db, organization_id)
        if schema_name is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Organization has no tenant schema",
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
