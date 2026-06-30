"""Tenant isolation integration tests."""

from __future__ import annotations

import unittest

from fastapi import HTTPException

from test.support import AsyncSessionAdapter, BackendTestCase

from app.models import Organization, Shop, User, UserRole
from app.schemas.super_admin.organizations import OrganizationCreate
from app.services.admin.shops import get_shop_by_id, list_shops
from app.services.super_admin import organizations as org_service


class TenantIsolationTests(BackendTestCase):
    def test_tenant_admin_cannot_read_other_org_shop(self) -> None:
        async def scenario() -> None:
            super_admin = await self.harness.create_super_admin_user()
            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                org_a = await org_service.create_organization(
                    adapter,
                    OrganizationCreate(name="Org A", slug="org-a"),
                    super_admin,
                )
                org_b = await org_service.create_organization(
                    adapter,
                    OrganizationCreate(name="Org B", slug="org-b"),
                    super_admin,
                )

            with self.harness.session_factory() as session:
                shop_b = Shop(
                    name="Shop B",
                    organization_id=org_b.id,
                    is_active=True,
                )
                user_b = User(
                    username="shopb",
                    password_hash="x",
                    role=UserRole.SHOP_ACCOUNT,
                    organization_id=org_b.id,
                    is_active=True,
                )
                shop_b.owner = user_b
                session.add_all([user_b, shop_b])
                session.commit()
                shop_b_id = shop_b.id

            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                with self.assertRaises(HTTPException) as ctx:
                    await get_shop_by_id(adapter, shop_b_id, org_a.id)
                self.assertEqual(ctx.exception.status_code, 404)

                shops_a = await list_shops(adapter, org_a.id)
                self.assertEqual(shops_a, [])

        self.run_async(scenario())


if __name__ == "__main__":
    unittest.main()
