from collections.abc import Callable
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.errors import (
    ACCOUNT_DISABLED_BY_SUPER_ADMIN,
    ORGANIZATION_DISABLED_BY_SUPER_ADMIN,
)
from app.core.security import decode_access_token
from app.db.session import get_platform_db
from app.db.tenant_context_var import reset_active_tenant_schema, set_active_tenant_schema
from app.db.tenant_schema import set_search_path, tenant_router
from app.models import Organization, Shop, User, UserRole
from app.models.enums import is_super_admin, is_tenant_admin, parse_user_role

bearer_scheme = HTTPBearer(auto_error=False)

_TENANT_ADMIN_ROLES = frozenset({UserRole.TENANT_ADMIN})


def _role_allowed(current_role: UserRole, allowed: tuple[UserRole, ...]) -> bool:
    normalized = parse_user_role(current_role)
    return normalized in allowed


async def _load_user_with_relations(db: AsyncSession, user_id: UUID) -> User | None:
    return await db.scalar(
        select(User)
        .options(
            selectinload(User.shop).selectinload(Shop.organization),
            selectinload(User.organization),
        )
        .where(User.id == user_id)
    )


async def get_current_user(
    platform_db: AsyncSession = Depends(get_platform_db),
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
        org_id_raw = payload.get("org_id")
        org_id = UUID(org_id_raw) if org_id_raw else None
    except (JWTError, KeyError, TypeError, ValueError) as exc:
        raise credentials_exception from exc

    if org_id is None:
        user = await _load_user_with_relations(platform_db, user_id)
        if user is None or user.organization_id is not None:
            raise credentials_exception
        return user

    schema_name = await tenant_router.resolve_schema(platform_db, org_id)
    if schema_name is None:
        raise credentials_exception

    token = set_active_tenant_schema(schema_name)
    try:
        await set_search_path(platform_db, schema_name)
        user = await _load_user_with_relations(platform_db, user_id)
        if user is None:
            raise credentials_exception
        return user
    finally:
        reset_active_tenant_schema(token)


async def _ensure_org_active_for_user(db: AsyncSession, user: User) -> None:
    org_id: UUID | None = None
    if is_tenant_admin(user.role):
        org_id = user.organization_id
    elif user.role == UserRole.SHOP_ACCOUNT and user.shop is not None:
        org_id = user.shop.organization_id

    if org_id is None:
        return

    org = await db.get(Organization, org_id)
    if org is None or not org.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ORGANIZATION_DISABLED_BY_SUPER_ADMIN,
        )


async def get_current_active_user(
    current_user: User = Depends(get_current_user),
    platform_db: AsyncSession = Depends(get_platform_db),
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
    await _ensure_org_active_for_user(platform_db, current_user)
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
