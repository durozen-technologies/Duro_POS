import json
import logging
import time
from collections.abc import AsyncGenerator
from pathlib import Path

from sqlalchemy import MetaData, event, text
from sqlalchemy.engine import URL
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from ..core.config import get_settings
from ..core.logging import log_event
from .postgres_url import (
    engine_connect_args_for_url,
    engine_database_url_object,
    uses_pgbouncer,
)
from .tenant_context_var import get_active_tenant_schema

settings = get_settings()
logger = logging.getLogger(__name__)

#region agent log
_DEBUG_LOG_PATHS = (
    Path(__file__).resolve().parents[3] / ".cursor" / "debug-3261f4.log",
    Path("/tmp/debug-3261f4.log"),
)


def _agent_debug_log(
    *,
    hypothesis_id: str,
    location: str,
    message: str,
    data: dict[str, object],
    run_id: str = "pre-fix",
) -> None:
    payload = {
        "sessionId": "3261f4",
        "runId": run_id,
        "hypothesisId": hypothesis_id,
        "location": location,
        "message": message,
        "data": data,
        "timestamp": int(time.time() * 1000),
    }
    line = json.dumps(payload, default=str) + "\n"
    for path in _DEBUG_LOG_PATHS:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as handle:
                handle.write(line)
            break
        except OSError:
            continue


#endregion

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def _build_engine_config(
    database_url: str,
) -> tuple[URL | str, dict[str, object], dict[str, object]]:
    url = engine_database_url_object(database_url)
    connect_args: dict[str, object] = {}
    engine_kwargs: dict[str, object] = {}

    sslmode = url.query.get("sslmode")
    if sslmode:
        if isinstance(sslmode, (list, tuple)):
            sslmode = sslmode[0] if sslmode else ""
        if sslmode:
            connect_args["ssl"] = sslmode
            url = url.set(
                query={key: value for key, value in url.query.items() if key != "sslmode"}
            )

    connect_args.update(engine_connect_args_for_url(url))
    if uses_pgbouncer(url):
        engine_kwargs["poolclass"] = NullPool

    return url, connect_args, engine_kwargs


engine: AsyncEngine | None = None
SessionLocal: async_sessionmaker[AsyncSession] | None = None
_search_path_listener_registered = False


def _register_search_path_reset_if_needed(engine_url: URL | str) -> None:
    """Reset search_path at ORM transaction start — pooled PG connections retain session state."""
    global _search_path_listener_registered
    if _search_path_listener_registered or "postgresql" not in str(engine_url):
        return

    from sqlalchemy.orm import Session

    @event.listens_for(Session, "after_begin")
    def _reset_search_path(_session, _transaction, connection) -> None:
        if connection.dialect.name == "postgresql":
            connection.execute(text("RESET search_path"))
            schema_name = get_active_tenant_schema()
            if schema_name:
                from .tenant_schema import assert_safe_schema_name

                safe = assert_safe_schema_name(schema_name)
                connection.execute(text(f'SET search_path TO "{safe}", public'))
            else:
                connection.execute(text("SET search_path TO public"))

    _search_path_listener_registered = True


def get_engine() -> AsyncEngine:
    global engine
    if engine is None:
        engine_url, engine_connect_args, engine_kwargs = _build_engine_config(
            settings.database_url
        )
        pool_kwargs: dict[str, object] = {}
        if engine_kwargs.get("poolclass") is not NullPool:
            pool_kwargs = {
                "pool_pre_ping": True,
                "pool_size": settings.db_pool_size,
                "max_overflow": settings.db_max_overflow,
                "pool_timeout": settings.db_pool_timeout,
                "pool_recycle": settings.db_pool_recycle,
            }
        engine = create_async_engine(
            engine_url,
            future=True,
            connect_args=engine_connect_args,
            **pool_kwargs,
            **engine_kwargs,
        )
        _register_search_path_reset_if_needed(engine_url)
        poolclass_name = (
            "NullPool"
            if engine_kwargs.get("poolclass") is NullPool
            else "QueuePool"
        )
        engine_info = {
            "driver": str(engine_url.drivername),
            "host": str(engine_url.host),
            "pgbouncer": uses_pgbouncer(engine_url),
            "poolclass": poolclass_name,
            "connect_arg_keys": sorted(engine_connect_args.keys()),
        }
        log_event(
            logger,
            logging.INFO,
            "database_engine_initialized",
            "async engine created",
            **engine_info,
        )
        _agent_debug_log(
            hypothesis_id="H1-H2",
            location="database.py:get_engine",
            message="engine initialized",
            data=engine_info,
        )
    return engine


def get_session_local() -> async_sessionmaker[AsyncSession]:
    global SessionLocal
    if SessionLocal is None:
        SessionLocal = async_sessionmaker(
            bind=get_engine(), autoflush=False, expire_on_commit=False
        )
    return SessionLocal


async def close_database_connections() -> None:
    global engine, SessionLocal

    if engine is not None:
        await engine.dispose()
    engine = None
    SessionLocal = None


async def ping_database() -> None:
    """DB liveness probe without server-side prepared statements (psycopg/asyncpg safe)."""
    async with get_engine().connect() as conn:
        dialect_name = conn.dialect.driver
        await conn.exec_driver_sql("SELECT 1")
        _agent_debug_log(
            hypothesis_id="H3",
            location="database.py:ping_database",
            message="health ping ok",
            data={"dialect_driver": dialect_name, "method": "exec_driver_sql"},
        )


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with get_session_local()() as db:
        try:
            yield db
        except Exception:
            await db.rollback()
            raise
