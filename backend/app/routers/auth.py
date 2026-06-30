from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_active_user
from app.db.database import get_db
from app.models import User
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
    db: AsyncSession = Depends(get_db),
) -> LoginResponse:
    client_ip = request.client.host if request.client else None
    return await login_user(db, payload.username, payload.password, client_ip=client_ip)


@router.post("/register", response_model=LoginResponse, status_code=201)
async def register(payload: RegisterRequest, db: AsyncSession = Depends(get_db)) -> LoginResponse:
    return await register_admin(db, payload)


@router.post("/reset-password", response_model=PasswordResetResponse)
async def reset_password(
    payload: PasswordResetRequest, db: AsyncSession = Depends(get_db)
) -> PasswordResetResponse:
    return await reset_password_for_dev(db, payload)


@router.get("/me", response_model=UserSession)
async def me(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> UserSession:
    return await build_user_session(db, current_user)
