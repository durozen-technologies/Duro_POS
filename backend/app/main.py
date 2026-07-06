import logging
import socket
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.core.config import get_settings
from app.core.errors import http_exception_handler
from app.core.logging import configure_logging, log_event
from app.core.middleware import (
    RequestIdMiddleware,
    RequestTimingMiddleware,
    SecurityHeadersMiddleware,
    SelectiveGZipMiddleware,
)
from app.core.redis_cache import configure_redis_environment
from app.db.tenant_schema import is_postgres_database, run_all_tenant_migrations
from app.db.startup import run_database_startup_tasks
from app.routers import api_router

configure_redis_environment()

settings = get_settings()
configure_logging(production=settings.production)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.core.redis_cache import bind_app

    bind_app(app)
    app.state.database_ready = False
    app.state.database_error = None

    try:
        await run_database_startup_tasks()

        if is_postgres_database():
            run_all_tenant_migrations()
        app.state.database_ready = True
    except Exception as exc:
        app.state.database_error = str(exc)
        log_event(
            logger,
            logging.ERROR,
            "database_startup_failed",
            "database initialization failed during startup",
            error=str(exc),
        )
        logger.exception("Database initialization failed during startup.")
        if settings.production:
            raise
    yield


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    lifespan=lifespan,
    docs_url=None if settings.production else "/docs",
    redoc_url=None if settings.production else "/redoc",
    openapi_url=None if settings.production else f"{settings.api_v1_prefix}/openapi.json",
)

try:
    from redis_fastapi import FastAPIRedis

    FastAPIRedis(app).lifespan()
except ImportError as exc:
    logger.warning(
        "fastapi-redis-sdk not available (%s); Redis caching disabled. "
        "Run: cd backend && uv sync && uv run uvicorn main:app --reload",
        exc,
    )


@app.exception_handler(HTTPException)
async def handle_http_exception(request: Request, exc: HTTPException) -> JSONResponse:
    return await http_exception_handler(request, exc)


@app.exception_handler(SQLAlchemyError)
async def handle_database_error(_: Request, exc: SQLAlchemyError) -> JSONResponse:
    log_event(
        logger,
        logging.ERROR,
        "database_request_failed",
        "database request failed",
    )
    logger.exception("Database request failed.", exc_info=exc)
    return JSONResponse(
        status_code=503,
        content={
            "detail": "Database is unavailable. Please verify the database host and try again.",
        },
    )


@app.exception_handler(socket.gaierror)
async def handle_database_dns_error(_: Request, exc: socket.gaierror) -> JSONResponse:
    log_event(
        logger,
        logging.ERROR,
        "database_dns_failed",
        "database host resolution failed",
    )
    logger.exception("Database host resolution failed.", exc_info=exc)
    return JSONResponse(
        status_code=503,
        content={
            "detail": "Database host could not be resolved. Check DATABASE_URL host and network DNS access.",
        },
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=settings.cors_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(SecurityHeadersMiddleware, enable_hsts=settings.production)
app.add_middleware(
    RequestTimingMiddleware,
    threshold_seconds=settings.slow_request_threshold_seconds,
)
app.add_middleware(RequestIdMiddleware)
app.add_middleware(SelectiveGZipMiddleware, minimum_size=1024)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)

app.include_router(api_router, prefix=settings.api_v1_prefix)
