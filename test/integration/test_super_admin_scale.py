"""Smoke test: tenant admin list pagination at scale."""

from __future__ import annotations

import unittest

from sqlalchemy import func, select

from test.support import AsyncSessionAdapter, BackendTestCase

from app.core.security import get_password_hash
from app.models import Organization, User, UserRole
from app.services.super_admin.tenant_admins import list_tenant_admin_rows


class SuperAdminScaleSmokeTests(BackendTestCase):
    def test_list_500_tenant_admins_paginates(self) -> None:
        async def scenario() -> None:
            with self.harness.session_factory() as session:
                org = Organization(name="Scale Org", slug="scale-org", is_active=True)
                session.add(org)
                session.flush()
                for index in range(500):
                    session.add(
                        User(
                            username=f"scale-admin-{index:04d}",
                            password_hash=get_password_hash("password123"),
                            role=UserRole.TENANT_ADMIN,
                            organization_id=org.id,
                            is_active=True,
                        )
                    )
                session.commit()

            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                total = await adapter.scalar(
                    select(func.count(User.id)).where(User.role == UserRole.TENANT_ADMIN)
                )
                self.assertGreaterEqual(int(total or 0), 500)

                page = await list_tenant_admin_rows(adapter, limit=50)
                self.assertEqual(len(page.items), 50)
                self.assertTrue(page.has_more)

        self.run_async(scenario())


if __name__ == "__main__":
    unittest.main()
