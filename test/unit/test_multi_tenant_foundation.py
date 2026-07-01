"""Phase 1 multi-tenant foundation tests."""

from __future__ import annotations

import os
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException
from sqlalchemy import select

from test.support import AsyncSessionAdapter, BackendTestCase

from app.auth.tenant_context import load_user_permissions
from app.models.enums import parse_user_role
from app.models import Organization, User, UserRole
from app.schemas.auth import RegisterRequest
from app.services.auth import register_admin


class MultiTenantFoundationTests(BackendTestCase):
    def test_tenant_admin_requires_organization(self) -> None:
        async def scenario() -> None:
            user = await self.harness.create_admin_user()
            self.assertIsNotNone(user.organization_id)

        self.run_async(scenario())

    def test_super_admin_has_wildcard_permissions(self) -> None:
        async def scenario() -> None:
            user = await self.harness.create_super_admin_user()
            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                permissions = await load_user_permissions(adapter, user)
            self.assertEqual(permissions, frozenset({"*"}))

        self.run_async(scenario())

    def test_session_role_normalizes_admin_alias(self) -> None:
        self.assertEqual(parse_user_role("admin"), UserRole.TENANT_ADMIN)

    def test_register_blocked_in_production(self) -> None:
        async def scenario() -> None:
            with patch("app.services.auth.get_settings") as mock_settings:
                mock_settings.return_value = Mock(production=True)
                with self.harness.session_factory() as session:
                    adapter = AsyncSessionAdapter(session)
                    with self.assertRaises(HTTPException) as ctx:
                        await register_admin(
                            adapter,
                            RegisterRequest(
                                username="newadmin",
                                password="password123",
                                confirm_password="password123",
                            ),
                        )
                    self.assertEqual(ctx.exception.status_code, 404)

        self.run_async(scenario())

    def test_default_organization_created_with_admin(self) -> None:
        async def scenario() -> None:
            await self.harness.create_admin_user()
            with self.harness.session_factory() as session:
                org = session.scalar(select(Organization).where(Organization.slug == "default"))
                self.assertIsNotNone(org)
                self.assertEqual(org.name, "Brolier 360 Default")

        self.run_async(scenario())


if __name__ == "__main__":
    unittest.main()
