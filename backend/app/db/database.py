from collections.abc import AsyncGenerator

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
from .postgres_url import (
    async_postgres_url_object,
    strip_async_only_query_params,
    uses_pgbouncer,
)
from .tenant_context_var import get_active_tenant_schema

settings = get_settings()

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
    url = async_postgres_url_object(database_url)
    connect_args: dict[str, object] = {}
    engine_kwargs: dict[str, object] = {}

    sslmode = url.query.get("sslmode")
    # url.query.get may return a str or a tuple/list of str depending on how URL was parsed.
    if sslmode:
        if isinstance(sslmode, (list, tuple)):
            sslmode = sslmode[0] if sslmode else ""
        if sslmode:
            connect_args["ssl"] = sslmode
            url = url.set(
                query={key: value for key, value in url.query.items() if key != "sslmode"}
            )

    if uses_pgbouncer(url):
        connect_args["prepared_statement_cache_size"] = 0
        engine_kwargs["poolclass"] = NullPool
    else:
        prepared_cache = url.query.get("prepared_statement_cache_size")
        if prepared_cache in (None, "", "0", 0):
            connect_args["prepared_statement_cache_size"] = 0

    url = strip_async_only_query_params(url)

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


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with get_session_local()() as db:
        try:
            yield db
        except Exception:
            await db.rollback()
            raise
