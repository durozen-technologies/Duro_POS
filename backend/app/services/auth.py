from datetime import UTC, date, datetime
from uuid import UUID

import logging

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.tenant_context import load_user_permissions, session_role_for_user
from app.core.config import get_settings
from app.core.errors import (
    ACCOUNT_DISABLED_BY_SUPER_ADMIN,
    ORGANIZATION_DISABLED_BY_SUPER_ADMIN,
)
from app.core.logging import log_event
from app.core.redis_cache import cache_get_json, cache_set_json, login_rate_cache_key
from app.core.security import (
    create_access_token_for_user,
    get_password_hash,
    verify_password,
)
from app.db.tenant_context_var import reset_active_tenant_schema, set_active_tenant_schema
from app.db.tenant_schema import derive_schema_name, set_search_path, tenant_router
from app.models import DailyPrice, Item, Organization, Shop, ShopItemAllocation, User, UserAuthIndex, UserRole
from app.models.enums import is_super_admin, is_tenant_admin
from app.services.super_admin.organizations import _provision_schema_for_org
from app.services.user_auth_index import upsert_auth_index, username_is_globally_taken
from app.schemas.auth import (
    LoginResponse,
    PasswordResetRequest,
    PasswordResetResponse,
    RegisterRequest,
    UserSession,
    normalize_username,
)

logger = logging.getLogger(__name__)
DEFAULT_ORG_SLUG = "default"
LOGIN_RATE_LIMIT = 10
LOGIN_RATE_TTL_SECONDS = 15 * 60


async def _check_login_rate_limit(client_ip: str | None, username: str) -> None:
    if not client_ip:
        return
    key = login_rate_cache_key(client_ip, username)
    attempts = await cache_get_json(key)
    if isinstance(attempts, int) and attempts >= LOGIN_RATE_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Try again later.",
        )


async def _record_login_failure(client_ip: str | None, username: str) -> None:
    if not client_ip:
        return
    key = login_rate_cache_key(client_ip, username)
    attempts = await cache_get_json(key)
    next_count = int(attempts or 0) + 1
    await cache_set_json(key, next_count, ttl_seconds=LOGIN_RATE_TTL_SECONDS)


async def _requires_price_setup(db: AsyncSession, shop_id: UUID) -> bool:
    has_missing_today_price = await db.scalar(
        select(
            select(Item.id)
            .where(
                Item.is_active.is_(True),
                or_(
                    Item.shop_id == shop_id,
                    and_(
                        Item.shop_id.is_(None),
                        select(ShopItemAllocation.id)
                        .where(
                            ShopItemAllocation.shop_id == shop_id,
                            ShopItemAllocation.item_id == Item.id,
                        )
                        .exists(),
                    ),
                ),
                ~select(DailyPrice.id)
                .where(
                    DailyPrice.shop_id == shop_id,
                    DailyPrice.item_id == Item.id,
                    DailyPrice.price_date == date.today(),
                )
                .exists(),
            )
            .exists()
        )
    )
    return bool(has_missing_today_price)


async def _resolve_next_screen(db: AsyncSession, user: User) -> str:
    if is_super_admin(user.role):
        return "super_admin_dashboard"
    if is_tenant_admin(user.role):
        return "admin_dashboard"
    shop = user.shop
    if user.role == UserRole.SHOP_ACCOUNT and shop is not None:
        if await _requires_price_setup(db, shop.id):
            return "daily_price_setup"
        return "billing"
    return "admin_dashboard"


async def _organization_name_for_user(platform_db: AsyncSession, user: User) -> str | None:
    org_id = user.organization_id
    shop = user.shop
    if org_id is None and shop is not None:
        org_id = shop.organization_id
    if org_id is None:
        return None
    org = await platform_db.get(Organization, org_id)
    return org.name if org is not None else None


async def build_user_session(
    tenant_db: AsyncSession, platform_db: AsyncSession, user: User
) -> UserSession:
    """Build the authenticated-session payload for login and ``/me``."""
    shop = user.shop
    requires_price_setup = False
    if user.role == UserRole.SHOP_ACCOUNT and shop is not None:
        requires_price_setup = await _requires_price_setup(tenant_db, shop.id)

    permissions = sorted(await load_user_permissions(tenant_db, user))
    next_screen = await _resolve_next_screen(tenant_db, user)
    organization_name = await _organization_name_for_user(platform_db, user)

    return UserSession(
        id=user.id,
        username=user.username,
        role=session_role_for_user(user),
        is_active=user.is_active,
        created_at=user.created_at,
        organization_id=user.organization_id or (shop.organization_id if shop else None),
        organization_name=organization_name,
        permissions=permissions,
        shop_id=shop.id if shop else None,
        shop_name=shop.name if shop else None,
        requires_price_setup=requires_price_setup,
        next_screen=next_screen,
    )


async def _validate_login_eligibility(
    tenant_db: AsyncSession,
    platform_db: AsyncSession,
    user: User,
    normalized_username: str,
) -> None:
    if not user.is_active:
        log_event(
            logger,
            logging.INFO,
            "login_denied",
            "login denied",
            username=normalized_username,
            reason="inactive_user",
        )
        detail = (
            ACCOUNT_DISABLED_BY_SUPER_ADMIN
            if is_tenant_admin(user.role)
            else "User account is inactive"
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)

    if is_tenant_admin(user.role):
        if user.organization_id is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Tenant admin is not linked to an organization",
            )
        org = await platform_db.get(Organization, user.organization_id)
        if org is None or not org.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=ORGANIZATION_DISABLED_BY_SUPER_ADMIN,
            )

    if user.role == UserRole.SHOP_ACCOUNT:
        shop = user.shop
        if shop is None or not shop.is_active:
            log_event(
                logger,
                logging.WARNING,
                "login_failed",
                "login failed",
                username=normalized_username,
                reason="inactive_shop",
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Shop account is disabled"
            )
        org = await platform_db.get(Organization, shop.organization_id)
        if org is None or not org.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=ORGANIZATION_DISABLED_BY_SUPER_ADMIN,
            )


