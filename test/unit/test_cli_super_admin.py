from __future__ import annotations

import unittest
from unittest.mock import patch

from app.cli.__main__ import set_super_admin_password
from app.core.security import verify_password
from app.models import User, UserRole
from sqlalchemy import select
from test.support import AsyncSessionAdapter, BackendTestCase


class SuperAdminCliTests(BackendTestCase):
    def test_set_super_admin_password_updates_existing_hash(self) -> None:
        async def scenario() -> None:
            user = await self.harness.create_super_admin_user(
                username="admin", password="old-password-123"
            )

            def session_factory():
                class _SessionContext:
                    async def __aenter__(self_nonlocal):
                        self_nonlocal.session = self.harness.session_factory()
                        return AsyncSessionAdapter(self_nonlocal.session)

                    async def __aexit__(self_nonlocal, exc_type, exc, tb):
                        self_nonlocal.session.close()

                return _SessionContext()

            with patch("app.cli.__main__.get_session_local", return_value=session_factory):
                await set_super_admin_password("admin", "new-password-456")

            with self.harness.session_factory() as session:
                updated = session.scalar(
                    select(User).where(
                        User.id == user.id,
                        User.role == UserRole.SUPER_ADMIN,
                    )
                )
                self.assertIsNotNone(updated)
                assert updated is not None
                self.assertTrue(verify_password("new-password-456", updated.password_hash))
                self.assertFalse(verify_password("old-password-123", updated.password_hash))

        self.run_async(scenario())

    def test_set_super_admin_password_errors_when_missing(self) -> None:
        async def scenario() -> None:
            def session_factory():
                class _SessionContext:
                    async def __aenter__(self_nonlocal):
                        self_nonlocal.session = self.harness.session_factory()
                        return AsyncSessionAdapter(self_nonlocal.session)

                    async def __aexit__(self_nonlocal, exc_type, exc, tb):
                        self_nonlocal.session.close()

                return _SessionContext()

            with patch("app.cli.__main__.get_session_local", return_value=session_factory):
                with self.assertRaises(SystemExit) as ctx:
                    await set_super_admin_password("admin", "new-password-456")
            self.assertEqual(str(ctx.exception), "Super admin not found: admin")

        self.run_async(scenario())


if __name__ == "__main__":
    unittest.main()
