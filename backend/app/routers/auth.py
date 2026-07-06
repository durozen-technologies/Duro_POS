from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_active_user
from app.db.session import get_platform_db
from app.db.tenant_schema import tenant_router, tenant_schema_scope
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
from app.services.auth import build_user_session, login_user, logout_user, register_admin, reset_password_for_dev

router = APIRouter()


@router.post("/login", response_model=LoginResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    platform_db: AsyncSession = Depends(get_platform_db),
) -> LoginResponse:
    client_ip = request.client.host if request.client else "unknown"
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


@router.post("/logout", status_code=204)
async def logout(
    current_user: User = Depends(get_current_active_user),
    platform_db: AsyncSession = Depends(get_platform_db),
) -> None:
    await logout_user(platform_db, current_user)


@router.get("/me", response_model=UserSession)
async def me(
    current_user: User = Depends(get_current_active_user),
    platform_db: AsyncSession = Depends(get_platform_db),
) -> UserSession:
    if is_super_admin(current_user.role):
        return await build_user_session(platform_db, platform_db, current_user)

    org_id = current_user.organization_id
    if org_id is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Tenant schema is not configured for this organization",
        )
    schema_name = await tenant_router.resolve_schema(platform_db, org_id)
    if schema_name is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Tenant schema is not configured for this organization",
        )

    async with tenant_schema_scope(platform_db, schema_name):
        return await build_user_session(platform_db, platform_db, current_user)
