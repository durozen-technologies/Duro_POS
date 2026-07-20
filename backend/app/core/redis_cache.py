"""Optional Redis helpers for permission, shop hot-read, and org→schema caches."""

from __future__ import annotations

import hashlib
import logging
import os
from typing import Any
from urllib.parse import quote, urlparse, urlunparse
from uuid import UUID

from fastapi import FastAPI

logger = logging.getLogger(__name__)

_bound_app: FastAPI | None = None
_GEN_TTL_SECONDS = 7 * 24 * 60 * 60

try:
    from redis_fastapi.cache_backend import CacheBackend
    from redis_fastapi.config import get_settings as get_redis_settings
    from redis_fastapi.deps import _get_pool_state
except ImportError:  # ponytail: tests/dev without redis sdk still run
    CacheBackend = None  # type: ignore[assignment,misc]

    def get_redis_settings():  # type: ignore[misc]
        class _Disabled:
            url = ""
            prefix = "brolier360"

        return _Disabled()

    def _get_pool_state(_app):  # type: ignore[misc]
        raise RuntimeError("redis sdk unavailable")


def merge_redis_password_into_url(url: str, password: str | None) -> str:
    """Embed password in Redis URL when missing (redis_fastapi URL mode only)."""
    trimmed = url.strip()
    if not trimmed or not password or not password.strip():
        return trimmed
    parsed = urlparse(trimmed)
    if parsed.password:
        return trimmed
    host = parsed.hostname or ""
    if parsed.port is not None:
        host = f"{host}:{parsed.port}"
    encoded_password = quote(password.strip(), safe="")
    if parsed.username:
        netloc = f"{quote(parsed.username, safe='')}:{encoded_password}@{host}"
    else:
        netloc = f":{encoded_password}@{host}"
    return urlunparse(
        (parsed.scheme, netloc, parsed.path or "", parsed.params, parsed.query, parsed.fragment)
    )


def configure_redis_environment() -> None:
    """Push backend/.env Redis settings into os.environ for redis_fastapi."""
    from app.core.config import get_settings

    settings = get_settings()
    redis_url = (settings.redis_url or "").strip()
    if redis_url and settings.redis_password:
        redis_url = merge_redis_password_into_url(redis_url, settings.redis_password)
    if redis_url:
        os.environ["REDIS_URL"] = redis_url
    if settings.redis_prefix:
        os.environ.setdefault("REDIS_PREFIX", settings.redis_prefix.strip())
    # redis_fastapi ignores KV password when url is set; drop to avoid UserWarning.
    os.environ.pop("REDIS_PASSWORD", None)
    if CacheBackend is not None:
        get_redis_settings.cache_clear()  # type: ignore[attr-defined]


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
    return getattr(get_redis_settings(), "prefix", None) or "brolier360"


def permission_cache_key(user_id: str, perm_version: int) -> str:
    prefix = _redis_key_prefix()
    return f"{prefix}:perm:{user_id}:{perm_version}"


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


def _shop_bills_gen_key(shop_id: UUID) -> str:
    return f"{_redis_key_prefix()}:shop:{shop_id}:bills:gen"


def _shop_bootstrap_gen_key(shop_id: UUID) -> str:
    return f"{_redis_key_prefix()}:shop:{shop_id}:bootstrap:gen"


def _shop_inventory_summary_gen_key(shop_id: UUID) -> str:
    return f"{_redis_key_prefix()}:shop:{shop_id}:invsum:gen"


async def _get_generation(gen_key: str) -> int:
    raw = await cache_get_json(gen_key)
    if isinstance(raw, int):
        return raw
    if isinstance(raw, str) and raw.isdigit():
        return int(raw)
    return 0


async def _bump_generation(gen_key: str) -> None:
    current = await _get_generation(gen_key)
    await cache_set_json(gen_key, current + 1, ttl_seconds=_GEN_TTL_SECONDS)


def hash_cache_parts(*parts: object) -> str:
    """Stable short hash for filter/query dimensions in cache keys."""
    payload = "|".join("" if part is None else str(part) for part in parts)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


async def shop_bills_cache_key(shop_id: UUID, filter_hash: str) -> str:
    gen = await _get_generation(_shop_bills_gen_key(shop_id))
    return f"{_redis_key_prefix()}:shop:{shop_id}:bills:v{gen}:{filter_hash}"


async def shop_bootstrap_cache_key(shop_id: UUID, price_date: str) -> str:
    gen = await _get_generation(_shop_bootstrap_gen_key(shop_id))
    return f"{_redis_key_prefix()}:shop:{shop_id}:bootstrap:v{gen}:{price_date}"


async def shop_inventory_summary_cache_key(
    shop_id: UUID,
    *,
    include_unallocated: bool,
    active_allocations_only: bool,
) -> str:
    gen = await _get_generation(_shop_inventory_summary_gen_key(shop_id))
    flags = f"{int(include_unallocated)}{int(active_allocations_only)}"
    return f"{_redis_key_prefix()}:shop:{shop_id}:invsum:v{gen}:{flags}"


def org_schema_cache_key(organization_id: UUID) -> str:
    return f"{_redis_key_prefix()}:org:{organization_id}:schema"


async def evict_shop_bills_cache(shop_id: UUID) -> None:
    await _bump_generation(_shop_bills_gen_key(shop_id))


async def evict_shop_bootstrap_cache(shop_id: UUID) -> None:
    await _bump_generation(_shop_bootstrap_gen_key(shop_id))


async def evict_shop_inventory_summary_cache(shop_id: UUID) -> None:
    await _bump_generation(_shop_inventory_summary_gen_key(shop_id))


async def evict_org_schema_cache(organization_id: UUID) -> None:
    await cache_delete(org_schema_cache_key(organization_id))
