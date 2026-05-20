import asyncio
import logging
from collections import deque
from collections.abc import Iterable
from time import monotonic
from uuid import uuid4

from fastapi.responses import JSONResponse
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send


def _get_client_ip(scope: Scope) -> str:
    headers = {key.lower(): value for key, value in scope.get("headers", [])}
    forwarded_for = headers.get(b"x-forwarded-for")
    if forwarded_for:
        first_hop = forwarded_for.decode("utf-8").split(",")[0].strip()
        if first_hop:
            return first_hop

    client = scope.get("client")
    if client and client[0]:
        return str(client[0])

    return "unknown"


class RequestLoggingMiddleware:
    def __init__(self, app: ASGIApp, logger_name: str = "app.request") -> None:
        self.app = app
        self.logger = logging.getLogger(logger_name)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = uuid4().hex
        method = scope.get("method", "UNKNOWN")
        path = scope.get("path", "")
        client_ip = _get_client_ip(scope)
        started_at = monotonic()
        status_code = 500

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                headers = MutableHeaders(raw=message["headers"])
                headers["X-Request-ID"] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            duration_ms = (monotonic() - started_at) * 1000
            self.logger.exception(
                "request_failed request_id=%s client_ip=%s method=%s path=%s duration_ms=%.2f",
                request_id,
                client_ip,
                method,
                path,
                duration_ms,
            )
            raise

        duration_ms = (monotonic() - started_at) * 1000
        self.logger.info(
            "request_completed request_id=%s client_ip=%s method=%s path=%s status_code=%s duration_ms=%.2f",
            request_id,
            client_ip,
            method,
            path,
            status_code,
            duration_ms,
        )


class RateLimitMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        *,
        requests: int,
        window_seconds: int,
        exempt_paths: Iterable[str] = (),
    ) -> None:
        self.app = app
        self.requests = requests
        self.window_seconds = window_seconds
        self.exempt_paths = tuple(exempt_paths)
        self._buckets: dict[str, deque[float]] = {}
        self._lock = asyncio.Lock()

    def _is_exempt_path(self, path: str) -> bool:
        for exempt_path in self.exempt_paths:
            if path == exempt_path or path.startswith(f"{exempt_path}/"):
                return True
        return False

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        if self._is_exempt_path(path):
            await self.app(scope, receive, send)
            return

        client_ip = _get_client_ip(scope)
        now = monotonic()

        async with self._lock:
            bucket = self._buckets.setdefault(client_ip, deque())
            cutoff = now - self.window_seconds
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()

            if len(bucket) >= self.requests:
                retry_after = max(1, int(self.window_seconds - (now - bucket[0])))
                response = JSONResponse(
                    status_code=429,
                    content={
                        "detail": "Rate limit exceeded. Please retry after a short delay.",
                    },
                    headers={
                        "Retry-After": str(retry_after),
                        "X-RateLimit-Limit": str(self.requests),
                        "X-RateLimit-Remaining": "0",
                        "X-RateLimit-Window": str(self.window_seconds),
                    },
                )
                await response(scope, receive, send)
                return

            bucket.append(now)
            remaining = max(0, self.requests - len(bucket))
            reset_after = (
                max(0, int(self.window_seconds - (now - bucket[0])))
                if bucket
                else self.window_seconds
            )

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(raw=message["headers"])
                headers["X-RateLimit-Limit"] = str(self.requests)
                headers["X-RateLimit-Remaining"] = str(remaining)
                headers["X-RateLimit-Reset"] = str(reset_after)
                headers["X-RateLimit-Window"] = str(self.window_seconds)
            await send(message)

        await self.app(scope, receive, send_wrapper)
