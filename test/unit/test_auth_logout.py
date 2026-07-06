"""Logout bumps permissions_version and invalidates prior JWTs."""

from __future__ import annotations

import unittest
from uuid import uuid4

from fastapi import HTTPException

from app.auth.dependencies import _validate_token_claims
from app.core.security import create_access_token_for_user
from app.models import User, UserRole
from app.services.session_invalidation import invalidate_user_sessions
from test.support import AsyncSessionAdapter, BackendTestCase


class AuthLogoutTests(BackendTestCase):
    def test_logout_bumps_version_and_invalidates_token(self) -> None:
        async def scenario() -> None:
            user = User(
                id=uuid4(),
                username="logout.user",
                password_hash="x",
                role=UserRole.SUPER_ADMIN,
                organization_id=None,
                permissions_version=0,
            )
            token = create_access_token_for_user(user)
            payload = {"perm_version": 0, "org_id": None}
            _validate_token_claims(payload, user)

            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                session.add(user)
                session.commit()
                session.refresh(user)
                await invalidate_user_sessions(user)
                session.commit()
                session.refresh(user)

            bumped_payload = {"perm_version": user.permissions_version, "org_id": None}
            _validate_token_claims(bumped_payload, user)

            with self.assertRaises(HTTPException):
                _validate_token_claims(payload, user)

            self.assertIsNotNone(token)

        self.run_async(scenario())


if __name__ == "__main__":
    unittest.main()
