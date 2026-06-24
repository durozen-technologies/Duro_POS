from collections.abc import AsyncGenerator

from sqlalchemy import MetaData
from sqlalchemy.engine import URL, make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from ..core.config import get_settings

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


def _build_engine_config(database_url: str) -> tuple[URL | str, dict[str, str]]:
    url = make_url(database_url)
    connect_args: dict[str, str] = {}

    if url.drivername in {"postgres", "postgresql"}:
        url = url.set(drivername="postgresql+asyncpg")

    sslmode = url.query.get("sslmode")
    # url.query.get may return a str or a tuple/list of str depending on how URL was parsed.
    if sslmode:
        if isinstance(sslmode, (list, tuple)):
            sslmode = sslmode[0] if sslmode else ""
        if sslmode:
            connect_args["ssl"] = sslmode
            url = url.set(query={key: value for key, value in url.query.items() if key != "sslmode"})

    return url, connect_args


engine: AsyncEngine | None = None
SessionLocal: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    global engine
    if engine is None:
        engine_url, engine_connect_args = _build_engine_config(settings.database_url)
        engine = create_async_engine(
            engine_url,
            future=True,
            connect_args=engine_connect_args,
            pool_pre_ping=True,
            pool_size=settings.db_pool_size,
            max_overflow=settings.db_max_overflow,
            pool_timeout=settings.db_pool_timeout,
            pool_recycle=settings.db_pool_recycle,
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


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with get_session_local()() as db:
        try:
            yield db
        except Exception:
            await db.rollback()
            raise
