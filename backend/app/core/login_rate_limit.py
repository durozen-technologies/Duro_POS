"""Login brute-force throttling (in-memory per process)."""

from __future__ import annotations

import logging
import time
from collections import defaultdict
from threading import Lock

from fastapi import HTTPException, status

from app.core.logging import log_event

logger = logging.getLogger(__name__)

_WINDOW_SECONDS = 60
_IP_LIMIT = 10
_USERNAME_LIMIT = 5

_buckets: dict[str, list[float]] = defaultdict(list)
_lock = Lock()


def _memory_allow(key: str, limit: int) -> bool:
    now = time.monotonic()
    with _lock:
        bucket = _buckets[key]
        _buckets[key] = [stamp for stamp in bucket if now - stamp < _WINDOW_SECONDS]
        if len(_buckets[key]) >= limit:
            return False
        _buckets[key].append(now)
        return True


async def enforce_login_rate_limit(*, client_ip: str, username: str) -> None:
    ip_key = f"ip:{client_ip or 'unknown'}"
    user_key = f"user:{username.lower()}"

    if not _memory_allow(ip_key, _IP_LIMIT):
        log_event(
            logger,
            logging.WARNING,
            "login_rate_limited",
            "login rate limited by ip",
            client_ip=client_ip,
            username=username,
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Please wait a moment before retrying.",
        )

    if not _memory_allow(user_key, _USERNAME_LIMIT):
        log_event(
            logger,
            logging.WARNING,
            "login_rate_limited",
            "login rate limited by username",
            client_ip=client_ip,
            username=username,
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Please wait a moment before retrying.",
        )
