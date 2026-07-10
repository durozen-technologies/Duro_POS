"""Unit tests for inventory bird_count aggregation."""

from __future__ import annotations

from decimal import Decimal

from fastapi import HTTPException

from app.models import BaseUnit, Shop, TransferShop, UnitType
from app.schemas.inventory import (
    InventoryAddRequest,
    InventoryItemCreate,
    InventoryStockAdjustRequest,
    InventoryUseRequest,
)
from app.schemas.retailer_inventory import RetailerInventoryUsageBulkCreate, RetailerInventoryUsageLine
from app.schemas.retailers import RetailerCreate
from app.services.inventory import (
    add_shop_inventory_stock,
    admin_set_shop_inventory_stock,
    allocate_shop_inventory_items,
    create_inventory_item as create_inventory_management_item,
    use_shop_inventory_stock,
)
from app.services.retailer_inventory import record_retailer_inventory_usages_bulk
from app.services.retailers import create_retailer, sync_retailer_branch_allocations
from test.support import AsyncSessionAdapter, BackendTestCase


class InventoryBirdCountPersistenceTests(BackendTestCase):
    def test_add_and_use_stock_persist_bird_count(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user(shop_name="Bird Shop"))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.get(Shop, shop.id)
                item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Chicken Stock",
                        tamil_name="கோழி",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[],
                        billing_item_ids=[],
                    ),
                )
                await allocate_shop_inventory_items(db, current_shop, [item.id])

                add_result = await add_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryAddRequest(
                        quantity=Decimal("10"),
                        bird_count=4,
                        driver_name="Driver",
                        vehicle_number="TN01AB1234",
                    ),
                )
                self.assertEqual(add_result.movement.bird_count, 4)
                self.assertEqual(add_result.item.added_bird_count, 4)
                self.assertEqual(add_result.item.available_bird_count, 4)

                use_result = await use_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryUseRequest(quantity=Decimal("3"), bird_count=2),
                )
                self.assertEqual(use_result.movement.bird_count, 2)
                self.assertEqual(use_result.item.available_bird_count, 2)
                self.assertEqual(use_result.item.used_bird_count, 2)

        self.run_async(scenario())

    def test_use_rejects_bird_count_above_available(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user(shop_name="Bird Shop 2"))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.get(Shop, shop.id)
                item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Broiler",
                        tamil_name="பிராய்லர்",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[],
                        billing_item_ids=[],
                    ),
                )
                await allocate_shop_inventory_items(db, current_shop, [item.id])
                await add_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryAddRequest(
                        quantity=Decimal("5"),
                        bird_count=2,
                        driver_name="Driver",
                        vehicle_number="TN01AB1234",
                    ),
                )

                with self.assertRaises(HTTPException) as ctx:
                    await use_shop_inventory_stock(
                        db,
                        current_shop,
                        item.id,
                        InventoryUseRequest(quantity=Decimal("1"), bird_count=3),
                    )
                self.assertEqual(ctx.exception.status_code, 409)

        self.run_async(scenario())

    def test_legacy_stock_without_bird_ledger_allows_use_bird_count(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user(shop_name="Legacy Bird Shop"))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.get(Shop, shop.id)
                item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Legacy Broiler",
                        tamil_name="பிராய்லர்",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[],
                        billing_item_ids=[],
                    ),
                )
                await allocate_shop_inventory_items(db, current_shop, [item.id])
                await add_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryAddRequest(
                        quantity=Decimal("100"),
                        bird_count=0,
                        driver_name="Driver",
                        vehicle_number="TN01AB1234",
                    ),
                )

                use_result = await use_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryUseRequest(quantity=Decimal("10"), bird_count=3),
                )
                self.assertEqual(use_result.movement.bird_count, 3)
                self.assertEqual(use_result.item.available_bird_count, 0)

        self.run_async(scenario())

    def test_tracked_bird_ledger_allows_use_below_available(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user(shop_name="Tracked Bird Shop"))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.get(Shop, shop.id)
                item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Tracked Broiler",
                        tamil_name="பிராய்லர்",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[],
                        billing_item_ids=[],
                    ),
                )
                await allocate_shop_inventory_items(db, current_shop, [item.id])
                await add_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryAddRequest(
                        quantity=Decimal("10"),
                        bird_count=5,
                        driver_name="Driver",
                        vehicle_number="TN01AB1234",
                    ),
                )

                ok_result = await use_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryUseRequest(quantity=Decimal("2"), bird_count=3),
                )
                self.assertEqual(ok_result.item.available_bird_count, 2)

                with self.assertRaises(HTTPException) as ctx:
                    await use_shop_inventory_stock(
                        db,
                        current_shop,
                        item.id,
                        InventoryUseRequest(quantity=Decimal("1"), bird_count=3),
                    )
                self.assertEqual(ctx.exception.status_code, 409)

        self.run_async(scenario())

    def test_retailer_stock_allows_birds_on_legacy_kg_stock(self) -> None:
        actor, shop = self.run_async(self.harness.create_shop_user(shop_name="Retailer Legacy Shop"))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.get(Shop, shop.id)
                item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Legacy Retailer Stock",
                        tamil_name="சரக்கு",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[],
                        billing_item_ids=[],
                    ),
                )
                await allocate_shop_inventory_items(db, current_shop, [item.id])
                await add_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryAddRequest(
                        quantity=Decimal("50"),
                        bird_count=0,
                        driver_name="Driver",
                        vehicle_number="TN01AB1234",
                    ),
                )
                retailer = await create_retailer(db, RetailerCreate(name="Corner Shop"))
                await sync_retailer_branch_allocations(db, retailer.id, [current_shop.id])

                result = await record_retailer_inventory_usages_bulk(
                    db,
                    current_shop,
                    RetailerInventoryUsageBulkCreate(
                        retailer_id=retailer.id,
                        lines=[
                            RetailerInventoryUsageLine(
                                inventory_item_id=item.id,
                                quantity=Decimal("10"),
                                bird_count=4,
                            )
                        ],
                    ),
                    actor=actor,
                )
                saved_item = next(row for row in result.summary.items if row.id == item.id)
                self.assertEqual(saved_item.available_bird_count, 0)

        self.run_async(scenario())

    def test_retailer_stock_allows_tracked_birds_below_available(self) -> None:
        actor, shop = self.run_async(self.harness.create_shop_user(shop_name="Tracked Retailer Shop"))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.get(Shop, shop.id)
                retailer = await create_retailer(db, RetailerCreate(name="Tracked Corner Shop"))
                await sync_retailer_branch_allocations(db, retailer.id, [current_shop.id])
                item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Tracked Retailer Stock",
                        tamil_name="சரக்கு",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[],
                        billing_item_ids=[],
                    ),
                )
                await allocate_shop_inventory_items(db, current_shop, [item.id])
                await add_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryAddRequest(
                        quantity=Decimal("50"),
                        bird_count=12,
                        driver_name="Driver",
                        vehicle_number="TN01AB1234",
                    ),
                )

                result = await record_retailer_inventory_usages_bulk(
                    db,
                    current_shop,
                    RetailerInventoryUsageBulkCreate(
                        retailer_id=retailer.id,
                        lines=[
                            RetailerInventoryUsageLine(
                                inventory_item_id=item.id,
                                quantity=Decimal("10"),
                                bird_count=5,
                            )
                        ],
                    ),
                    actor=actor,
                )
                saved_item = next(row for row in result.summary.items if row.id == item.id)
                self.assertEqual(saved_item.available_bird_count, 7)

        self.run_async(scenario())

    def test_add_birds_then_retailer_stock_immediately(self) -> None:
        actor, shop = self.run_async(self.harness.create_shop_user(shop_name="Immediate Retailer Shop"))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.get(Shop, shop.id)
                retailer = await create_retailer(db, RetailerCreate(name="Immediate Corner"))
                await sync_retailer_branch_allocations(db, retailer.id, [current_shop.id])
                item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="bdbdbd",
                        tamil_name="பறவை",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[],
                        billing_item_ids=[],
                    ),
                )
                await allocate_shop_inventory_items(db, current_shop, [item.id])
                await add_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryAddRequest(
                        quantity=Decimal("322"),
                        bird_count=0,
                        driver_name="Driver",
                        vehicle_number="TN01AB1234",
                    ),
                )
                await add_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryAddRequest(
                        quantity=Decimal("1"),
                        bird_count=19,
                        driver_name="Driver",
                        vehicle_number="TN01AB1234",
                    ),
                )

                result = await record_retailer_inventory_usages_bulk(
                    db,
                    current_shop,
                    RetailerInventoryUsageBulkCreate(
                        retailer_id=retailer.id,
                        lines=[
                            RetailerInventoryUsageLine(
                                inventory_item_id=item.id,
                                quantity=Decimal("10"),
                                bird_count=2,
                            )
                        ],
                    ),
                    actor=actor,
                )
                saved_item = next(row for row in result.summary.items if row.id == item.id)
                self.assertEqual(saved_item.available_bird_count, 17)

        self.run_async(scenario())

    def test_admin_bird_adjust_preserves_kg_totals(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user(shop_name="Admin Bird Shop"))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.get(Shop, shop.id)
                item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Layer Stock",
                        tamil_name="லேயர்",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[],
                        billing_item_ids=[],
                    ),
                )
                await allocate_shop_inventory_items(db, current_shop, [item.id])
                seeded = await add_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryAddRequest(
                        quantity=Decimal("100"),
                        bird_count=10,
                        driver_name="Driver",
                        vehicle_number="TN01AB1234",
                    ),
                )
                baseline_available = seeded.item.available_quantity
                baseline_used = seeded.item.used_quantity

                available_adjusted = await admin_set_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryStockAdjustRequest(available_bird_count=15),
                )
                self.assertEqual(available_adjusted.available_quantity, baseline_available)
                self.assertEqual(available_adjusted.used_quantity, baseline_used)
                self.assertEqual(available_adjusted.available_bird_count, 15)

                used_adjusted = await admin_set_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryStockAdjustRequest(used_bird_count=4),
                )
                self.assertEqual(used_adjusted.available_quantity, baseline_available)
                self.assertEqual(used_adjusted.used_quantity, baseline_used)
                self.assertEqual(used_adjusted.used_bird_count, 4)
                self.assertEqual(used_adjusted.available_bird_count, 11)

        self.run_async(scenario())

    def test_admin_transfer_bird_adjust_preserves_kg_totals(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user(shop_name="Transfer Bird Shop"))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.get(Shop, shop.id)
                item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Transfer Bird Stock",
                        tamil_name="பரிமாற்ற பறவை",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[],
                        billing_item_ids=[],
                    ),
                )
                await allocate_shop_inventory_items(db, current_shop, [item.id])
                await add_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryAddRequest(
                        quantity=Decimal("100"),
                        bird_count=20,
                        driver_name="Driver",
                        vehicle_number="TN01AB1234",
                    ),
                )
                session.add(
                    TransferShop(
                        name="Outside Branch",
                        tamil_name="வெளி கிளை",
                        organization_id=current_shop.organization_id,
                    )
                )
                session.flush()

                qty_adjusted = await admin_set_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryStockAdjustRequest(transfer_quantity=Decimal("25")),
                )
                baseline_available = qty_adjusted.available_quantity
                baseline_transfer = qty_adjusted.transfer_stock

                bird_adjusted = await admin_set_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryStockAdjustRequest(transfer_bird_count=6),
                )
                self.assertEqual(bird_adjusted.transfer_stock, baseline_transfer)
                self.assertEqual(bird_adjusted.available_quantity, baseline_available)
                self.assertEqual(bird_adjusted.transfer_bird_count, 6)

        self.run_async(scenario())

    def test_admin_transfer_bird_adjust_requires_transfer_quantity(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user(shop_name="Transfer Bird Shop 2"))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.get(Shop, shop.id)
                item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Transfer Bird Stock 2",
                        tamil_name="பரிமாற்ற பறவை 2",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[],
                        billing_item_ids=[],
                    ),
                )
                await allocate_shop_inventory_items(db, current_shop, [item.id])
                await add_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryAddRequest(
                        quantity=Decimal("50"),
                        bird_count=10,
                        driver_name="Driver",
                        vehicle_number="TN01AB1234",
                    ),
                )

                with self.assertRaises(HTTPException) as ctx:
                    await admin_set_shop_inventory_stock(
                        db,
                        current_shop,
                        item.id,
                        InventoryStockAdjustRequest(transfer_bird_count=3),
                    )
                self.assertEqual(ctx.exception.status_code, 422)

        self.run_async(scenario())


if __name__ == "__main__":
    import unittest

    unittest.main()