async def _load_tenant_user(
    platform_db: AsyncSession,
    *,
    schema_name: str,
    user_id: UUID,
) -> User | None:
    token = set_active_tenant_schema(schema_name)
    try:
        await set_search_path(platform_db, schema_name)
        return await platform_db.scalar(
            select(User)
            .options(
                selectinload(User.shop).selectinload(Shop.organization),
                selectinload(User.organization),
            )
            .where(User.id == user_id)
        )
    finally:
        reset_active_tenant_schema(token)


async def login_user(
    platform_db: AsyncSession,
    username: str,
    password: str,
    *,
    organization_slug: str | None = None,
    client_ip: str | None = None,
) -> LoginResponse:
    normalized_username = normalize_username(username)
    await _check_login_rate_limit(client_ip, normalized_username)

    user: User | None = None
    tenant_db = platform_db

    super_admin = await platform_db.scalar(
        select(User)
        .options(
            selectinload(User.shop).selectinload(Shop.organization),
            selectinload(User.organization),
        )
        .where(
            func.lower(User.username) == normalized_username,
            User.role == UserRole.SUPER_ADMIN,
            User.organization_id.is_(None),
        )
    )
    if super_admin is not None and verify_password(password, super_admin.password_hash):
        user = super_admin
    else:
        auth_entry = await platform_db.scalar(
            select(UserAuthIndex).where(UserAuthIndex.username_lower == normalized_username)
        )
        if organization_slug:
            org = await platform_db.scalar(
                select(Organization).where(Organization.slug == organization_slug.strip().lower())
            )
            if org is None or auth_entry is None or auth_entry.organization_id != org.id:
                auth_entry = None

        if auth_entry is not None:
            candidate = await _load_tenant_user(
                platform_db, schema_name=auth_entry.schema_name, user_id=auth_entry.user_id
            )
            if candidate is not None and verify_password(password, candidate.password_hash):
                user = candidate

    if user is None:
        await _record_login_failure(client_ip, normalized_username)
        log_event(
            logger,
            logging.WARNING,
            "login_failed",
            "login failed",
            username=normalized_username,
            reason="invalid_credentials",
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password"
        )

    await _validate_login_eligibility(tenant_db, platform_db, user, normalized_username)

    user.last_login_at = datetime.now(UTC)
    await tenant_db.flush()
    await tenant_db.commit()

    log_event(
        logger,
        logging.INFO,
        "login_succeeded",
        "login succeeded",
        user_id=str(user.id),
        role=user.role.value,
    )

    token = create_access_token_for_user(user)
    session = await build_user_session(tenant_db, platform_db, user)
    return LoginResponse(access_token=token, user=session)


async def reset_password_for_dev(
    db: AsyncSession, payload: PasswordResetRequest
) -> PasswordResetResponse:
    if get_settings().production:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Password reset endpoint is not available",
        )

    result = await db.execute(
        select(User)
        .where(User.id == payload.id, func.lower(User.username) == payload.username)
        .with_for_update()
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user.password_hash = get_password_hash(payload.password)
    await db.flush()
    await db.commit()
    await db.refresh(user)

    return PasswordResetResponse(
        id=user.id,
        username=user.username,
        role=session_role_for_user(user),
        is_active=user.is_active,
    )


async def register_admin(platform_db: AsyncSession, payload: RegisterRequest) -> LoginResponse:
    if get_settings().production:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Admin registration is not available",
        )

    existing_admin = await platform_db.scalar(
        select(User.id).where(User.role.in_([UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN]))
    )
    if existing_admin is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Admin registration is already completed",
        )

    default_org = await platform_db.scalar(
        select(Organization).where(Organization.slug == DEFAULT_ORG_SLUG)
    )
    if default_org is None:
        schema_name = derive_schema_name(DEFAULT_ORG_SLUG)
        default_org = Organization(
            name="Brolier 360 Default",
            slug=DEFAULT_ORG_SLUG,
            schema_name=schema_name,
            is_active=True,
        )
        platform_db.add(default_org)
        await platform_db.flush()
        await _provision_schema_for_org(platform_db, default_org, schema_name)
    elif default_org.schema_name is None:
        default_org.schema_name = derive_schema_name(DEFAULT_ORG_SLUG)
        await _provision_schema_for_org(platform_db, default_org, default_org.schema_name)

    token = set_active_tenant_schema(default_org.schema_name)
    try:
        await set_search_path(platform_db, default_org.schema_name)
        if await username_is_globally_taken(platform_db, payload.username):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Username already exists",
            )

        user = User(
            username=payload.username,
            password_hash=get_password_hash(payload.password),
            role=UserRole.TENANT_ADMIN,
            organization_id=default_org.id,
            is_active=True,
        )
        platform_db.add(user)
        await platform_db.flush()
        await upsert_auth_index(platform_db, user=user, schema_name=default_org.schema_name)
        await platform_db.commit()
        await platform_db.refresh(user)
    finally:
        reset_active_tenant_schema(token)

    access = create_access_token_for_user(user)
    ctx_token = set_active_tenant_schema(default_org.schema_name)
    try:
        await set_search_path(platform_db, default_org.schema_name)
        session = await build_user_session(platform_db, platform_db, user)
    finally:
        reset_active_tenant_schema(ctx_token)
    return LoginResponse(access_token=access, user=session)
