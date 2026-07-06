"""Stable API error envelope preserves HTTP exception headers."""

from __future__ import annotations

import unittest

from fastapi import HTTPException, status

from app.core.errors import http_exception_handler


class HttpExceptionHandlerTests(unittest.TestCase):
    def test_preserves_www_authenticate_header(self) -> None:
        async def scenario() -> None:
            exc = HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Not authenticated",
                headers={"WWW-Authenticate": "Bearer"},
            )
            response = await http_exception_handler(None, exc)
            self.assertEqual(response.headers.get("www-authenticate"), "Bearer")

        import asyncio

        asyncio.run(scenario())


if __name__ == "__main__":
    unittest.main()
