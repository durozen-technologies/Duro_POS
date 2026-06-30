"""Super Admin API integration tests."""

from __future__ import annotations

import unittest

from fastapi import HTTPException
from sqlalchemy import select

from test.support import AsyncSessionAdapter, BackendTestCase

from app.auth.tenant_context import user_has_permission
from app.auth.permission_codes import SHOPS_READ
from app.models import AdminRole, Organization, Shop, User, UserRole
from app.schemas.super_admin.organizations import OrganizationCreate
from app.schemas.super_admin.tenant_admins import TenantAdminCreate
from app.services.auth import login_user
from app.services.super_admin import organizations as org_service
from app.services.super_admin import tenant_admins as tenant_admin_service


class SuperAdminApiTests(BackendTestCase):
    def test_super_admin_creates_org_and_tenant_admin(self) -> None:
        async def scenario() -> None:
            super_admin = await self.harness.create_super_admin_user()
            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                org = await org_service.create_organization(
                    adapter,
                    OrganizationCreate(name="Acme Meats", slug="acme-meats"),
                    super_admin,
                )
                self.assertEqual(org.slug, "acme-meats")

                role_id = session.scalar(
                    select(AdminRole.id).where(
                        AdminRole.organization_id == org.id,
                        AdminRole.name == "TenantFullAdmin",
                    )
                )
                self.assertIsNotNone(role_id)

                tenant_admin = await tenant_admin_service.create_tenant_admin(
                    adapter,
                    TenantAdminCreate(
                        organization_id=org.id,
                        username="acme.admin",
                        password="password123",
                    ),
                    super_admin,
                )
                self.assertEqual(tenant_admin.username, "acme.admin")
                self.assertTrue(tenant_admin.is_active)

        self.run_async(scenario())

    def test_disabled_tenant_admin_cannot_login(self) -> None:
        async def scenario() -> None:
            super_admin = await self.harness.create_super_admin_user()
            org = await self.harness.create_default_organization()
            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                tenant_admin = await tenant_admin_service.create_tenant_admin(
                    adapter,
                    TenantAdminCreate(
                        organization_id=org.id,
                        username="disabled.admin",
                        password="password123",
                    ),
                    super_admin,
                )
                await tenant_admin_service.set_tenant_admin_status(
                    adapter,
                    tenant_admin.id,
                    is_active=False,
                    actor=super_admin,
                )

            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                with self.assertRaises(HTTPException) as ctx:
                    await login_user(adapter, "disabled.admin", "password123")
                self.assertEqual(ctx.exception.status_code, 403)

        self.run_async(scenario())

    def test_permission_denial_shape(self) -> None:
        from app.auth.tenant_context import TenantContext

        ctx = TenantContext(
            actor=User(
                username="limited",
                password_hash="x",
                role=UserRole.TENANT_ADMIN,
                is_active=True,
            ),
            organization_id=None,
            permissions=frozenset(),
            is_super_admin=False,
        )
        self.assertFalse(user_has_permission(ctx, SHOPS_READ))

    def test_tenant_admin_full_lifecycle(self) -> None:
        async def scenario() -> None:
            super_admin = await self.harness.create_super_admin_user()
            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                org = await org_service.create_organization(
                    adapter,
                    OrganizationCreate(name="Lifecycle Org", slug="lifecycle-org"),
                    super_admin,
                )
                roles = await org_service.list_organization_admin_roles(adapter, org.id)
                self.assertEqual(len(roles), 1)
                self.assertEqual(roles[0].name, "TenantFullAdmin")

                created = await tenant_admin_service.create_tenant_admin(
                    adapter,
                    TenantAdminCreate(
                        organization_id=org.id,
                        username="lifecycle.admin",
                        password="password123",
                    ),
                    super_admin,
                )
                fetched = await tenant_admin_service.get_tenant_admin(adapter, created.id)
                self.assertEqual(fetched.username, "lifecycle.admin")
                self.assertEqual(fetched.role_ids, [roles[0].id])

                disabled = await tenant_admin_service.set_tenant_admin_status(
                    adapter,
                    created.id,
                    is_active=False,
                    actor=super_admin,
                )
                self.assertFalse(disabled.is_active)

                enabled = await tenant_admin_service.set_tenant_admin_status(
                    adapter,
                    created.id,
                    is_active=True,
                    actor=super_admin,
                )
                self.assertTrue(enabled.is_active)

                reset = await tenant_admin_service.reset_tenant_admin_password(
                    adapter,
                    created.id,
                    "newpassword123",
                    super_admin,
                )
                self.assertEqual(reset.id, created.id)

                updated_roles = await tenant_admin_service.update_tenant_admin_roles(
                    adapter,
                    created.id,
                    [roles[0].id],
                    super_admin,
                )
                self.assertEqual(updated_roles.role_ids, [roles[0].id])

                await tenant_admin_service.delete_tenant_admin(
                    adapter,
                    created.id,
                    super_admin,
                )
                with self.assertRaises(HTTPException) as ctx:
                    await tenant_admin_service.get_tenant_admin(adapter, created.id)
                self.assertEqual(ctx.exception.status_code, 404)

        self.run_async(scenario())

    def test_delete_tenant_admin_blocked_when_shop_owner(self) -> None:
        async def scenario() -> None:
            super_admin = await self.harness.create_super_admin_user()
            org = await self.harness.create_default_organization()
            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                tenant_admin = await tenant_admin_service.create_tenant_admin(
                    adapter,
                    TenantAdminCreate(
                        organization_id=org.id,
                        username="shop.owner.admin",
                        password="password123",
                    ),
                    super_admin,
                )
                owner = session.get(User, tenant_admin.id)
                self.assertIsNotNone(owner)
                session.add(
                    Shop(
                        name="Blocked Delete Shop",
                        owner=owner,
                        organization_id=org.id,
                        is_active=True,
                    )
                )
                session.commit()

            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                with self.assertRaises(HTTPException) as ctx:
                    await tenant_admin_service.delete_tenant_admin(
                        adapter,
                        tenant_admin.id,
                        super_admin,
                    )
                self.assertEqual(ctx.exception.status_code, 409)

        self.run_async(scenario())


if __name__ == "__main__":
    unittest.main()
