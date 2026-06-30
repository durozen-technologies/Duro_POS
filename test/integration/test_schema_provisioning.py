"""Schema-per-tenant provisioning integration tests (Postgres only)."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from uuid import uuid4

ROOT_DIR = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT_DIR / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

os.environ.setdefault("SECRET_KEY", "test-secret-key")

from sqlalchemy import delete, select

from test.postgres_support import PostgresHarness, postgres_test_url

from app.core.security import get_password_hash
from app.db.tenant_schema import derive_schema_name, set_search_path, tenant_router
from app.models import AdminRole, Organization, Shop, User, UserRole
from app.schemas.super_admin.organizations import OrganizationCreate
from app.services.super_admin import organizations as org_service

_SKIP_REASON = "TEST_DATABASE_URL required for schema-per-tenant integration tests"


@unittest.skipUnless(postgres_test_url(), _SKIP_REASON)
class SchemaProvisioningTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls) -> None:
        os.environ["DATABASE_URL"] = postgres_test_url() or ""
        cls.harness = PostgresHarness()
        cls.harness.run_migrations()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.harness.dispose()

    async def asyncTearDown(self) -> None:
        if getattr(self, "_cleanup_schema", None):
            await self.harness.drop_schema(self._cleanup_schema)
        if getattr(self, "_cleanup_org_id", None):
            async with self.harness.session_factory() as session:
                await set_search_path(session, None)
                await session.execute(
                    delete(Organization).where(Organization.id == self._cleanup_org_id)
                )
                await session.commit()

    async def _create_super_admin(self) -> User:
        username = f"super-{uuid4().hex[:8]}"
        async with self.harness.session_factory() as session:
            await set_search_path(session, None)
            user = User(
                username=username,
                password_hash=get_password_hash("password123"),
                role=UserRole.SUPER_ADMIN,
                organization_id=None,
                is_active=True,
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)
            return user

    async def test_create_organization_provisions_tenant_schema(self) -> None:
        super_admin = await self._create_super_admin()
        slug = f"prov-{uuid4().hex[:8]}"
        expected_schema = derive_schema_name(slug)
        self._cleanup_schema = expected_schema

        async with self.harness.session_factory() as session:
            await set_search_path(session, None)
            org_read = await org_service.create_organization(
                session,
                OrganizationCreate(name="Provision Test", slug=slug),
                super_admin,
            )
            self._cleanup_org_id = org_read.id

        self.assertEqual(org_read.schema_name, expected_schema)
        self.assertTrue(await self.harness.schema_exists(expected_schema))
        self.assertTrue(await self.harness.tenant_alembic_at_head(expected_schema))

    async def test_tenant_full_admin_role_in_tenant_schema(self) -> None:
        super_admin = await self._create_super_admin()
        slug = f"role-{uuid4().hex[:8]}"
        schema_name = derive_schema_name(slug)
        self._cleanup_schema = schema_name

        async with self.harness.session_factory() as session:
            await set_search_path(session, None)
            org_read = await org_service.create_organization(
                session,
                OrganizationCreate(name="Role Test", slug=slug),
                super_admin,
            )
            self._cleanup_org_id = org_read.id

        async with self.harness.session_factory() as platform_db:
            await set_search_path(platform_db, None)
            public_roles = list(
                await platform_db.scalars(
                    select(AdminRole).where(AdminRole.organization_id == org_read.id)
                )
            )
            self.assertEqual(public_roles, [])

        async with self.harness.session_factory() as tenant_db:
            await set_search_path(tenant_db, schema_name)
            tenant_roles = list(
                await tenant_db.scalars(
                    select(AdminRole).where(AdminRole.organization_id == org_read.id)
                )
            )
            self.assertEqual(len(tenant_roles), 1)
            self.assertEqual(tenant_roles[0].name, "TenantFullAdmin")

    async def test_resolve_schema_caches_org_mapping(self) -> None:
        super_admin = await self._create_super_admin()
        slug = f"cache-{uuid4().hex[:8]}"
        schema_name = derive_schema_name(slug)
        self._cleanup_schema = schema_name

        async with self.harness.session_factory() as session:
            await set_search_path(session, None)
            org_read = await org_service.create_organization(
                session,
                OrganizationCreate(name="Cache Test", slug=slug),
                super_admin,
            )
            self._cleanup_org_id = org_read.id

        async with self.harness.session_factory() as session:
            await set_search_path(session, None)
            resolved = await tenant_router.resolve_schema(session, org_read.id)
            self.assertEqual(resolved, schema_name)
            resolved_again = await tenant_router.resolve_schema(session, org_read.id)
            self.assertEqual(resolved_again, schema_name)

    async def test_search_path_isolates_shops_between_tenants(self) -> None:
        super_admin = await self._create_super_admin()
        slug_a = f"iso-a-{uuid4().hex[:6]}"
        slug_b = f"iso-b-{uuid4().hex[:6]}"
        schema_a = derive_schema_name(slug_a)
        schema_b = derive_schema_name(slug_b)

        async with self.harness.session_factory() as session:
            await set_search_path(session, None)
            org_a = await org_service.create_organization(
                session,
                OrganizationCreate(name="Iso A", slug=slug_a),
                super_admin,
            )
            org_b = await org_service.create_organization(
                session,
                OrganizationCreate(name="Iso B", slug=slug_b),
                super_admin,
            )

        shop_name = f"shop-{uuid4().hex[:6]}"
        async with self.harness.session_factory() as session:
            await set_search_path(session, schema_a)
            owner = User(
                username=f"owner-{uuid4().hex[:8]}",
                password_hash="x",
                role=UserRole.SHOP_ACCOUNT,
                organization_id=org_a.id,
                is_active=True,
            )
            shop = Shop(
                name=shop_name,
                organization_id=org_a.id,
                owner=owner,
                is_active=True,
            )
            session.add_all([owner, shop])
            await session.commit()
            shop_id = shop.id

        async with self.harness.session_factory() as session:
            await set_search_path(session, schema_b)
            found = await session.get(Shop, shop_id)
            self.assertIsNone(found)

        async with self.harness.session_factory() as session:
            await set_search_path(session, schema_a)
            found = await session.get(Shop, shop_id)
            self.assertIsNotNone(found)
            self.assertEqual(found.name, shop_name)

        await self.harness.drop_schema(schema_a)
        await self.harness.drop_schema(schema_b)
        async with self.harness.session_factory() as session:
            await set_search_path(session, None)
            await session.execute(
                delete(Organization).where(Organization.id.in_([org_a.id, org_b.id]))
            )
            await session.commit()


if __name__ == "__main__":
    unittest.main()
