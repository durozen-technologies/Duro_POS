"""Super Admin API integration tests."""

from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select

from test.support import AsyncSessionAdapter, BackendTestCase

from app.auth.tenant_context import user_has_permission
from app.auth.permission_codes import SHOPS_READ
from app.models import AdminRole, Bill, BillStatus, Organization, Shop, User, UserRole
from app.schemas.super_admin.hard_delete import HardDeleteRequest
from app.schemas.super_admin.organizations import OrganizationCreate
from app.schemas.super_admin.tenant_admins import TenantAdminCreate
from app.services.auth import login_user
from app.services.super_admin import analytics as analytics_service
from app.services.super_admin import branches as branch_service
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
                self.assertEqual(
                    ctx.exception.detail,
                    "Your account has been disabled by the super admin. "
                    "Please contact Durozen Technologies.",
                )

        self.run_async(scenario())

    def test_disabled_organization_blocks_tenant_admin_login(self) -> None:
        async def scenario() -> None:
            super_admin = await self.harness.create_super_admin_user()
            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                org = await org_service.create_organization(
                    adapter,
                    OrganizationCreate(name="Disabled Org", slug="disabled-org"),
                    super_admin,
                )
                await tenant_admin_service.create_tenant_admin(
                    adapter,
                    TenantAdminCreate(
                        organization_id=org.id,
                        username="blocked.admin",
                        password="password123",
                    ),
                    super_admin,
                )
                await org_service.set_organization_status(
                    adapter,
                    org.id,
                    is_active=False,
                    actor=super_admin,
                )

            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                with self.assertRaises(HTTPException) as ctx:
                    await login_user(adapter, "blocked.admin", "password123")
                self.assertEqual(ctx.exception.status_code, 403)
                self.assertEqual(
                    ctx.exception.detail,
                    "Your organization has been disabled by the super admin. "
                    "Please contact Durozen Technologies.",
                )

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

                await tenant_admin_service.hard_delete_tenant_admin(
                    adapter,
                    created.id,
                    HardDeleteRequest(username=super_admin.username, password="password123"),
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
                    await tenant_admin_service.hard_delete_tenant_admin(
                        adapter,
                        tenant_admin.id,
                        HardDeleteRequest(username=super_admin.username, password="password123"),
                        super_admin,
                    )
                self.assertEqual(ctx.exception.status_code, 409)

        self.run_async(scenario())

    def test_hard_delete_tenant_admin_requires_valid_credentials(self) -> None:
        async def scenario() -> None:
            super_admin = await self.harness.create_super_admin_user()
            org = await self.harness.create_default_organization()
            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                tenant_admin = await tenant_admin_service.create_tenant_admin(
                    adapter,
                    TenantAdminCreate(
                        organization_id=org.id,
                        username="cred.admin",
                        password="password123",
                    ),
                    super_admin,
                )

            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                with self.assertRaises(HTTPException) as ctx:
                    await tenant_admin_service.hard_delete_tenant_admin(
                        adapter,
                        tenant_admin.id,
                        HardDeleteRequest(username=super_admin.username, password="wrong-password"),
                        super_admin,
                    )
                self.assertEqual(ctx.exception.status_code, 401)

        self.run_async(scenario())

    def test_hard_delete_organization(self) -> None:
        async def scenario() -> None:
            super_admin = await self.harness.create_super_admin_user()
            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                org = await org_service.create_organization(
                    adapter,
                    OrganizationCreate(name="Delete Me Org", slug="delete-me-org"),
                    super_admin,
                )
                await org_service.hard_delete_organization(
                    adapter,
                    org.id,
                    HardDeleteRequest(username=super_admin.username, password="password123"),
                    super_admin,
                )
                with self.assertRaises(HTTPException) as ctx:
                    await org_service.get_organization_or_404(adapter, org.id)
                self.assertEqual(ctx.exception.status_code, 404)

        self.run_async(scenario())

    def test_hard_delete_branch_removes_shop_and_owner(self) -> None:
        async def scenario() -> None:
            super_admin = await self.harness.create_super_admin_user()
            org = await self.harness.create_default_organization()
            _owner, shop = await self.harness.create_shop_user(
                username="delete.branch.shop",
                shop_name="Delete Me Branch",
            )

            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                branches = await branch_service.list_organization_branches(adapter, org.id)
                self.assertEqual(len(branches), 1)
                self.assertEqual(branches[0].id, shop.id)

                await branch_service.hard_delete_branch(
                    adapter,
                    org.id,
                    shop.id,
                    HardDeleteRequest(username=super_admin.username, password="password123"),
                    super_admin,
                )

                self.assertEqual(await branch_service.list_organization_branches(adapter, org.id), [])
                self.assertIsNone(session.get(Shop, shop.id))
                self.assertIsNone(session.get(User, _owner.id))

        self.run_async(scenario())

    def test_hard_delete_branch_blocked_when_billing_exists(self) -> None:
        async def scenario() -> None:
            super_admin = await self.harness.create_super_admin_user()
            org = await self.harness.create_default_organization()
            _owner, shop = await self.harness.create_shop_user(
                username="billed.branch.shop",
                shop_name="Billed Branch",
            )

            with self.harness.session_factory() as session:
                session.add(
                    Bill(
                        bill_no="SMB-2026-01-000001",
                        shop_id=shop.id,
                        total_amount=Decimal("100.00"),
                        status=BillStatus.PAID,
                    )
                )
                session.commit()

            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                with self.assertRaises(HTTPException) as ctx:
                    await branch_service.hard_delete_branch(
                        adapter,
                        org.id,
                        shop.id,
                        HardDeleteRequest(username=super_admin.username, password="password123"),
                        super_admin,
                    )
                self.assertEqual(ctx.exception.status_code, 409)

        self.run_async(scenario())

    def test_hard_delete_branch_requires_valid_credentials(self) -> None:
        async def scenario() -> None:
            super_admin = await self.harness.create_super_admin_user()
            org = await self.harness.create_default_organization()
            _owner, shop = await self.harness.create_shop_user(
                username="cred.branch.shop",
                shop_name="Cred Branch",
            )

            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                with self.assertRaises(HTTPException) as ctx:
                    await branch_service.hard_delete_branch(
                        adapter,
                        org.id,
                        shop.id,
                        HardDeleteRequest(username=super_admin.username, password="wrong-password"),
                        super_admin,
                    )
                self.assertEqual(ctx.exception.status_code, 401)

        self.run_async(scenario())

    def test_super_admin_billing_overview_is_aggregated_by_org_and_branch(self) -> None:
        async def scenario() -> None:
            org = await self.harness.create_default_organization(name="Alpha Org", slug="alpha-org")
            with self.harness.session_factory() as session:
                owner_one = User(
                    username="alpha.shop.one",
                    password_hash="x",
                    role=UserRole.SHOP_ACCOUNT,
                    organization_id=org.id,
                    is_active=True,
                )
                owner_two = User(
                    username="alpha.shop.two",
                    password_hash="x",
                    role=UserRole.SHOP_ACCOUNT,
                    organization_id=org.id,
                    is_active=True,
                )
                shop_one = Shop(
                    name="Alpha Branch One",
                    owner=owner_one,
                    organization_id=org.id,
                    is_active=True,
                )
                shop_two = Shop(
                    name="Alpha Branch Two",
                    owner=owner_two,
                    organization_id=org.id,
                    is_active=False,
                )
                session.add_all([owner_one, owner_two, shop_one, shop_two])
                session.commit()
                session.refresh(shop_one)
                session.refresh(shop_two)

                now = datetime.now(UTC)
                session.add_all(
                    [
                        Bill(
                            bill_no="A-001",
                            shop_id=shop_one.id,
                            total_amount=Decimal("120.00"),
                            status=BillStatus.PAID,
                            created_at=now,
                        ),
                        Bill(
                            bill_no="A-002",
                            shop_id=shop_one.id,
                            total_amount=Decimal("90.00"),
                            status=BillStatus.PAID,
                            created_at=now - timedelta(days=1),
                        ),
                        Bill(
                            bill_no="A-003",
                            shop_id=shop_two.id,
                            total_amount=Decimal("75.00"),
                            status=BillStatus.PAID,
                            created_at=now,
                        ),
                    ]
                )
                session.commit()

            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                overview = await analytics_service.get_billing_overview(adapter, period="week")

            self.assertEqual(overview.summary.total_organizations, 1)
            self.assertEqual(overview.summary.total_branches, 2)
            self.assertEqual(overview.summary.total_bills_generated, 3)
            self.assertEqual(overview.summary.bills_generated_today, 2)
            self.assertEqual(len(overview.organizations), 1)
            self.assertEqual(overview.organizations[0].organization_name, "Alpha Org")
            self.assertEqual(overview.organizations[0].branch_count, 2)
            self.assertEqual(overview.organizations[0].total_bills_generated, 3)
            self.assertEqual(
                [(branch.shop_name, branch.bill_count) for branch in overview.organizations[0].branches],
                [("Alpha Branch One", 2), ("Alpha Branch Two", 1)],
            )

            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                branch_overview = await analytics_service.get_billing_overview(
                    adapter,
                    period="week",
                    organization_id=org.id,
                    shop_id=shop_one.id,
                )

            self.assertEqual(branch_overview.summary.total_organizations, 1)
            self.assertEqual(branch_overview.summary.total_branches, 1)
            self.assertEqual(branch_overview.summary.total_bills_generated, 2)
            self.assertEqual(branch_overview.summary.bills_generated_today, 1)
            self.assertEqual(len(branch_overview.organizations), 1)
            self.assertEqual(len(branch_overview.organizations[0].branches), 1)
            self.assertEqual(branch_overview.organizations[0].branches[0].shop_name, "Alpha Branch One")

        self.run_async(scenario())


if __name__ == "__main__":
    unittest.main()
