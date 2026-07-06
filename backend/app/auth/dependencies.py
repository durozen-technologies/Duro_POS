from collections.abc import Callable
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.tenant_shop import shop_for_user as _shop_for_user
from app.core.errors import (
    ACCOUNT_DISABLED_BY_SUPER_ADMIN,
    ORGANIZATION_DISABLED_BY_SUPER_ADMIN,
)
from app.core.security import decode_access_token
from app.db.session import get_platform_db
from app.db.tenant_context_var import reset_active_tenant_schema, set_active_tenant_schema
from app.db.tenant_schema import set_search_path, tenant_router, tenant_schema_scope
from app.models import Organization, Shop, User, UserRole
from app.models.enums import is_tenant_admin, parse_user_role

bearer_scheme = HTTPBearer(auto_error=False)

_TENANT_ADMIN_ROLES = frozenset({UserRole.TENANT_ADMIN})


def _role_allowed(current_role: UserRole, allowed: tuple[UserRole, ...]) -> bool:
    normalized = parse_user_role(current_role)
    return normalized in allowed


async def _load_platform_user(db: AsyncSession, user_id: UUID) -> User | None:
    return await db.scalar(
        select(User).options(selectinload(User.organization)).where(User.id == user_id)
    )


async def _load_tenant_user_with_relations(db: AsyncSession, user_id: UUID) -> User | None:
    return await db.scalar(
        select(User).options(selectinload(User.organization)).where(User.id == user_id)
    )


def _credentials_exception() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid authentication credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


def _validate_token_claims(payload: dict, user: User) -> None:
    credentials_exception = _credentials_exception()
    token_perm = payload.get("perm_version")
    if token_perm is None or int(token_perm) != user.permissions_version:
        raise credentials_exception

    token_org_raw = payload.get("org_id")
    if user.organization_id is None:
        if token_org_raw is not None:
            raise credentials_exception
        return

    if token_org_raw is None:
        raise credentials_exception
    try:
        token_org_id = UUID(str(token_org_raw))
    except (TypeError, ValueError) as exc:
        raise credentials_exception from exc
    if token_org_id != user.organization_id:
        raise credentials_exception


async def get_current_user(
    platform_db: AsyncSession = Depends(get_platform_db),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> User:
    credentials_exception = _credentials_exception()
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
        user = await _load_platform_user(platform_db, user_id)
        if user is None or user.organization_id is not None:
            raise credentials_exception
        _validate_token_claims(payload, user)
        return user

    schema_name = await tenant_router.resolve_schema(platform_db, org_id)
    if schema_name is None:
        raise credentials_exception

    token = set_active_tenant_schema(schema_name)
    try:
        await set_search_path(platform_db, schema_name)
        user = await _load_tenant_user_with_relations(platform_db, user_id)
        if user is None:
            raise credentials_exception
        _validate_token_claims(payload, user)
        return user
    finally:
        reset_active_tenant_schema(token)
        await set_search_path(platform_db, None)


async def _ensure_org_active_for_user(db: AsyncSession, user: User) -> None:
    org_id = user.organization_id
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
    if current_user.role == UserRole.SHOP_ACCOUNT:
        org_id = current_user.organization_id
        if org_id is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Shop account is disabled"
            )
        schema_name = await tenant_router.resolve_schema(platform_db, org_id)
        if schema_name is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Shop account is disabled"
            )
        async with tenant_schema_scope(platform_db, schema_name):
            shop = await _shop_for_user(platform_db, current_user)
            if shop is None or not shop.is_active:
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
    platform_db: AsyncSession = Depends(get_platform_db),
) -> Shop:
    org_id = current_user.organization_id
    if org_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shop account not linked")
    schema_name = await tenant_router.resolve_schema(platform_db, org_id)
    if schema_name is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shop account not linked")
    async with tenant_schema_scope(platform_db, schema_name):
        shop = await _shop_for_user(platform_db, current_user)
    if shop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shop account not linked")
    if not shop.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shop is inactive")
    return shop
