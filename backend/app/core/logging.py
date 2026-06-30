"""Structured logging setup and request-scoped context."""

from __future__ import annotations

import json
import logging
import sys
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

request_id_ctx: ContextVar[str | None] = ContextVar("request_id", default=None)


class JsonLogFormatter(logging.Formatter):
    """Emit one JSON object per log line for production log aggregation."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        request_id = request_id_ctx.get()
        if request_id:
            payload["request_id"] = request_id
        event = getattr(record, "event", None)
        if event:
            payload["event"] = event
        for key, value in record.__dict__.items():
            if key.startswith("_") or key in {
                "name",
                "msg",
                "args",
                "created",
                "filename",
                "funcName",
                "levelname",
                "levelno",
                "lineno",
                "module",
                "msecs",
                "message",
                "pathname",
                "process",
                "processName",
                "relativeCreated",
                "stack_info",
                "exc_info",
                "exc_text",
                "thread",
                "threadName",
                "taskName",
                "event",
            }:
                continue
            if key in payload:
                continue
            payload[key] = value
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(*, production: bool, level: int = logging.INFO) -> None:
    root = logging.getLogger()
    root.handlers.clear()
    handler = logging.StreamHandler(sys.stdout)
    if production:
        handler.setFormatter(JsonLogFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(levelname)s %(name)s %(message)s"))
    root.addHandler(handler)
    root.setLevel(level)


def bind_request_id(request_id: str | None) -> None:
    request_id_ctx.set(request_id)


def log_event(
    logger: logging.Logger,
    level: int,
    event: str,
    message: str,
    **fields: Any,
) -> None:
    logger.log(level, message, extra={"event": event, **fields})
