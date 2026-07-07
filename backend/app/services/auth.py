import json
import logging
import time
from datetime import UTC, date, datetime
from pathlib import Path
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.tenant_context import load_user_permissions, session_role_for_user
from app.auth.tenant_shop import shop_for_user as _shop_for_user
from app.core.config import get_settings
from app.core.errors import (
    ACCOUNT_DISABLED_BY_SUPER_ADMIN,
    ORGANIZATION_DISABLED_BY_SUPER_ADMIN,
)
from app.core.login_rate_limit import enforce_login_rate_limit
from app.core.logging import log_event
from app.core.security import (
    create_access_token_for_user,
    get_password_hash,
    verify_password,
)
from app.db.tenant_context_var import reset_active_tenant_schema, set_active_tenant_schema
from app.db.tenant_schema import (
    is_postgres_session,
    set_search_path,
    tenant_schema_scope,
)
from app.models import (
    DailyPrice,
    Item,
    Organization,
    Shop,
    ShopItemAllocation,
    User,
    UserAuthIndex,
    UserRole,
)
from app.models.enums import is_super_admin, is_tenant_admin
from app.services.session_invalidation import invalidate_user_sessions
from app.schemas.auth import (
    LoginResponse,
    PasswordResetRequest,
    PasswordResetResponse,
    RegisterRequest,
    UserSession,
    normalize_username,
)
from app.services.user_auth_index import upsert_auth_index, username_is_globally_taken

logger = logging.getLogger(__name__)

#region agent log
_DEBUG_LOG_PATHS = (
    Path(__file__).resolve().parents[3] / ".cursor" / "debug-3261f4.log",
    Path("/tmp/debug-3261f4.log"),
)


def _agent_debug_log(
    *,
    hypothesis_id: str,
    location: str,
    message: str,
    data: dict[str, object],
    run_id: str = "pre-fix",
) -> None:
    payload = {
        "sessionId": "3261f4",
        "runId": run_id,
        "hypothesisId": hypothesis_id,
        "location": location,
        "message": message,
        "data": data,
        "timestamp": int(time.time() * 1000),
    }
    line = json.dumps(payload, default=str) + "\n"
    for path in _DEBUG_LOG_PATHS:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as handle:
                handle.write(line)
            break
        except OSError:
            continue


def _hash_fingerprint(hashed_password: str | None) -> dict[str, object]:
    if not hashed_password:
        return {"present": False}
    parts = hashed_password.split("$")
    return {
        "present": True,
        "length": len(hashed_password),
        "scheme": parts[1] if len(parts) > 1 else "unknown",
        "variant": parts[2] if len(parts) > 2 else "unknown",
    }


#endregion


async def _requires_price_setup(db: AsyncSession, shop_id: UUID) -> bool:
    shop = await db.get(Shop, shop_id)
    if shop is None:
        return True
    if shop.daily_prices_published_on != date.today():
        return True
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
                            ShopItemAllocation.is_active.is_(True),
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


async def _resolve_next_screen(db: AsyncSession, user: User, shop: Shop | None) -> str:
    if is_super_admin(user.role):
        return "super_admin_dashboard"
    if is_tenant_admin(user.role):
        return "admin_dashboard"
    if user.role == UserRole.SHOP_ACCOUNT and shop is not None:
        if await _requires_price_setup(db, shop.id):
            return "daily_price_setup"
        return "billing"
    return "admin_dashboard"


async def _organization_name_for_user(
    platform_db: AsyncSession, user: User, shop: Shop | None
) -> str | None:
    org_id = user.organization_id
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
    shop = await _shop_for_user(tenant_db, user)
    requires_price_setup = False
    if shop is not None:
        requires_price_setup = await _requires_price_setup(tenant_db, shop.id)

    permissions = sorted(await load_user_permissions(tenant_db, user))
    next_screen = await _resolve_next_screen(tenant_db, user, shop)
    organization_name = await _organization_name_for_user(platform_db, user, shop)

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
        shop = await _shop_for_user(tenant_db, user)
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
    db: AsyncSession,
    *,
    user_id: UUID,
) -> User | None:
    return await db.scalar(
        select(User).options(selectinload(User.organization)).where(User.id == user_id)
    )


async def logout_user(db: AsyncSession, user: User) -> None:
    await invalidate_user_sessions(user)
    await db.flush()
    await db.commit()


