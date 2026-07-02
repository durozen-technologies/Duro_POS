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
from app.db.tenant_metadata import tenant_table_names
from app.db.tenant_context_var import reset_active_tenant_schema, set_active_tenant_schema
from app.db.tenant_schema import (
    derive_schema_name,
    repair_tenant_schema_ddl,
    set_search_path,
    tenant_router,
)
from app.models import AdminRole, Organization, Shop, User, UserRole
from app.schemas.admin import ShopCreate
from app.schemas.super_admin.organizations import OrganizationCreate
from app.services.admin.shops import create_shop_account
from app.services.super_admin import organizations as org_service
from app.services.super_admin.organizations import assert_organization_can_add_branch

_SKIP_REASON = (
    "Postgres test DB required: set TEST_DATABASE_URL or DATABASE_URL_TEST in backend/.env"
)


@unittest.skipUnless(postgres_test_url(), _SKIP_REASON)
class SchemaProvisioningTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls) -> None:
        os.environ["DATABASE_URL"] = postgres_test_url() or ""
        from app.core.config import get_settings

        get_settings.cache_clear()
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
                from sqlalchemy import text

                if await session.scalar(text("SELECT to_regclass('public.shops')")):
                    await session.execute(
                        text("DELETE FROM public.shops WHERE organization_id = :org_id"),
                        {"org_id": self._cleanup_org_id},
                    )
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

        async with self.harness.session_factory() as session:
            await set_search_path(session, None)
            org = await session.get(Organization, org_read.id)
            assert org is not None
            self.assertEqual(org.schema_name, expected_schema)
        self.assertTrue(await self.harness.schema_exists(expected_schema))
        self.assertTrue(await self.harness.tenant_alembic_at_head(expected_schema))

    async def test_tenant_schema_has_full_ddl_after_org_create(self) -> None:
        super_admin = await self._create_super_admin()
        slug = f"ddl-{uuid4().hex[:8]}"
        schema_name = derive_schema_name(slug)
        self._cleanup_schema = schema_name
        min_tables = len(tenant_table_names())

        async with self.harness.session_factory() as session:
            await set_search_path(session, None)
            org_read = await org_service.create_organization(
                session,
                OrganizationCreate(name="DDL Test", slug=slug),
                super_admin,
            )
            self._cleanup_org_id = org_read.id

        table_count = await self.harness.count_tables_in_schema(schema_name)
        self.assertGreaterEqual(
            table_count,
            min_tables,
            f"expected >={min_tables} tables in {schema_name}, got {table_count}",
        )

    async def test_repair_tenant_schema_ddl_on_broken_schema(self) -> None:
        from sqlalchemy import text as sql_text

        slug = f"repair-{uuid4().hex[:8]}"
        schema_name = derive_schema_name(slug)
        self._cleanup_schema = schema_name
        min_tables = len(tenant_table_names())

        async with self.harness.session_factory() as session:
            await set_search_path(session, None)
            org = Organization(
                name="Repair DDL Org",
                slug=slug,
                schema_name=schema_name,
                is_active=True,
            )
            session.add(org)
            await session.flush()
            self._cleanup_org_id = org.id
            await session.commit()

        async with self.harness.session_factory() as session:
            await set_search_path(session, None)
            await session.execute(sql_text(f'CREATE SCHEMA IF NOT EXISTS "{schema_name}"'))
            await session.execute(
                sql_text(
                    f'CREATE TABLE IF NOT EXISTS "{schema_name}".alembic_version '
                    "(version_num VARCHAR(32) NOT NULL PRIMARY KEY)"
                )
            )
            await session.execute(
                sql_text(
                    f'INSERT INTO "{schema_name}".alembic_version (version_num) '
                    "VALUES ('0001_tenant_baseline') ON CONFLICT DO NOTHING"
                )
            )
            await session.commit()

        before = await self.harness.count_tables_in_schema(schema_name)
        self.assertEqual(before, 1, "broken schema should start with only alembic_version")

        repair_tenant_schema_ddl(schema_name)

        after = await self.harness.count_tables_in_schema(schema_name)
        self.assertGreaterEqual(after, min_tables)

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
            public_tables = await self.harness.list_public_tables()
            self.assertNotIn("admin_roles", public_tables)

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

    async def test_tenant_schema_scope_preserves_parent_search_path_for_shop_create(self) -> None:
        super_admin = await self._create_super_admin()
        slug = f"shop-create-{uuid4().hex[:8]}"
        schema_name = derive_schema_name(slug)
        self._cleanup_schema = schema_name

        async with self.harness.session_factory() as session:
            await set_search_path(session, None)
            org_read = await org_service.create_organization(
                session,
                OrganizationCreate(name="Shop Create Org", slug=slug),
                super_admin,
            )
        self._cleanup_org_id = org_read.id

        admin = User(
            username=f"admin-{uuid4().hex[:8]}",
            password_hash=get_password_hash("password123"),
            role=UserRole.TENANT_ADMIN,
            organization_id=org_read.id,
            is_active=True,
        )

        async with self.harness.session_factory() as session:
            token = set_active_tenant_schema(schema_name)
            try:
                await set_search_path(session, schema_name)
                await assert_organization_can_add_branch(session, org_read.id)
                created = await create_shop_account(
                    session,
                    ShopCreate(
                        name="Demo Shop1",
                        username=f"shop-{uuid4().hex[:8]}",
                        password="password123",
                    ),
                    admin,
                )
                self.assertEqual(created.name, "Demo Shop1")
            finally:
                reset_active_tenant_schema(token)
                await set_search_path(session, None)

    async def test_tenant_data_migration_dry_run_and_execute(self) -> None:
        from sqlalchemy import create_engine, text

        from app.services.tenant_data_migration import migrate_organization_data

        super_admin = await self._create_super_admin()
        slug = f"mig-{uuid4().hex[:8]}"
        schema_name = derive_schema_name(slug)
        self._cleanup_schema = schema_name

        self.harness.ensure_legacy_public_fixture_tables()

        async with self.harness.session_factory() as session:
            await set_search_path(session, None)
            org = Organization(
                name="Migration Test Org",
                slug=slug,
                schema_name=schema_name,
                is_active=True,
            )
            session.add(org)
            await session.flush()
            self._cleanup_org_id = org.id

            shop = Shop(name="Mig Shop", organization_id=org.id, is_active=True)
            owner = User(
                username=f"owner-{uuid4().hex[:6]}",
                password_hash=get_password_hash("password123"),
                role=UserRole.SHOP_ACCOUNT,
                organization_id=org.id,
                is_active=True,
            )
            shop.owner = owner
            session.add_all([owner, shop])
            await session.commit()
            org_id = org.id
            shop_id = shop.id
            owner_id = owner.id

        engine = create_engine(self.harness.sync_url, future=True)
        async with self.harness.session_factory() as session:
            await set_search_path(session, None)
            org_row = await session.get(Organization, org_id)
            assert org_row is not None

        dry_report = migrate_organization_data(engine, org_row, dry_run=True, execute=False)
        self.assertTrue(dry_report.tables)
        self.assertGreaterEqual(
            next(row.public_count for row in dry_report.tables if row.table == "shops"),
            1,
        )

        exec_report = migrate_organization_data(engine, org_row, dry_run=False, execute=True)
        self.assertTrue(exec_report.ok)

        async with self.harness.session_factory() as session:
            await set_search_path(session, schema_name)
            tenant_shop = await session.get(Shop, shop_id)
            self.assertIsNotNone(tenant_shop)

        async with self.harness.session_factory() as session:
            await set_search_path(session, None)
            has_shops = await session.scalar(text("SELECT to_regclass('public.shops')"))
            if has_shops:
                public_count = await session.scalar(
                    text("SELECT COUNT(*) FROM public.shops WHERE organization_id = :org_id"),
                    {"org_id": org_id},
                )
                self.assertEqual(public_count, 0)
            public_tables = await self.harness.list_public_tables()
            self.assertNotIn("shops", public_tables)

        from app.models import UserAuthIndex

        async with self.harness.session_factory() as session:
            await set_search_path(session, None)
            entry = await session.scalar(
                select(UserAuthIndex).where(UserAuthIndex.user_id == owner_id)
            )
            self.assertIsNotNone(entry)
            self.assertEqual(entry.schema_name, schema_name)

    async def test_login_via_user_auth_index(self) -> None:
        from app.services.auth import login_user

        super_admin = await self._create_super_admin()
        slug = f"login-{uuid4().hex[:8]}"
        schema_name = derive_schema_name(slug)
        self._cleanup_schema = schema_name
        username = f"tenant-{uuid4().hex[:6]}"

        async with self.harness.session_factory() as session:
            await set_search_path(session, None)
            org_read = await org_service.create_organization(
                session,
                OrganizationCreate(name="Login Test", slug=slug),
                super_admin,
            )
            self._cleanup_org_id = org_read.id

        async with self.harness.session_factory() as platform_db:
            await set_search_path(platform_db, schema_name)
            user = User(
                username=username,
                password_hash=get_password_hash("password123"),
                role=UserRole.TENANT_ADMIN,
                organization_id=org_read.id,
                is_active=True,
            )
            platform_db.add(user)
            await platform_db.flush()
            from app.services.user_auth_index import upsert_auth_index

            await set_search_path(platform_db, None)
            await upsert_auth_index(platform_db, user=user, schema_name=schema_name)
            await platform_db.commit()

        async with self.harness.session_factory() as platform_db:
            await set_search_path(platform_db, None)
            response = await login_user(
                platform_db,
                username,
                "password123",
            )
            self.assertEqual(response.user.username, username)
            self.assertEqual(response.user.organization_id, org_read.id)

    async def test_username_globally_unique_across_orgs(self) -> None:
        from fastapi import HTTPException

        from app.schemas.super_admin.tenant_admins import TenantAdminCreate
        from app.services.super_admin.tenant_admins import create_tenant_admin

        super_admin = await self._create_super_admin()
        shared_username = f"shared-{uuid4().hex[:6]}"
        slug_a = f"org-a-{uuid4().hex[:8]}"
        slug_b = f"org-b-{uuid4().hex[:8]}"
        schema_b = derive_schema_name(slug_b)
        self._cleanup_schema = schema_b

        async with self.harness.session_factory() as session:
            await set_search_path(session, None)
            org_a = await org_service.create_organization(
                session,
                OrganizationCreate(name="Org A", slug=slug_a),
                super_admin,
            )
            org_b = await org_service.create_organization(
                session,
                OrganizationCreate(name="Org B", slug=slug_b),
                super_admin,
            )
            self._cleanup_org_id = org_b.id

        async with self.harness.session_factory() as platform_db:
            await set_search_path(platform_db, None)
            await create_tenant_admin(
                platform_db,
                TenantAdminCreate(
                    organization_id=org_a.id,
                    username=shared_username,
                    password="password123",
                    role_ids=[],
                ),
                super_admin,
            )

        async with self.harness.session_factory() as platform_db:
            await set_search_path(platform_db, None)
            with self.assertRaises(HTTPException) as ctx:
                await create_tenant_admin(
                    platform_db,
                    TenantAdminCreate(
                        organization_id=org_b.id,
                        username=shared_username,
                        password="password123",
                        role_ids=[],
                    ),
                    super_admin,
                )
            self.assertEqual(ctx.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
