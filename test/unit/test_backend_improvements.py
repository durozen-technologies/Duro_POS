from __future__ import annotations

import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import test.support  # noqa: F401 — adds backend/ to sys.path

from fastapi import HTTPException, status
from starlette.requests import Request

from app.core.errors import http_exception_handler
from app.main import app
from app.routers.health import health_check
from fastapi.routing import APIRoute
from starlette.routing import Mount


def _api_routes(routes, prefix: str = "") -> list[tuple[str, set[str]]]:
    collected: list[tuple[str, set[str]]] = []
    for route in routes:
        if isinstance(route, APIRoute):
            collected.append((f"{prefix}{route.path}", set(route.methods or set())))
        elif isinstance(route, Mount):
            collected.extend(_api_routes(route.routes, prefix=f"{prefix}{route.path}".rstrip("/")))
    return collected


class BackendImprovementTests(unittest.TestCase):
    def test_http_exception_handler_returns_structured_error(self) -> None:
        request = Request({"type": "http", "method": "GET", "path": "/", "headers": []})
        exc = HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

        body = asyncio.run(http_exception_handler(request, exc)).body.decode()
        self.assertIn('"error"', body)
        self.assertIn("INVALID_CREDENTIALS", body)
        self.assertIn("Invalid username or password", body)

    def test_production_health_check_omits_database_error(self) -> None:
        request = Mock()
        request.app.state = SimpleNamespace(
            database_ready=False,
            database_error="connection refused",
        )

        production_settings = Mock(production=True)
        with patch("app.routers.health.get_settings", return_value=production_settings), patch(
            "app.routers.health.redis_health_status", return_value="disabled"
        ), patch("app.routers.health._rustfs_health_status", return_value="disabled"):
            response = asyncio.run(health_check(request))

        payload = response.body.decode()
        self.assertIn('"database":"unavailable"', payload)
        self.assertNotIn("connection refused", payload)
        self.assertNotIn('"error"', payload)

    def test_legacy_inventory_list_route_removed(self) -> None:
        legacy_get_routes = [
            (path, methods)
            for path, methods in _api_routes(app.routes)
            if path.rstrip("/").endswith("/api/v1/admin/inventory/items") and "GET" in methods
        ]
        self.assertEqual(legacy_get_routes, [])


if __name__ == "__main__":
    unittest.main()
