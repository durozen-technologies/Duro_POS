"""Public schema cutover integration tests (Postgres only)."""

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

from sqlalchemy import select, text

from test.postgres_support import PostgresHarness, postgres_test_url

from app.core.security import get_password_hash
from app.db.tenant_metadata import PUBLIC_SCHEMA_TABLES, verify_public_schema_clean
from app.db.tenant_schema import derive_schema_name, set_search_path
from app.models import Organization, User, UserRole
from app.schemas.super_admin.hard_delete import HardDeleteRequest
from app.schemas.super_admin.organizations import OrganizationCreate
from app.services.super_admin import organizations as org_service

_SKIP_REASON = (
    "Postgres test DB required: set TEST_DATABASE_URL or DATABASE_URL_TEST in backend/.env"
)


@unittest.skipUnless(postgres_test_url(), _SKIP_REASON)
class PublicSchemaCutoverTests(unittest.IsolatedAsyncioTestCase):
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
                    text("DELETE FROM organizations WHERE id = :id"),
                    {"id": self._cleanup_org_id},
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

    async def test_public_schema_contract_after_migrations(self) -> None:
        from sqlalchemy import create_engine

        engine = create_engine(self.harness.sync_url, future=True)
        with engine.connect() as conn:
            verify_public_schema_clean(conn)
        engine.dispose()

    async def test_new_org_leaves_public_control_plane_only(self) -> None:
        super_admin = await self._create_super_admin()
        slug = f"cutover-{uuid4().hex[:8]}"
        schema_name = derive_schema_name(slug)
        self._cleanup_schema = schema_name

        before = await self.harness.list_public_tables()

        async with self.harness.session_factory() as session:
            await set_search_path(session, None)
            org_read = await org_service.create_organization(
                session,
                OrganizationCreate(name="Cutover Test", slug=slug),
                super_admin,
            )
            self._cleanup_org_id = org_read.id

        after = await self.harness.list_public_tables()
        self.assertEqual(after - before, set())
        self.assertNotIn("shops", after)
        self.assertTrue(after.issubset(PUBLIC_SCHEMA_TABLES))

        async with self.harness.session_factory() as session:
            await set_search_path(session, None)
            row = await session.scalar(
                select(Organization.schema_name).where(Organization.id == org_read.id)
            )
            self.assertEqual(row, schema_name)
            self.assertIsNotNone(row)

    async def test_hard_delete_organization_drops_tenant_schema(self) -> None:
        super_admin = await self._create_super_admin()
        slug = f"hard-del-{uuid4().hex[:8]}"
        schema_name = derive_schema_name(slug)
        org_name = f"Hard Delete {slug}"

        async with self.harness.session_factory() as session:
            await set_search_path(session, None)
            org_read = await org_service.create_organization(
                session,
                OrganizationCreate(name=org_name, slug=slug),
                super_admin,
            )
            org_id = org_read.id

        self.assertTrue(await self.harness.schema_exists(schema_name))

        async with self.harness.session_factory() as session:
            await set_search_path(session, None)
            await org_service.hard_delete_organization(
                session,
                org_id,
                HardDeleteRequest(username=super_admin.username, password="password123"),
                super_admin,
            )

        self.assertFalse(await self.harness.schema_exists(schema_name))
        async with self.harness.session_factory() as session:
            await set_search_path(session, None)
            row = await session.scalar(select(Organization.id).where(Organization.id == org_id))
            self.assertIsNone(row)
