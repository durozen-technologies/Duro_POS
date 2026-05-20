from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse

router = APIRouter()


@router.get("/health")
def health_check(request: Request) -> JSONResponse:
    database_ready = getattr(request.app.state, "database_ready", False)
    database_error = getattr(request.app.state, "database_error", None)

    health_status = "ok" if database_ready else "degraded"
    response_status = (
        status.HTTP_200_OK
        if database_ready or database_error is None
        else status.HTTP_503_SERVICE_UNAVAILABLE
    )

    return JSONResponse(
        status_code=response_status,
        content={
            "status": health_status,
            "database": "connected" if database_ready else "unavailable",
            "error": database_error,
        },
    )
