from datetime import date
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.security import create_access_token, get_password_hash, verify_password
from app.models import DailyPrice, User, UserRole
from app.schemas.auth import LoginResponse, RegisterRequest, UserSession


async def _requires_price_setup(db: AsyncSession, shop_id: UUID) -> bool:
    has_today_price = await db.scalar(
        select(
            select(DailyPrice.id)
            .where(
                DailyPrice.shop_id == shop_id,
                DailyPrice.price_date == date.today(),
            )
            .exists()
        )
    )
    return not bool(has_today_price)


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
    user = await db.scalar(
        select(User).options(selectinload(User.shop)).where(User.username == username)
    )
    if user is None or not verify_password(password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password"
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="User account is inactive"
        )
    if user.role == UserRole.SHOP_ACCOUNT and (user.shop is None or not user.shop.is_active):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Shop account is disabled"
        )

    token = create_access_token(user.id)
    session = await build_user_session(db, user)
    return LoginResponse(access_token=token, user=session)


async def register_admin(db: AsyncSession, payload: RegisterRequest) -> LoginResponse:
    existing_admin = await db.scalar(select(User.id).where(User.role == UserRole.ADMIN))
    if existing_admin is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Admin registration is already completed",
        )

    existing_user = await db.scalar(select(User.id).where(User.username == payload.username))
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
