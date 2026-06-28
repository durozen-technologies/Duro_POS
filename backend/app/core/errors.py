"""Map HTTP status codes and message patterns to stable API error codes."""

from fastapi import HTTPException, Request, status
from fastapi.responses import JSONResponse

from app.schemas.common import APIErrorDetail, APIErrorResponse

_STATUS_DEFAULT_CODES: dict[int, str] = {
    status.HTTP_400_BAD_REQUEST: "BAD_REQUEST",
    status.HTTP_401_UNAUTHORIZED: "UNAUTHORIZED",
    status.HTTP_403_FORBIDDEN: "FORBIDDEN",
    status.HTTP_404_NOT_FOUND: "NOT_FOUND",
    status.HTTP_409_CONFLICT: "CONFLICT",
    status.HTTP_422_UNPROCESSABLE_CONTENT: "VALIDATION_ERROR",
    status.HTTP_503_SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
}

_MESSAGE_CODES: dict[str, str] = {
    "Invalid username or password": "INVALID_CREDENTIALS",
    "Not authenticated": "NOT_AUTHENTICATED",
    "Invalid authentication credentials": "INVALID_CREDENTIALS",
    "User account is inactive": "USER_INACTIVE",
    "Shop account is disabled": "SHOP_DISABLED",
    "Insufficient permissions": "FORBIDDEN",
    "Invalid checkout token": "INVALID_CHECKOUT_TOKEN",
    "Checkout token expired. Please print the receipt again.": "CHECKOUT_TOKEN_EXPIRED",
}


def error_code_for_http_exception(exc: HTTPException) -> str:
    if isinstance(exc.detail, dict):
        code = exc.detail.get("code")
        if isinstance(code, str) and code:
            return code
    if isinstance(exc.detail, str):
        return _MESSAGE_CODES.get(exc.detail, _STATUS_DEFAULT_CODES.get(exc.status_code, "HTTP_ERROR"))
    return _STATUS_DEFAULT_CODES.get(exc.status_code, "HTTP_ERROR")


def error_message_for_http_exception(exc: HTTPException) -> str:
    if isinstance(exc.detail, str):
        return exc.detail
    if isinstance(exc.detail, dict):
        message = exc.detail.get("message")
        if isinstance(message, str) and message:
            return message
        return str(exc.detail)
    return "Request failed"


def error_details_for_http_exception(exc: HTTPException) -> dict | list | None:
    if isinstance(exc.detail, dict):
        details = exc.detail.get("details")
        if details is not None:
            return details
        filtered = {key: value for key, value in exc.detail.items() if key not in {"code", "message"}}
        return filtered or None
    return None


async def http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
    body = APIErrorResponse(
        error=APIErrorDetail(
            code=error_code_for_http_exception(exc),
            message=error_message_for_http_exception(exc),
            details=error_details_for_http_exception(exc),
        )
    )
    return JSONResponse(status_code=exc.status_code, content=body.model_dump(exclude_none=True))
