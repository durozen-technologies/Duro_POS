"""Catalogue metadata/delete must not silently mutate or miss shop-owned rows."""

from __future__ import annotations

import unittest

from fastapi import HTTPException
from sqlalchemy import select

from app.models import BaseUnit, Item, ItemCategory, Organization, ShopItemAllocation, UnitType
from app.schemas.admin import ItemMetadataUpdate, ItemUpdate
from app.services.admin.catalogue import allocate_catalogue_item
from app.services.admin.shops import delete_item, update_item, update_item_metadata
from test.support import AsyncSessionAdapter, BackendTestCase


class ItemMetadataScopeTests(BackendTestCase):
    def test_catalogue_metadata_rejects_shop_owned_item(self) -> None:
        async def scenario() -> None:
            _user, shop = await self.harness.create_shop_user(username="meta.shop")
            with self.harness.session_factory() as session:
                item = Item(
                    organization_id=shop.organization_id,
                    shop_id=shop.id,
                    name="Shop Chicken",
                    tamil_name="கோழி",
                    unit_type=UnitType.WEIGHT,
                    base_unit=BaseUnit.KG,
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
                with self.assertRaises(HTTPException) as ctx:
                    await update_item_metadata(
                        adapter,
                        item_id,
                        ItemMetadataUpdate(name="Renamed", tamil_name="புதிய"),
                    )
                self.assertEqual(ctx.exception.status_code, 404)
                self.assertIn("shop item metadata", str(ctx.exception.detail).lower())

        self.run_async(scenario())

    def test_catalogue_delete_rejects_shop_owned_item(self) -> None:
        async def scenario() -> None:
            _user, shop = await self.harness.create_shop_user(username="delete.shop")
            with self.harness.session_factory() as session:
                item = Item(
                    organization_id=shop.organization_id,
                    shop_id=shop.id,
                    name="Shop Duck",
                    tamil_name="வாத்து",
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
                with self.assertRaises(HTTPException) as ctx:
                    await delete_item(adapter, item_id)
                self.assertEqual(ctx.exception.status_code, 404)
                self.assertIn("shop item delete", str(ctx.exception.detail).lower())

        self.run_async(scenario())

    def test_catalogue_multipart_update_rejects_shop_owned_item(self) -> None:
        async def scenario() -> None:
            _user, shop = await self.harness.create_shop_user(username="update.shop")
            with self.harness.session_factory() as session:
                item = Item(
                    organization_id=shop.organization_id,
                    shop_id=shop.id,
                    name="Shop Mutton",
                    tamil_name="ஆட்டு",
                    unit_type=UnitType.WEIGHT,
                    base_unit=BaseUnit.KG,
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
                with self.assertRaises(HTTPException) as ctx:
                    await update_item(
                        adapter,
                        item_id,
                        ItemUpdate(
                            name="Renamed Mutton",
                            tamil_name="புதிய",
                            unit_type=UnitType.WEIGHT,
                            base_unit=BaseUnit.KG,
                            is_active=True,
                            sort_order=0,
                            custom_attributes={},
                        ),
                    )
                self.assertEqual(ctx.exception.status_code, 404)
                self.assertIn("shop item update", str(ctx.exception.detail).lower())

        self.run_async(scenario())

    def test_deactivating_catalogue_item_removes_shop_billing_allocations(self) -> None:
        async def scenario() -> None:
            _user, shop = await self.harness.create_shop_user(username="deact.shop")
            await self.harness.create_catalogue_items(("Chicken",))

            with self.harness.session_factory() as session:
                chicken = session.scalar(
                    select(Item).where(Item.name == "Chicken", Item.shop_id.is_(None))
                )
                self.assertIsNotNone(chicken)
                item_id = chicken.id

            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                from app.models import Shop

                current_shop = session.scalar(select(Shop).where(Shop.id == shop.id))
                await allocate_catalogue_item(adapter, current_shop, item_id)
                allocation = session.scalar(
                    select(ShopItemAllocation).where(
                        ShopItemAllocation.shop_id == shop.id,
                        ShopItemAllocation.item_id == item_id,
                    )
                )
                self.assertIsNotNone(allocation)

            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                updated = await update_item_metadata(
                    adapter,
                    item_id,
                    ItemMetadataUpdate(is_active=False),
                )
                self.assertFalse(updated.is_active)
                allocation = session.scalar(
                    select(ShopItemAllocation).where(
                        ShopItemAllocation.shop_id == shop.id,
                        ShopItemAllocation.item_id == item_id,
                    )
                )
                self.assertIsNone(allocation)

        self.run_async(scenario())

    def test_catalogue_update_resolves_category_for_item_organization(self) -> None:
        async def scenario() -> None:
            with self.harness.session_factory() as session:
                first_org = session.scalar(select(Organization).order_by(Organization.created_at))
                self.assertIsNotNone(first_org)
                second_org = Organization(name="Tenant B", slug="tenant-b", is_active=True)
                session.add(second_org)
                session.commit()
                session.refresh(second_org)
                self.assertNotEqual(first_org.id, second_org.id)

                category = ItemCategory(name="Raw items", organization_id=second_org.id)
                session.add(category)
                session.commit()
                session.refresh(category)

                item = Item(
                    organization_id=second_org.id,
                    shop_id=None,
                    name="Country Chicken",
                    tamil_name="நாட்டுக்கோழி",
                    unit_type=UnitType.WEIGHT,
                    base_unit=BaseUnit.KG,
                    sort_order=0,
                    category_id=category.id,
                    category=category.name,
                    is_active=True,
                    custom_attributes={},
                )
                session.add(item)
                session.commit()
                session.refresh(item)
                item_id = item.id

            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                updated = await update_item(
                    adapter,
                    item_id,
                    ItemUpdate(
                        name="Country Chicken",
                        tamil_name="நாட்டுக்கோழி",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        is_active=True,
                        sort_order=0,
                        category_id=category.id,
                        category=category.name,
                        custom_attributes={},
                    ),
                )
                self.assertEqual(updated.id, item_id)
                self.assertEqual(updated.category_id, category.id)

        self.run_async(scenario())


if __name__ == "__main__":
    unittest.main()
