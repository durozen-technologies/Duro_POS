"""Organization rename validation and audit."""

from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import HTTPException

from test.support import AsyncSessionAdapter, BackendTestCase

from app.models import Organization, User, UserRole
from app.schemas.super_admin.organizations import OrganizationUpdate
from app.services.super_admin import organizations as org_service


class OrganizationRenameTests(BackendTestCase):
    def test_rename_organization_requires_unique_name(self) -> None:
        async def scenario() -> None:
            super_admin = User(
                username="super",
                password_hash="x",
                role=UserRole.SUPER_ADMIN,
                is_active=True,
            )
            org_a_id = uuid4()
            org_b_id = uuid4()
            with self.harness.session_factory() as session:
                session.add(super_admin)
                session.add_all(
                    [
                        Organization(
                            id=org_a_id,
                            name="Alpha Org",
                            slug="alpha-org",
                            is_active=True,
                            max_branches=5,
                        ),
                        Organization(
                            id=org_b_id,
                            name="Beta Org",
                            slug="beta-org",
                            is_active=True,
                            max_branches=5,
                        ),
                    ]
                )
                session.commit()

            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                with self.assertRaises(HTTPException) as ctx:
                    await org_service.update_organization(
                        adapter,
                        org_b_id,
                        OrganizationUpdate(name="Alpha Org"),
                        super_admin,
                    )
                self.assertEqual(ctx.exception.status_code, 409)

        self.run_async(scenario())

    def test_rename_organization_writes_audit_details(self) -> None:
        async def scenario() -> None:
            from sqlalchemy import select

            from app.models import AuditLog

            super_admin = User(
                username="super",
                password_hash="x",
                role=UserRole.SUPER_ADMIN,
                is_active=True,
            )
            org_id = uuid4()
            with self.harness.session_factory() as session:
                session.add(super_admin)
                session.add(
                    Organization(
                        id=org_id,
                        name="Old Name",
                        slug="old-name",
                        is_active=True,
                        max_branches=5,
                    )
                )
                session.commit()

            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                with patch.object(
                    org_service, "_evict_org_counts_cache", new_callable=AsyncMock
                ):
                    updated = await org_service.update_organization(
                        adapter,
                        org_id,
                        OrganizationUpdate(name="New Name"),
                        super_admin,
                    )
                self.assertEqual(updated.name, "New Name")
                audit = await adapter.scalar(
                    select(AuditLog).where(
                        AuditLog.action == "organization.renamed",
                        AuditLog.entity_id == org_id,
                    )
                )
                self.assertIsNotNone(audit)
                assert audit is not None
                self.assertEqual(audit.details["previous_name"], "Old Name")
                self.assertEqual(audit.details["updated_name"], "New Name")
                self.assertEqual(audit.details["modified_by"], "super")

        self.run_async(scenario())


if __name__ == "__main__":
    unittest.main()