async def login_user(
    platform_db: AsyncSession,
    username: str,
    password: str,
    *,
    organization_slug: str | None = None,
    client_ip: str | None = None,
) -> LoginResponse:
    normalized_username = normalize_username(username)
    _agent_debug_log(
        hypothesis_id="H1-H4",
        location="auth.py:login_user:start",
        message="login attempt normalized",
        data={
            "username": normalized_username,
            "organization_slug": organization_slug.strip().lower() if organization_slug else None,
        },
    )
    await enforce_login_rate_limit(
        client_ip=client_ip or "unknown",
        username=normalized_username,
    )

    user: User | None = None
    tenant_schema_name: str | None = None

    super_admin = await platform_db.scalar(
        select(User)
        .options(selectinload(User.organization))
        .where(
            func.lower(User.username) == normalized_username,
            User.role == UserRole.SUPER_ADMIN,
            User.organization_id.is_(None),
        )
    )
    super_admin_verified = False
    if super_admin is not None:
        super_admin_verified = verify_password(password, super_admin.password_hash)
    _agent_debug_log(
        hypothesis_id="H1-H3",
        location="auth.py:login_user:super_admin",
        message="super admin candidate checked",
        data={
            "found": super_admin is not None,
            "verified": super_admin_verified,
            "user_id": str(super_admin.id) if super_admin is not None else None,
            "hash": _hash_fingerprint(super_admin.password_hash) if super_admin is not None else None,
        },
    )
    if super_admin is not None and super_admin_verified:
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

        _agent_debug_log(
            hypothesis_id="H1-H2-H4",
            location="auth.py:login_user:auth_index",
            message="tenant auth index resolved",
            data={
                "found": auth_entry is not None,
                "schema_name": auth_entry.schema_name if auth_entry is not None else None,
                "user_id": str(auth_entry.user_id) if auth_entry is not None else None,
                "organization_id": (
                    str(auth_entry.organization_id) if auth_entry is not None else None
                ),
            },
        )
        if auth_entry is not None:
            tenant_schema_name = auth_entry.schema_name
            async with tenant_schema_scope(platform_db, tenant_schema_name):
                candidate = await _load_tenant_user(platform_db, user_id=auth_entry.user_id)
                candidate_verified = False
                if candidate is not None:
                    candidate_verified = verify_password(password, candidate.password_hash)
                _agent_debug_log(
                    hypothesis_id="H2-H3-H5",
                    location="auth.py:login_user:tenant_candidate",
                    message="tenant candidate checked",
                    data={
                        "found": candidate is not None,
                        "verified": candidate_verified,
                        "schema_name": tenant_schema_name,
                        "user_id": str(candidate.id) if candidate is not None else None,
                        "username": candidate.username if candidate is not None else None,
                        "hash": (
                            _hash_fingerprint(candidate.password_hash)
                            if candidate is not None
                            else None
                        ),
                    },
                )
                if candidate is not None and candidate_verified:
                    user = candidate

    if user is None:
        _agent_debug_log(
            hypothesis_id="H1-H5",
            location="auth.py:login_user:invalid_credentials",
            message="login rejected",
            data={
                "username": normalized_username,
                "used_tenant_schema": tenant_schema_name,
            },
        )
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

    async def _finish_login(db: AsyncSession) -> LoginResponse:
        await _validate_login_eligibility(db, platform_db, user, normalized_username)
        token = create_access_token_for_user(user)
        session = await build_user_session(db, platform_db, user)
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
        return LoginResponse(access_token=token, user=session)

    if tenant_schema_name:
        async with tenant_schema_scope(platform_db, tenant_schema_name):
            return await _finish_login(platform_db)

    return await _finish_login(platform_db)


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
    await invalidate_user_sessions(user)
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

    if not await is_postgres_session(platform_db):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin registration requires PostgreSQL",
        )

    target_org = await platform_db.scalar(
        select(Organization)
        .where(Organization.schema_name.is_not(None))
        .order_by(Organization.created_at)
        .limit(1)
    )
    if target_org is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Create an organization via super admin before registering a tenant admin",
        )

    token = set_active_tenant_schema(target_org.schema_name)
    try:
        await set_search_path(platform_db, target_org.schema_name)
        if await username_is_globally_taken(platform_db, payload.username):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Username already exists",
            )

        user = User(
            username=payload.username,
            password_hash=get_password_hash(payload.password),
            role=UserRole.TENANT_ADMIN,
            organization_id=target_org.id,
            is_active=True,
        )
        platform_db.add(user)
        await platform_db.flush()
        await upsert_auth_index(platform_db, user=user, schema_name=target_org.schema_name)
        await platform_db.commit()
        await platform_db.refresh(user)
    finally:
        reset_active_tenant_schema(token)

    access = create_access_token_for_user(user)
    ctx_token = set_active_tenant_schema(target_org.schema_name)
    try:
        await set_search_path(platform_db, target_org.schema_name)
        session = await build_user_session(platform_db, platform_db, user)
    finally:
        reset_active_tenant_schema(ctx_token)
    return LoginResponse(access_token=access, user=session)
