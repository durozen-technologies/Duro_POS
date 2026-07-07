"""Normalize PostgreSQL SQLAlchemy URLs for async (asyncpg) or sync (psycopg) drivers."""

from __future__ import annotations

from sqlalchemy.engine import URL, make_url

_ASYNC_DRIVER = "postgresql+asyncpg"
_PGBOUNCER_DRIVER = "postgresql+psycopg"
_SYNC_DRIVER = "postgresql+psycopg"
_ASYNC_ONLY_QUERY_KEYS = frozenset({"prepared_statement_cache_size", "statement_cache_size"})
_POSTGRES_DRIVERS = frozenset(
    {"postgres", "postgresql", _ASYNC_DRIVER, _SYNC_DRIVER, "postgresql+psycopg2"}
)


def is_async_postgres_database_url(url: str) -> bool:
    driver = make_url(url).drivername
    return driver in {"postgres", "postgresql", _ASYNC_DRIVER, _PGBOUNCER_DRIVER}


def async_postgres_database_url(url: str) -> str:
    parsed = make_url(url)
    if parsed.drivername in _POSTGRES_DRIVERS and parsed.drivername != _ASYNC_DRIVER:
        parsed = parsed.set(drivername=_ASYNC_DRIVER)
    return parsed.render_as_string(hide_password=False)


def sync_postgres_database_url(url: str) -> str:
    parsed = make_url(url)
    if parsed.drivername in _POSTGRES_DRIVERS and parsed.drivername != _SYNC_DRIVER:
        parsed = parsed.set(drivername=_SYNC_DRIVER)
    if parsed.query:
        filtered_query = {
            key: value
            for key, value in parsed.query.items()
            if key not in _ASYNC_ONLY_QUERY_KEYS
        }
        if len(filtered_query) != len(parsed.query):
            parsed = parsed.set(query=filtered_query)
    return parsed.render_as_string(hide_password=False)


def async_postgres_url_object(url: str) -> URL:
    return make_url(async_postgres_database_url(url))


def uses_pgbouncer(url: URL) -> bool:
    host = (url.host or "").lower()
    return host == "pgbouncer" or host.endswith(".pgbouncer")


def engine_database_url_object(database_url: str) -> URL:
    """URL for create_async_engine — psycopg async behind PgBouncer, asyncpg for direct Postgres."""
    parsed = make_url(database_url)
    if parsed.drivername in _POSTGRES_DRIVERS:
        if uses_pgbouncer(parsed):
            parsed = parsed.set(drivername=_PGBOUNCER_DRIVER)
        elif parsed.drivername not in {_ASYNC_DRIVER, _PGBOUNCER_DRIVER}:
            parsed = parsed.set(drivername=_ASYNC_DRIVER)
    return strip_async_only_query_params(parsed)


def engine_connect_args_for_url(url: URL) -> dict[str, object]:
    """PgBouncer: psycopg with server-side prepare disabled (no __asyncpg_stmt_* collisions)."""
    if uses_pgbouncer(url):
        return {"prepare_threshold": None}

    if url.drivername == _ASYNC_DRIVER:
        prepared_cache = url.query.get("prepared_statement_cache_size")
        if prepared_cache in (None, "", "0", 0):
            return {"prepared_statement_cache_size": 0}
    return {}


def strip_async_only_query_params(url: URL) -> URL:
    if not url.query:
        return url
    filtered_query = {
        key: value for key, value in url.query.items() if key not in _ASYNC_ONLY_QUERY_KEYS
    }
    if len(filtered_query) == len(url.query):
        return url
    return url.set(query=filtered_query)
