from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_active_user
from app.db.session import get_platform_db
from app.db.tenant_session import get_tenant_db
from app.db.tenant_context_var import reset_active_tenant_schema, set_active_tenant_schema
from app.db.tenant_schema import set_search_path, tenant_router
from app.models import User
from app.models.enums import is_super_admin
from app.schemas.auth import (
    LoginRequest,
    LoginResponse,
    PasswordResetRequest,
    PasswordResetResponse,
    RegisterRequest,
    UserSession,
)
from app.services.auth import build_user_session, login_user, register_admin, reset_password_for_dev

router = APIRouter()


@router.post("/login", response_model=LoginResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    platform_db: AsyncSession = Depends(get_platform_db),
) -> LoginResponse:
    client_ip = request.client.host if request.client else None
    return await login_user(
        platform_db,
        payload.username,
        payload.password,
        organization_slug=payload.organization_slug,
        client_ip=client_ip,
    )


@router.post("/register", response_model=LoginResponse, status_code=201)
async def register(
    payload: RegisterRequest,
    platform_db: AsyncSession = Depends(get_platform_db),
) -> LoginResponse:
    return await register_admin(platform_db, payload)


@router.post("/reset-password", response_model=PasswordResetResponse)
async def reset_password(
    payload: PasswordResetRequest,
    platform_db: AsyncSession = Depends(get_platform_db),
) -> PasswordResetResponse:
    return await reset_password_for_dev(platform_db, payload)


@router.get("/me", response_model=UserSession)
async def me(
    current_user: User = Depends(get_current_active_user),
    platform_db: AsyncSession = Depends(get_platform_db),
) -> UserSession:
    if is_super_admin(current_user.role):
        return await build_user_session(platform_db, platform_db, current_user)

    org_id = current_user.organization_id
    if org_id is None and current_user.shop is not None:
        org_id = current_user.shop.organization_id
    schema_name = await tenant_router.resolve_schema(platform_db, org_id) if org_id else None
    if schema_name is None:
        return await build_user_session(platform_db, platform_db, current_user)

    token = set_active_tenant_schema(schema_name)
    try:
        await set_search_path(platform_db, schema_name)
        return await build_user_session(platform_db, platform_db, current_user)
    finally:
        reset_active_tenant_schema(token)
