import logging

from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.core.logging import log_event
from app.core.redis_cache import redis_health_status
from app.db.database import ping_database
from app.db.storage.paths import settings as storage_settings

router = APIRouter()
readiness_router = APIRouter()
logger = logging.getLogger(__name__)


async def _database_ping() -> tuple[bool, str | None]:
    try:
        await ping_database()
        return True, None
    except Exception as exc:
        return False, str(exc)


@readiness_router.get("/health")
async def readiness_probe() -> JSONResponse:
    """Load-balancer readiness: cheap DB ping only."""
    ok, error = await _database_ping()
    if ok:
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"status": "ok", "database": "connected"},
        )
    log_event(
        logger,
        logging.ERROR,
        "readiness_probe_failed",
        "readiness database ping failed",
        error=error,
    )
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"status": "unavailable", "database": "unavailable"},
    )


async def _rustfs_health_status() -> str:
    if not storage_settings.rustfs_enabled:
        return "disabled"
    try:
        from app.db.storage import ensure_bucket_exists

        await ensure_bucket_exists()
        return "connected"
    except Exception:
        log_event(logger, logging.WARNING, "health_rustfs_unavailable", "rustfs unavailable")
        return "unavailable"


@router.get("/health")
async def health_check(request: Request) -> JSONResponse:
    settings = get_settings()
    database_ready, database_error = await _database_ping()

    if database_error:
        log_event(
            logger,
            logging.ERROR,
            "health_check_database_unavailable",
            "database unavailable at health check",
            database_error=database_error,
        )

    redis_status = await redis_health_status()
    rustfs_status = await _rustfs_health_status()

    health_status = "ok" if database_ready else "degraded"
    response_status = (
        status.HTTP_200_OK
        if database_ready or database_error is None
        else status.HTTP_503_SERVICE_UNAVAILABLE
    )

    content: dict[str, str | None] = {
        "status": health_status,
        "database": "connected" if database_ready else "unavailable",
        "redis": redis_status,
        "rustfs": rustfs_status,
    }
    if not settings.production:
        content["error"] = database_error

    return JSONResponse(status_code=response_status, content=content)
