"""Login rejection messages when super admin disables accounts or orgs."""

from __future__ import annotations

import unittest
from uuid import uuid4

from fastapi import HTTPException

from test.support import AsyncSessionAdapter, BackendTestCase

from app.core.errors import (
    ACCOUNT_DISABLED_BY_SUPER_ADMIN,
    ORGANIZATION_DISABLED_BY_SUPER_ADMIN,
)
from app.models import Organization, User, UserRole
from app.services.auth import _validate_login_eligibility


class LoginDisabledMessageTests(BackendTestCase):
    def test_inactive_tenant_admin_gets_super_admin_account_message(self) -> None:
        async def scenario() -> None:
            org_id = uuid4()
            user = User(
                username="inactive.admin",
                password_hash="x",
                role=UserRole.TENANT_ADMIN,
                organization_id=org_id,
                is_active=False,
            )
            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                session.add(
                    Organization(id=org_id, name="Active Org", slug="active-org", is_active=True)
                )
                session.commit()
                with self.assertRaises(HTTPException) as ctx:
                    await _validate_login_eligibility(adapter, adapter, user, "inactive.admin")
            self.assertEqual(ctx.exception.status_code, 403)
            self.assertEqual(ctx.exception.detail, ACCOUNT_DISABLED_BY_SUPER_ADMIN)

        self.run_async(scenario())

    def test_inactive_organization_gets_super_admin_org_message(self) -> None:
        async def scenario() -> None:
            org_id = uuid4()
            user = User(
                username="blocked.admin",
                password_hash="x",
                role=UserRole.TENANT_ADMIN,
                organization_id=org_id,
                is_active=True,
            )
            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                session.add(
                    Organization(
                        id=org_id,
                        name="Disabled Org",
                        slug="disabled-org",
                        is_active=False,
                    )
                )
                session.commit()
                with self.assertRaises(HTTPException) as ctx:
                    await _validate_login_eligibility(adapter, adapter, user, "blocked.admin")
            self.assertEqual(ctx.exception.status_code, 403)
            self.assertEqual(ctx.exception.detail, ORGANIZATION_DISABLED_BY_SUPER_ADMIN)

        self.run_async(scenario())


if __name__ == "__main__":
    unittest.main()
