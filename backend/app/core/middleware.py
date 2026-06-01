import gzip
import logging
from time import perf_counter
from uuid import uuid4

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

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

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(raw=message["headers"])
                headers["X-Request-ID"] = request_id
            await send(message)

        await self.app(scope, receive, send_wrapper)


class SlowAdminRouteLoggingMiddleware:
    """Log slow admin item and image routes without adding per-endpoint boilerplate."""

    def __init__(self, app: ASGIApp, threshold_seconds: float = 0.75) -> None:
        self.app = app
        self.threshold_seconds = threshold_seconds

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not self._should_track(str(scope.get("path", ""))):
            await self.app(scope, receive, send)
            return

        started_at = perf_counter()
        status_code: int | None = None

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = int(message["status"])
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            elapsed_seconds = perf_counter() - started_at
            if elapsed_seconds >= self.threshold_seconds or (status_code is not None and status_code >= 500):
                logger.warning(
                    "Tracked admin item route path=%s method=%s status=%s elapsed_ms=%.1f request_id=%s",
                    scope.get("path"),
                    scope.get("method"),
                    status_code,
                    elapsed_seconds * 1000,
                    scope.get("request_id", ""),
                )

    @staticmethod
    def _should_track(path: str) -> bool:
        return (
            path.startswith("/api/v1/catalog/items/") and path.endswith("/image")
        ) or (
            path.startswith("/api/v1/admin/")
            and any(
                marker in path
                for marker in (
                    "/items/rows",
                    "/items/counts",
                    "/selected-items/",
                    "/item-import-candidates/",
                    "/prices/bootstrap",
                )
            )
        )


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
