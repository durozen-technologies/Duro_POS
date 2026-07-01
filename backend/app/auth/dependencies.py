from collections.abc import Callable
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import (
    ACCOUNT_DISABLED_BY_SUPER_ADMIN,
    ORGANIZATION_DISABLED_BY_SUPER_ADMIN,
)
from app.core.security import decode_access_token
from app.db.database import get_db
from app.models import Organization, Shop, User, UserRole
from app.models.enums import is_tenant_admin, parse_user_role

bearer_scheme = HTTPBearer(auto_error=False)

_TENANT_ADMIN_ROLES = frozenset({UserRole.TENANT_ADMIN})


def _role_allowed(current_role: UserRole, allowed: tuple[UserRole, ...]) -> bool:
    normalized = parse_user_role(current_role)
    return normalized in allowed


async def get_current_user(
    db: AsyncSession = Depends(get_db),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid authentication credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = decode_access_token(credentials.credentials)
        user_id = UUID(payload["sub"])
    except (JWTError, KeyError, TypeError, ValueError) as exc:
        raise credentials_exception from exc

    user = await db.get(
        User,
        user_id,
        options=(
            selectinload(User.shop).selectinload(Shop.organization),
            selectinload(User.organization),
        ),
    )
    if user is None:
        raise credentials_exception
    return user


async def _ensure_org_active_for_user(db: AsyncSession, user: User) -> None:
    org_id: UUID | None = None
    if is_tenant_admin(user.role):
        org_id = user.organization_id
    elif user.role == UserRole.SHOP_ACCOUNT and user.shop is not None:
        org_id = user.shop.organization_id

    if org_id is None:
        return

    org = user.organization
    if user.role == UserRole.SHOP_ACCOUNT and user.shop is not None:
        org = user.shop.organization if org is None else org

    if org is None:
        org = await db.get(Organization, org_id)
    if org is None or not org.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ORGANIZATION_DISABLED_BY_SUPER_ADMIN,
        )


async def get_current_active_user(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not current_user.is_active:
        detail = (
            ACCOUNT_DISABLED_BY_SUPER_ADMIN
            if is_tenant_admin(current_user.role)
            else "User account is inactive"
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)
    if (
        current_user.role == UserRole.SHOP_ACCOUNT
        and current_user.shop
        and not current_user.shop.is_active
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Shop account is disabled"
        )
    await _ensure_org_active_for_user(db, current_user)
    return current_user


def require_roles(*roles: UserRole) -> Callable[[User], User]:
    async def dependency(current_user: User = Depends(get_current_active_user)) -> User:
        if not _role_allowed(current_user.role, roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions"
            )
        return current_user

    return dependency


def require_tenant_admin() -> Callable[[User], User]:
    return require_roles(UserRole.TENANT_ADMIN)


async def get_current_shop(
    current_user: User = Depends(require_roles(UserRole.SHOP_ACCOUNT)),
) -> Shop:
    shop = current_user.shop
    if shop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shop account not linked")
    if not shop.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop is inactive")
    return shop
