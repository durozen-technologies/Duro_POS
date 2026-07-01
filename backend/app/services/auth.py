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
from app.models import DailyPrice, Item, Organization, Shop, ShopItemAllocation, User, UserRole
from app.models.enums import is_super_admin, is_tenant_admin
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


async def _organization_name_for_user(db: AsyncSession, user: User) -> str | None:
    org_id = user.organization_id
    shop = user.shop
    if org_id is None and shop is not None:
        org_id = shop.organization_id
    if org_id is None:
        return None
    org = user.organization
    if org is None and shop is not None and shop.organization is not None:
        org = shop.organization
    if org is None:
        org = await db.get(Organization, org_id)
    return org.name if org is not None else None


async def build_user_session(db: AsyncSession, user: User) -> UserSession:
    """Build the authenticated-session payload for login and ``/me``."""
    shop = user.shop
    requires_price_setup = False
    if user.role == UserRole.SHOP_ACCOUNT and shop is not None:
        requires_price_setup = await _requires_price_setup(db, shop.id)

    permissions = sorted(await load_user_permissions(db, user))
    next_screen = await _resolve_next_screen(db, user)
    organization_name = await _organization_name_for_user(db, user)

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
    db: AsyncSession, user: User, normalized_username: str
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
        org = await db.get(Organization, user.organization_id)
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
        org = await db.get(Organization, shop.organization_id)
        if org is None or not org.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=ORGANIZATION_DISABLED_BY_SUPER_ADMIN,
            )


async def login_user(
    db: AsyncSession,
    username: str,
    password: str,
    *,
    client_ip: str | None = None,
) -> LoginResponse:
    normalized_username = normalize_username(username)
    await _check_login_rate_limit(client_ip, normalized_username)
    user = await db.scalar(
        select(User)
        .options(
            selectinload(User.shop).selectinload(Shop.organization),
            selectinload(User.organization),
        )
        .where(func.lower(User.username) == normalized_username)
    )
    if user is None or not verify_password(password, user.password_hash):
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

    await _validate_login_eligibility(db, user, normalized_username)

    user.last_login_at = datetime.now(UTC)
    await db.flush()
    await db.commit()

    log_event(
        logger,
        logging.INFO,
        "login_succeeded",
        "login succeeded",
        user_id=str(user.id),
        role=user.role.value,
    )

    token = create_access_token_for_user(user)
    session = await build_user_session(db, user)
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


async def register_admin(db: AsyncSession, payload: RegisterRequest) -> LoginResponse:
    if get_settings().production:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Admin registration is not available",
        )

    existing_admin = await db.scalar(
        select(User.id).where(User.role.in_([UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN]))
    )
    if existing_admin is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Admin registration is already completed",
        )

    default_org = await db.scalar(select(Organization).where(Organization.slug == DEFAULT_ORG_SLUG))
    if default_org is None:
        default_org = Organization(
            name="Duro POS Default",
            slug=DEFAULT_ORG_SLUG,
            is_active=True,
        )
        db.add(default_org)
        await db.flush()

    existing_user = await db.scalar(
        select(User.id).where(
            func.lower(User.username) == payload.username,
            User.organization_id == default_org.id,
        )
    )
    if existing_user is not None:
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
    db.add(user)
    await db.flush()
    await db.commit()
    await db.refresh(user)

    token = create_access_token_for_user(user)
    session = await build_user_session(db, user)
    return LoginResponse(access_token=token, user=session)
