"""
Shared FastAPI dependency functions used across routers.

Centralising these here prevents:
- Duplicated role-check logic (require_roles running twice per request)
- Repeated inline 404 guard patterns
"""

from uuid import UUID

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import TenantContext, get_tenant_context
from app.auth.dependencies import require_tenant_admin
from app.db.session import get_platform_db
from app.db.tenant_session import get_tenant_db
from app.models import Shop, User
from app.services.tenant_query import get_shop_for_tenant_or_404


def get_current_admin(
    user: User = Depends(require_tenant_admin()),
) -> User:
    """
    Returns the already-authenticated admin User object.

    When used on a router that already carries
    ``dependencies=[Depends(require_roles(UserRole.ADMIN))]``, the JWT is
    validated only once at the router level.  This dependency simply
    re-uses that validated user so individual route handlers can receive
    the User model without triggering a second role check.
    """
    return user


async def get_shop_or_404(
    shop_id: UUID,
    db: AsyncSession = Depends(get_tenant_db),
) -> Shop:
    """
    Loads a Shop by primary key, raising 404 if it does not exist.

    Replaces the repeated inline pattern::

        shop = await db.get(Shop, shop_id)
        if shop is None:
            raise HTTPException(status_code=404, detail="Shop not found")
    """
    shop = await db.get(Shop, shop_id)
    if shop is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Shop not found",
        )
    return shop


async def get_tenant_shop_or_404(
    shop_id: UUID,
    ctx: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_tenant_db),
) -> Shop:
    ctx.require_organization_id()
    shop = await db.get(Shop, shop_id)
    if shop is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Shop not found",
        )
    return shop
