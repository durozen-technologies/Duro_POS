import logging
import socket
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from guard import SecurityConfig
from guard.middleware import SecurityMiddleware
from sqlalchemy.exc import SQLAlchemyError
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.core.config import get_settings
from app.core.middleware import RequestIdMiddleware
from app.db.database import initialize_database
from app.routers import api_router

settings = get_settings()
logger = logging.getLogger(__name__)


def build_security_config() -> SecurityConfig:
    return SecurityConfig(
        enable_redis=False,
        enable_rate_limiting=settings.enable_rate_limit,
        rate_limit=settings.rate_limit_requests,
        rate_limit_window=settings.rate_limit_window_seconds,
        exclude_paths=settings.rate_limit_exempt_paths,
        trusted_proxies=settings.trusted_proxies,
        trusted_proxy_depth=settings.trusted_proxy_depth,
        trust_x_forwarded_proto=settings.trust_x_forwarded_proto,
        enable_penetration_detection=settings.enable_penetration_detection,
        passive_mode=settings.security_passive_mode,
        log_request_level="INFO" if settings.enable_request_logging else None,
        log_suspicious_level="WARNING",
        custom_error_responses={
            429: "Rate limit exceeded. Please retry after a short delay.",
        },
        security_headers={
            "enabled": True,
            "frame_options": "DENY",
            "content_type_options": "nosniff",
            "xss_protection": "1; mode=block",
            "referrer_policy": "strict-origin-when-cross-origin",
            "custom": {
                "X-RateLimit-Window": str(settings.rate_limit_window_seconds),
            },
        },
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.database_ready = False
    app.state.database_error = None

    try:
        await initialize_database()
        app.state.database_ready = True
    except Exception as exc:
        app.state.database_error = str(exc)
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


@app.exception_handler(SQLAlchemyError)
async def handle_database_error(_: Request, exc: SQLAlchemyError) -> JSONResponse:
    logger.exception("Database request failed.", exc_info=exc)
    return JSONResponse(
        status_code=503,
        content={
            "detail": "Database is unavailable. Please verify the database host and try again.",
        },
    )


@app.exception_handler(socket.gaierror)
async def handle_database_dns_error(_: Request, exc: socket.gaierror) -> JSONResponse:
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
app.add_middleware(SecurityMiddleware, config=build_security_config())
app.add_middleware(RequestIdMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)

app.include_router(api_router, prefix=settings.api_v1_prefix)
