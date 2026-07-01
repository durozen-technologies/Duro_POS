"""Branch limit enforcement for tenant organizations."""

from __future__ import annotations

import unittest
from uuid import uuid4

from fastapi import HTTPException

from test.support import AsyncSessionAdapter, BackendTestCase

from app.core.errors import BRANCH_LIMIT_REACHED_DETAIL
from app.models import Organization, Shop, User, UserRole
from app.schemas.admin import ShopCreate
from app.services.admin.shops import create_shop_account
from app.services.super_admin.organizations import assert_organization_can_add_branch


class BranchLimitTests(BackendTestCase):
    def test_create_shop_blocked_when_branch_limit_reached(self) -> None:
        async def scenario() -> None:
            org_id = uuid4()
            admin = User(
                username="limit.admin",
                password_hash="x",
                role=UserRole.TENANT_ADMIN,
                organization_id=org_id,
                is_active=True,
            )
            with self.harness.session_factory() as session:
                session.add(
                    Organization(
                        id=org_id,
                        name="Limited Org",
                        slug="limited-org",
                        is_active=True,
                        max_branches=1,
                    )
                )
                session.add(admin)
                session.add(
                    Shop(
                        name="Branch One",
                        organization_id=org_id,
                        owner=User(
                            username="shop1",
                            password_hash="x",
                            role=UserRole.SHOP_ACCOUNT,
                            organization_id=org_id,
                            is_active=True,
                        ),
                        is_active=True,
                    )
                )
                session.commit()

            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                with self.assertRaises(HTTPException) as ctx:
                    await create_shop_account(
                        adapter,
                        ShopCreate(name="Branch Two", username="shop2", password="password123"),
                        admin,
                    )
                self.assertEqual(ctx.exception.status_code, 403)
                self.assertEqual(ctx.exception.detail, BRANCH_LIMIT_REACHED_DETAIL)

        self.run_async(scenario())

    def test_assert_can_add_branch_allows_under_limit(self) -> None:
        async def scenario() -> None:
            org_id = uuid4()
            with self.harness.session_factory() as session:
                session.add(
                    Organization(
                        id=org_id,
                        name="Roomy Org",
                        slug="roomy-org",
                        is_active=True,
                        max_branches=3,
                    )
                )
                session.commit()
                adapter = AsyncSessionAdapter(session)
                await assert_organization_can_add_branch(adapter, org_id)

        self.run_async(scenario())


if __name__ == "__main__":
    unittest.main()
