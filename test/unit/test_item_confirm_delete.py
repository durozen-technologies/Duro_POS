"""Tenant-admin re-auth must gate irreversible catalogue deletes."""

from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from sqlalchemy import select

from app.models import BaseUnit, Item, UnitType, User
from app.routers.admin.catalogue import delete_inventory_item, delete_shop_inventory_item
from app.schemas.admin import ConfirmDeleteRequest
from app.services.admin._credentials import verify_tenant_admin_credentials
from app.services.admin.shops import delete_item
from test.support import AsyncSessionAdapter, BackendTestCase


class TenantAdminConfirmDeleteTests(BackendTestCase):
    def test_wrong_password_rejected(self) -> None:
        async def scenario() -> None:
            admin = await self.harness.create_admin_user(
                username="delete.admin", password="password123"
            )
            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                with self.assertRaises(HTTPException) as ctx:
                    await verify_tenant_admin_credentials(
                        adapter,
                        admin,
                        username="delete.admin",
                        password="wrong-password",
                    )
                self.assertEqual(ctx.exception.status_code, 401)
                self.assertIn("credentials", str(ctx.exception.detail).lower())

        self.run_async(scenario())

    def test_username_mismatch_rejected(self) -> None:
        async def scenario() -> None:
            admin = await self.harness.create_admin_user(
                username="real.admin", password="password123"
            )
            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                with self.assertRaises(HTTPException) as ctx:
                    await verify_tenant_admin_credentials(
                        adapter,
                        admin,
                        username="other.admin",
                        password="password123",
                    )
                self.assertEqual(ctx.exception.status_code, 401)

        self.run_async(scenario())

    def test_route_rejects_bad_password_before_delete(self) -> None:
        async def scenario() -> None:
            admin = await self.harness.create_admin_user(
                username="route.admin", password="password123"
            )
            org_id = admin.organization_id
            assert org_id is not None
            with self.harness.session_factory() as session:
                item = Item(
                    organization_id=org_id,
                    shop_id=None,
                    name="Gate Keep",
                    tamil_name="கேட்",
                    unit_type=UnitType.COUNT,
                    base_unit=BaseUnit.UNIT,
                    sort_order=0,
                    is_active=True,
                    custom_attributes={},
                )
                session.add(item)
                session.commit()
                session.refresh(item)
                item_id = item.id

            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                actor = await adapter.scalar(select(User).where(User.id == admin.id))
                assert actor is not None
                with self.assertRaises(HTTPException) as ctx:
                    await delete_inventory_item(
                        item_id,
                        ConfirmDeleteRequest(
                            username="route.admin",
                            password="wrong-password",
                        ),
                        adapter,
                        actor,
                    )
                self.assertEqual(ctx.exception.status_code, 401)

            with self.harness.session_factory() as session:
                still_there = session.get(Item, item_id)
                self.assertIsNotNone(still_there)

        self.run_async(scenario())

    def test_route_deletes_after_valid_reauth(self) -> None:
        async def scenario() -> None:
            admin = await self.harness.create_admin_user(
                username="ok.admin", password="password123"
            )
            org_id = admin.organization_id
            assert org_id is not None
            with self.harness.session_factory() as session:
                item = Item(
                    organization_id=org_id,
                    shop_id=None,
                    name="Temp Leg",
                    tamil_name="கால்",
                    unit_type=UnitType.COUNT,
                    base_unit=BaseUnit.UNIT,
                    sort_order=0,
                    is_active=True,
                    custom_attributes={},
                )
                session.add(item)
                session.commit()
                session.refresh(item)
                item_id = item.id

            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                actor = await adapter.scalar(select(User).where(User.id == admin.id))
                assert actor is not None
                with patch(
                    "app.services.admin.shops.delete_item_image_storage",
                    new=AsyncMock(),
                ):
                    response = await delete_inventory_item(
                        item_id,
                        ConfirmDeleteRequest(
                            username="ok.admin",
                            password="password123",
                        ),
                        adapter,
                        actor,
                    )
                self.assertEqual(response.status_code, 204)

            with self.harness.session_factory() as session:
                gone = session.get(Item, item_id)
                self.assertIsNone(gone)

        self.run_async(scenario())

    def test_shop_route_requires_reauth(self) -> None:
        async def scenario() -> None:
            admin = await self.harness.create_admin_user(
                username="shop.admin", password="password123"
            )
            _user, shop = await self.harness.create_shop_user(username="shop.del")
            with self.harness.session_factory() as session:
                item = Item(
                    organization_id=shop.organization_id,
                    shop_id=shop.id,
                    name="Shop Only",
                    tamil_name="கடை",
                    unit_type=UnitType.COUNT,
                    base_unit=BaseUnit.UNIT,
                    sort_order=0,
                    is_active=True,
                    custom_attributes={},
                )
                session.add(item)
                session.commit()
                session.refresh(item)
                item_id = item.id

            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                actor = await adapter.scalar(select(User).where(User.id == admin.id))
                assert actor is not None
                with self.assertRaises(HTTPException) as ctx:
                    await delete_shop_inventory_item(
                        item_id,
                        ConfirmDeleteRequest(
                            username="shop.admin",
                            password="bad-password",
                        ),
                        shop,
                        adapter,
                        actor,
                    )
                self.assertEqual(ctx.exception.status_code, 401)

        self.run_async(scenario())

    def test_confirm_delete_request_normalizes_username(self) -> None:
        payload = ConfirmDeleteRequest(username="  Admin.User  ", password="password123")
        self.assertEqual(payload.username, "admin.user")


if __name__ == "__main__":
    unittest.main()
