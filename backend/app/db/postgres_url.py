"""Normalize PostgreSQL SQLAlchemy URLs for async (asyncpg) or sync (psycopg) drivers."""

from __future__ import annotations

from sqlalchemy.engine import URL, make_url

_ASYNC_DRIVER = "postgresql+asyncpg"
_SYNC_DRIVER = "postgresql+psycopg"
_POSTGRES_DRIVERS = frozenset(
    {"postgres", "postgresql", _ASYNC_DRIVER, _SYNC_DRIVER, "postgresql+psycopg2"}
)


def is_async_postgres_database_url(url: str) -> bool:
    driver = make_url(url).drivername
    return driver in {"postgres", "postgresql", _ASYNC_DRIVER}


def async_postgres_database_url(url: str) -> str:
    parsed = make_url(url)
    if parsed.drivername in _POSTGRES_DRIVERS and parsed.drivername != _ASYNC_DRIVER:
        parsed = parsed.set(drivername=_ASYNC_DRIVER)
    return parsed.render_as_string(hide_password=False)


def sync_postgres_database_url(url: str) -> str:
    parsed = make_url(url)
    if parsed.drivername in _POSTGRES_DRIVERS and parsed.drivername != _SYNC_DRIVER:
        parsed = parsed.set(drivername=_SYNC_DRIVER)
    return parsed.render_as_string(hide_password=False)


def async_postgres_url_object(url: str) -> URL:
    return make_url(async_postgres_database_url(url))
