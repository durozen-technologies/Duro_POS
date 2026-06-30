from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from jose import jwt
from pwdlib import PasswordHash

from app.core.config import get_settings
from app.models.enums import UserRole, normalize_user_role

settings = get_settings()
password_hash = PasswordHash.recommended()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return password_hash.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return password_hash.hash(password)


def create_access_token(
    subject: str | UUID,
    *,
    role: UserRole | None = None,
    org_id: UUID | None = None,
    perm_version: int = 0,
    expires_delta: timedelta | None = None,
) -> str:
    expire = datetime.now(UTC) + (
        expires_delta or timedelta(minutes=settings.access_token_expire_minutes)
    )
    payload: dict[str, Any] = {
        "sub": str(subject),
        "exp": expire,
        "perm_version": perm_version,
    }
    if role is not None:
        payload["role"] = normalize_user_role(role).value
    if org_id is not None:
        payload["org_id"] = str(org_id)
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def create_access_token_for_user(user) -> str:
    return create_access_token(
        user.id,
        role=user.role,
        org_id=user.organization_id,
        perm_version=getattr(user, "permissions_version", 0),
    )


def decode_access_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
