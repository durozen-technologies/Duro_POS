"""
Shared FastAPI dependency functions used across routers.

Centralising these here prevents:
- Duplicated role-check logic (require_roles running twice per request)
- Repeated inline 404 guard patterns
"""

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_roles
from app.core.database import get_db
from app.models import Shop, User, UserRole


def get_current_admin(
    user: User = Depends(require_roles(UserRole.ADMIN)),
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
    shop_id: int,
    db: AsyncSession = Depends(get_db),
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
