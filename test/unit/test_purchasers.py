from __future__ import annotations

from decimal import Decimal

from fastapi import HTTPException

from test.support import AsyncSessionAdapter, BackendTestCase  # isort: skip

from app.models import BaseUnit, Shop, UnitType
from app.schemas.inventory import InventoryAddRequest, InventoryItemCreate
from app.schemas.purchaser import PurchaserCreate, PurchaserUpdate
from app.services.inventory import (
    add_shop_inventory_stock,
    allocate_shop_inventory_items,
)
from app.services.inventory import (
    create_inventory_item as create_inventory_management_item,
)
from app.services.purchasers import create_purchaser, list_purchasers, update_purchaser


class PurchaserTests(BackendTestCase):
    def test_purchaser_crud_and_optional_add_stock(self) -> None:
        admin_user = self.ensure_admin_user()
        _actor, shop = self.run_async(self.harness.create_shop_user(shop_name="Purchaser Branch"))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.get(Shop, shop.id)
                purchaser = await create_purchaser(
                    db,
                    PurchaserCreate(
                        name="Fresh Farms",
                        shop_name="Main Yard",
                        phone="9876543210",
                        address="Market Road",
                    ),
                    user_id=admin_user.id,
                )
                self.assertEqual(purchaser.name, "Fresh Farms")
                self.assertEqual(purchaser.shop_name, "Main Yard")
                self.assertTrue(purchaser.is_active)

                active = await list_purchasers(db, active=True)
                self.assertTrue(any(row.id == purchaser.id for row in active))

                item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="Purchaser Stock",
                        tamil_name="கொள்முதல் சரக்கு",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[],
                        billing_item_ids=[],
                    ),
                )
                await allocate_shop_inventory_items(db, current_shop, [item.id])

                without_purchaser = await add_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryAddRequest(
                        quantity=Decimal("2"),
                        driver_name="Driver A",
                        vehicle_number="TN01AB1001",
                    ),
                )
                self.assertIsNone(without_purchaser.movement.purchaser_id)
                self.assertIsNone(without_purchaser.movement.purchaser_name)

                with_purchaser = await add_shop_inventory_stock(
                    db,
                    current_shop,
                    item.id,
                    InventoryAddRequest(
                        quantity=Decimal("3"),
                        driver_name="Driver B",
                        vehicle_number="TN01AB1002",
                        purchaser_id=purchaser.id,
                    ),
                )
                self.assertEqual(with_purchaser.movement.purchaser_id, purchaser.id)
                self.assertEqual(with_purchaser.movement.purchaser_name, "Fresh Farms")

                await update_purchaser(
                    db,
                    purchaser.id,
                    PurchaserUpdate(is_active=False),
                    user_id=admin_user.id,
                )
                with self.assertRaises(HTTPException) as ctx:
                    await add_shop_inventory_stock(
                        db,
                        current_shop,
                        item.id,
                        InventoryAddRequest(
                            quantity=Decimal("1"),
                            driver_name="Driver C",
                            vehicle_number="TN01AB1003",
                            purchaser_id=purchaser.id,
                        ),
                    )
                self.assertEqual(ctx.exception.status_code, 422)

                inactive_list = await list_purchasers(db, active=True)
                self.assertFalse(any(row.id == purchaser.id for row in inactive_list))

        self.run_async(scenario())
