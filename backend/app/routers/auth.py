from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_active_user
from app.core.database import get_db
from app.models import User
from app.schemas.auth import LoginRequest, LoginResponse, RegisterRequest, UserSession
from app.services.auth import build_user_session, login_user, register_admin

router = APIRouter()


@router.post("/login", response_model=LoginResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)) -> LoginResponse:
    return await login_user(db, payload.username, payload.password)


@router.post("/register", response_model=LoginResponse, status_code=201)
async def register(payload: RegisterRequest, db: AsyncSession = Depends(get_db)) -> LoginResponse:
    return await register_admin(db, payload)


@router.get("/me", response_model=UserSession)
async def me(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> UserSession:
    return await build_user_session(db, current_user)
