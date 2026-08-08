"""Login endpoint rate limiting."""

from __future__ import annotations

import unittest
from uuid import uuid4

from fastapi import HTTPException

from app.core.login_rate_limit import enforce_login_rate_limit


class AuthLoginRateLimitTests(unittest.IsolatedAsyncioTestCase):
    async def test_username_limit_returns_429(self) -> None:
        username = f"rate-limit-{uuid4()}"
        for _ in range(5):
            await enforce_login_rate_limit(client_ip="127.0.0.1", username=username)

        with self.assertRaises(HTTPException) as ctx:
            await enforce_login_rate_limit(client_ip="127.0.0.1", username=username)

        self.assertEqual(ctx.exception.status_code, 429)


if __name__ == "__main__":
    unittest.main()
