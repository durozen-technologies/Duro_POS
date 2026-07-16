from __future__ import annotations

from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select

from app.models import (
    BaseUnit,
    InventoryItem,
    InventoryMovement,
    InventoryMovementType,
    Shop,
    UnitType,
)
from app.services.inventory import delete_inventory_item, get_inventory_item
from test.support import AsyncSessionAdapter, BackendTestCase


class InventoryItemDeleteGuardTests(BackendTestCase):
    def test_delete_allowed_before_usage(self) -> None:
        async def scenario() -> None:
            _admin, shop = await self.harness.create_shop_user(username="inv.del.before")
            with self.harness.session_factory() as session:
                item = InventoryItem(
                    organization_id=shop.organization_id,
                    name="Before Usage",
                    tamil_name="பயன்படுத்தவில்லை",
                    unit_type=UnitType.WEIGHT,
                    base_unit=BaseUnit.KG,
                    sort_order=0,
                    is_active=True,
                )
                session.add(item)
                session.commit()
                session.refresh(item)
                item_id = item.id

            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                await delete_inventory_item(adapter, item_id)
                deleted = session.get(InventoryItem, item_id)
                self.assertIsNone(deleted)

        self.run_async(scenario())

    def test_delete_blocked_after_usage(self) -> None:
        async def scenario() -> None:
            _admin, shop = await self.harness.create_shop_user(username="inv.del.after")
            with self.harness.session_factory() as session:
                current_shop = session.scalar(select(Shop).where(Shop.id == shop.id))
                item = InventoryItem(
                    organization_id=shop.organization_id,
                    name="After Usage",
                    tamil_name="பயன்பட்டது",
                    unit_type=UnitType.WEIGHT,
                    base_unit=BaseUnit.KG,
                    sort_order=0,
                    is_active=True,
                )
                session.add(item)
                session.commit()
                session.refresh(item)
                movement = InventoryMovement(
                    shop_id=current_shop.id,
                    inventory_item_id=item.id,
                    movement_type=InventoryMovementType.USE,
                    quantity=Decimal("1.000"),
                    bird_count=0,
                )
                session.add(movement)
                session.commit()
                item_id = item.id

            with self.harness.session_factory() as session:
                adapter = AsyncSessionAdapter(session)
                with self.assertRaises(HTTPException) as ctx:
                    await delete_inventory_item(adapter, item_id)
                self.assertEqual(ctx.exception.status_code, 409)
                self.assertIn("billing usage history", str(ctx.exception.detail).lower())

                read_item = await get_inventory_item(adapter, item_id)
                self.assertFalse(read_item.can_delete)

        self.run_async(scenario())

