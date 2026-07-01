"""Optional Redis helpers with graceful degradation."""

from __future__ import annotations

import json
import logging
from typing import Any

from uuid import UUID

from fastapi import FastAPI

logger = logging.getLogger(__name__)

_bound_app: FastAPI | None = None

try:
    from redis_fastapi.cache_backend import CacheBackend
    from redis_fastapi.config import get_settings as get_redis_settings
    from redis_fastapi.deps import _get_pool_state
except ImportError:  # ponytail: tests/dev without redis sdk still run
    CacheBackend = None  # type: ignore[assignment,misc]

    def get_redis_settings():  # type: ignore[misc]
        class _Disabled:
            url = ""
            key_prefix = "brolier360"

        return _Disabled()

    def _get_pool_state(_app):  # type: ignore[misc]
        raise RuntimeError("redis sdk unavailable")


def bind_app(app: FastAPI) -> None:
    global _bound_app
    _bound_app = app


def redis_enabled() -> bool:
    if CacheBackend is None:
        return False
    return bool((get_redis_settings().url or "").strip())


async def get_cache_backend_optional() -> Any | None:
    if not redis_enabled() or _bound_app is None or CacheBackend is None:
        return None
    try:
        client = _get_pool_state(_bound_app).get_async_client()
        await client.ping()
        return CacheBackend(client)
    except Exception:
        logger.debug("redis unavailable, bypassing cache", exc_info=True)
        return None


async def cache_get_json(key: str) -> Any | None:
    backend = await get_cache_backend_optional()
    if backend is None:
        return None
    try:
        return await backend.get(key)
    except Exception:
        logger.debug("redis cache get failed for %s", key, exc_info=True)
        return None


async def cache_set_json(key: str, value: Any, ttl_seconds: int) -> None:
    backend = await get_cache_backend_optional()
    if backend is None:
        return
    try:
        await backend.set(key, value, ttl=ttl_seconds)
    except Exception:
        logger.debug("redis cache set failed for %s", key, exc_info=True)


async def redis_health_status() -> str:
    if not redis_enabled():
        return "disabled"
    backend = await get_cache_backend_optional()
    if backend is None:
        return "unavailable"
    return "connected"


def _redis_key_prefix() -> str:
    return getattr(get_redis_settings(), "key_prefix", None) or "brolier360"


def permission_cache_key(user_id: str, perm_version: int) -> str:
    prefix = _redis_key_prefix()
    return f"{prefix}:perm:{user_id}:{perm_version}"


def dashboard_cache_key(organization_id: UUID, *, shop_id: UUID | None = None) -> str:
    prefix = _redis_key_prefix()
    shop_part = str(shop_id) if shop_id else "all"
    return f"{prefix}:org:{organization_id}:dashboard:bootstrap:v1:{shop_part}"


def super_org_counts_cache_key() -> str:
    prefix = _redis_key_prefix()
    return f"{prefix}:super:orgs:counts:v1"


def org_schema_cache_key(organization_id: UUID) -> str:
    prefix = _redis_key_prefix()
    return f"{prefix}:org:{organization_id}:schema"


def login_rate_cache_key(client_ip: str, username: str) -> str:
    prefix = _redis_key_prefix()
    return f"{prefix}:login:{client_ip}:{username.lower()}"


async def cache_delete(key: str) -> None:
    backend = await get_cache_backend_optional()
    if backend is None:
        return
    try:
        await backend.delete(key)
    except Exception:
        logger.debug("redis cache delete failed for %s", key, exc_info=True)


async def evict_user_permission_cache(user_id: UUID, perm_version: int) -> None:
    await cache_delete(permission_cache_key(str(user_id), perm_version))
