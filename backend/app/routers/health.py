import logging

from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.core.logging import log_event

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/health")
def health_check(request: Request) -> JSONResponse:
    settings = get_settings()
    database_ready = getattr(request.app.state, "database_ready", False)
    database_error = getattr(request.app.state, "database_error", None)

    if database_error:
        log_event(
            logger,
            logging.ERROR,
            "health_check_database_unavailable",
            "database unavailable at health check",
            database_error=database_error,
        )

    health_status = "ok" if database_ready else "degraded"
    response_status = (
        status.HTTP_200_OK
        if database_ready or database_error is None
        else status.HTTP_503_SERVICE_UNAVAILABLE
    )

    content: dict[str, str | None] = {
        "status": health_status,
        "database": "connected" if database_ready else "unavailable",
    }
    if not settings.production:
        content["error"] = database_error

    return JSONResponse(status_code=response_status, content=content)
