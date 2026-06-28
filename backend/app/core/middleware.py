import gzip
import logging
from time import perf_counter
from uuid import uuid4

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.logging import bind_request_id, log_event

GZIP_EXCLUDED_CONTENT_TYPES = ("text/event-stream", "image/")
logger = logging.getLogger(__name__)


class RequestIdMiddleware:
    """Attach a request ID so responses can be correlated in logs and clients."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = uuid4().hex
        scope["request_id"] = request_id
        bind_request_id(request_id)

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(raw=message["headers"])
                headers["X-Request-ID"] = request_id
            await send(message)

        await self.app(scope, receive, send_wrapper)


class RequestTimingMiddleware:
    """Log request lifecycle for all /api/v1 routes with structured fields."""

    def __init__(self, app: ASGIApp, *, threshold_seconds: float = 0.75) -> None:
        self.app = app
        self.threshold_seconds = threshold_seconds

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = str(scope.get("path", ""))
        if not path.startswith("/api/v1"):
            await self.app(scope, receive, send)
            return

        method = str(scope.get("method", ""))
        request_id = str(scope.get("request_id", ""))
        started_at = perf_counter()
        status_code: int | None = None

        log_event(
            logger,
            logging.DEBUG,
            "http_request_started",
            "request started",
            method=method,
            path=path,
            request_id=request_id,
        )

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = int(message["status"])
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            elapsed_ms = (perf_counter() - started_at) * 1000
            status = status_code if status_code is not None else 0
            if status >= 500:
                level = logging.ERROR
            elif status >= 400 or elapsed_ms >= self.threshold_seconds * 1000:
                level = logging.WARNING
            else:
                level = logging.INFO

            log_event(
                logger,
                level,
                "http_request_completed",
                "request completed",
                method=method,
                path=path,
                status=status,
                elapsed_ms=round(elapsed_ms, 1),
                request_id=request_id,
            )
            if elapsed_ms >= self.threshold_seconds * 1000:
                log_event(
                    logger,
                    logging.WARNING,
                    "http_request_slow",
                    "slow request",
                    method=method,
                    path=path,
                    status=status,
                    elapsed_ms=round(elapsed_ms, 1),
                    request_id=request_id,
                    threshold_ms=self.threshold_seconds * 1000,
                )


class SecurityHeadersMiddleware:
    """Set baseline security headers on every HTTP response."""

    def __init__(self, app: ASGIApp, *, enable_hsts: bool = False) -> None:
        self.app = app
        self.enable_hsts = enable_hsts

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(raw=message["headers"])
                headers["X-Content-Type-Options"] = "nosniff"
                headers["X-Frame-Options"] = "DENY"
                headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
                headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
                if self.enable_hsts:
                    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
            await send(message)

        await self.app(scope, receive, send_wrapper)


class SelectiveGZipMiddleware:
    """Compress JSON/text responses while leaving item images untouched."""

    def __init__(self, app: ASGIApp, minimum_size: int = 500, compresslevel: int = 6) -> None:
        self.app = app
        self.minimum_size = minimum_size
        self.compresslevel = compresslevel

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        if "gzip" not in headers.get("Accept-Encoding", ""):
            await self.app(scope, receive, send)
            return

        responder = _SelectiveGZipResponder(
            self.app,
            minimum_size=self.minimum_size,
            compresslevel=self.compresslevel,
        )
        await responder(scope, receive, send)


class _SelectiveGZipResponder:
    def __init__(self, app: ASGIApp, *, minimum_size: int, compresslevel: int) -> None:
        self.app = app
        self.minimum_size = minimum_size
        self.compresslevel = compresslevel
        self.initial_message: Message | None = None
        self.content_encoding_set = False
        self.content_type_excluded = False
        self.started = False
        self.send: Send | None = None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        self.send = send
        await self.app(scope, receive, self.send_with_gzip)

    async def send_with_gzip(self, message: Message) -> None:
        if self.send is None:
            raise RuntimeError("send awaitable not set")

        if message["type"] == "http.response.start":
            self.initial_message = message
            headers = Headers(raw=message["headers"])
            content_type = headers.get("content-type", "")
            self.content_encoding_set = "content-encoding" in headers
            self.content_type_excluded = content_type.startswith(GZIP_EXCLUDED_CONTENT_TYPES)
            return

        if message["type"] != "http.response.body" or self.initial_message is None:
            await self.send(message)
            return

        if self.content_encoding_set or self.content_type_excluded:
            if not self.started:
                self.started = True
                await self.send(self.initial_message)
            await self.send(message)
            return

        body = message.get("body", b"")
        more_body = bool(message.get("more_body", False))
        if more_body or len(body) < self.minimum_size:
            if not self.started:
                self.started = True
                await self.send(self.initial_message)
            await self.send(message)
            return

        compressed_body = gzip.compress(body, compresslevel=self.compresslevel)
        headers = MutableHeaders(raw=self.initial_message["headers"])
        headers.add_vary_header("Accept-Encoding")
        headers["Content-Encoding"] = "gzip"
        headers["Content-Length"] = str(len(compressed_body))
        message["body"] = compressed_body

        self.started = True
        await self.send(self.initial_message)
        await self.send(message)
