"""JWT claim validation in get_current_user."""

from __future__ import annotations

import unittest
from uuid import uuid4

from fastapi import HTTPException

from app.auth.dependencies import _validate_token_claims
from app.models import User, UserRole


class AuthDependencyTests(unittest.TestCase):
    def test_perm_version_mismatch_returns_401(self) -> None:
        user = User(
            username="shop.user",
            password_hash="x",
            role=UserRole.SHOP_ACCOUNT,
            organization_id=uuid4(),
            permissions_version=2,
        )
        payload = {"perm_version": 1, "org_id": str(user.organization_id)}

        with self.assertRaises(HTTPException) as ctx:
            _validate_token_claims(payload, user)

        self.assertEqual(ctx.exception.status_code, 401)
        self.assertEqual(ctx.exception.headers, {"WWW-Authenticate": "Bearer"})

    def test_org_id_mismatch_returns_401(self) -> None:
        org_id = uuid4()
        user = User(
            username="shop.user",
            password_hash="x",
            role=UserRole.SHOP_ACCOUNT,
            organization_id=org_id,
            permissions_version=0,
        )
        payload = {"perm_version": 0, "org_id": str(uuid4())}

        with self.assertRaises(HTTPException) as ctx:
            _validate_token_claims(payload, user)

        self.assertEqual(ctx.exception.status_code, 401)

    def test_super_admin_rejects_token_with_org_id(self) -> None:
        user = User(
            username="super",
            password_hash="x",
            role=UserRole.SUPER_ADMIN,
            organization_id=None,
            permissions_version=0,
        )
        payload = {"perm_version": 0, "org_id": str(uuid4())}

        with self.assertRaises(HTTPException) as ctx:
            _validate_token_claims(payload, user)

        self.assertEqual(ctx.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()
