from datetime import UTC, date, datetime
from uuid import UUID

import logging

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.logging import log_event
from app.core.security import create_access_token, get_password_hash, verify_password
from app.models import DailyPrice, Item, ShopItemAllocation, User, UserRole
from app.schemas.auth import (
    LoginResponse,
    PasswordResetRequest,
    PasswordResetResponse,
    RegisterRequest,
    UserSession,
    normalize_username,
)


logger = logging.getLogger(__name__)


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


def _build_user_session(
    user: User,
    *,
    shop_id: UUID | None = None,
    shop_name: str | None = None,
    requires_price_setup: bool = False,
    next_screen: str,
) -> UserSession:
    return UserSession(
        id=user.id,
        username=user.username,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at,
        shop_id=shop_id,
        shop_name=shop_name,
        requires_price_setup=requires_price_setup,
        next_screen=next_screen,
    )


async def build_user_session(db: AsyncSession, user: User) -> UserSession:
    """Build the authenticated-session payload for login and ``/me``."""
    shop = user.shop
    requires_price_setup = False
    next_screen = "admin_dashboard"

    if user.role == UserRole.SHOP_ACCOUNT and shop is not None:
        requires_price_setup = await _requires_price_setup(db, shop.id)
        next_screen = "daily_price_setup" if requires_price_setup else "billing"

    return _build_user_session(
        user,
        shop_id=shop.id if shop else None,
        shop_name=shop.name if shop else None,
        requires_price_setup=requires_price_setup,
        next_screen=next_screen,
    )


async def login_user(db: AsyncSession, username: str, password: str) -> LoginResponse:
    normalized_username = normalize_username(username)
    user = await db.scalar(
        select(User)
        .options(selectinload(User.shop))
        .where(func.lower(User.username) == normalized_username)
    )
    if user is None or not verify_password(password, user.password_hash):
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
    if not user.is_active:
        log_event(
            logger,
            logging.WARNING,
            "login_failed",
            "login failed",
            username=normalized_username,
            reason="inactive_user",
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="User account is inactive"
        )
    if user.role == UserRole.SHOP_ACCOUNT and (user.shop is None or not user.shop.is_active):
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

    token = create_access_token(user.id)
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
        role=user.role,
        is_active=user.is_active,
    )


async def register_admin(db: AsyncSession, payload: RegisterRequest) -> LoginResponse:
    existing_admin = await db.scalar(select(User.id).where(User.role == UserRole.ADMIN))
    if existing_admin is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Admin registration is already completed",
        )

    existing_user = await db.scalar(
        select(User.id).where(func.lower(User.username) == payload.username)
    )
    if existing_user is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already exists",
        )

    user = User(
        username=payload.username,
        password_hash=get_password_hash(payload.password),
        role=UserRole.ADMIN,
        is_active=True,
    )
    db.add(user)
    await db.flush()

    await db.commit()
    await db.refresh(user)

    token = create_access_token(user.id)
    session = _build_user_session(user, next_screen="admin_dashboard")
    return LoginResponse(access_token=token, user=session)
