"""Unit tests for inventory overnight weight-loss application."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from sqlalchemy import func, select

from app.core.timezone import ist_midnight, today_ist
from app.models import (
    BaseUnit,
    InventoryItem,
    InventoryMovement,
    InventoryMovementType,
    InventoryWeightLossApplication,
    Shop,
    UnitType,
)
from app.schemas.inventory import InventoryItemCreate
from app.services.inventory import (
    allocate_shop_inventory_items,
    create_inventory_item as create_inventory_management_item,
)
from app.services.weight_loss import (
    compute_weight_loss_kg,
    ensure_shop_weight_loss_applied,
    update_inventory_weight_loss,
)
from test.support import AsyncSessionAdapter, BackendTestCase


def _seed_add(
    session,
    *,
    shop_id,
    item_id,
    quantity: Decimal,
    bird_count: int,
    occurred_at,
) -> None:
    session.add(
        InventoryMovement(
            shop_id=shop_id,
            inventory_item_id=item_id,
            movement_type=InventoryMovementType.ADD,
            quantity=quantity,
            bird_count=bird_count,
            occurred_at=occurred_at,
        )
    )
    session.commit()


class WeightLossFormulaTests(BackendTestCase):
    def test_compute_weight_loss_kg(self) -> None:
        self.assertEqual(
            compute_weight_loss_kg(grams_per_day=50, bird_count=10),
            Decimal("0.500"),
        )
        self.assertEqual(compute_weight_loss_kg(grams_per_day=0, bird_count=10), Decimal("0"))
        self.assertEqual(compute_weight_loss_kg(grams_per_day=50, bird_count=0), Decimal("0"))


class WeightLossApplicationTests(BackendTestCase):
    def test_zero_grams_skips_application(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user(shop_name="WL Zero"))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.get(Shop, shop.id)
                item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="WL Zero Item",
                        tamil_name="zero",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[],
                        billing_item_ids=[],
                    ),
                )
                await allocate_shop_inventory_items(db, current_shop, [item.id])
                _seed_add(
                    session,
                    shop_id=current_shop.id,
                    item_id=item.id,
                    quantity=Decimal("10"),
                    bird_count=5,
                    occurred_at=ist_midnight(today_ist() - timedelta(days=2)),
                )
                created = await ensure_shop_weight_loss_applied(
                    db, current_shop.id, as_of_date=today_ist()
                )
                self.assertEqual(created, 0)
                apps = list(session.scalars(select(InventoryWeightLossApplication)).all())
                self.assertEqual(apps, [])

        self.run_async(scenario())

    def test_applies_loss_and_is_idempotent(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user(shop_name="WL Apply"))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.get(Shop, shop.id)
                item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="WL Apply Item",
                        tamil_name="reduce",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[],
                        billing_item_ids=[],
                    ),
                )
                await allocate_shop_inventory_items(db, current_shop, [item.id])
                await update_inventory_weight_loss(db, item.id, 100)
                add_day = today_ist() - timedelta(days=2)
                _seed_add(
                    session,
                    shop_id=current_shop.id,
                    item_id=item.id,
                    quantity=Decimal("10"),
                    bird_count=10,
                    occurred_at=ist_midnight(add_day),
                )

                created = await ensure_shop_weight_loss_applied(
                    db, current_shop.id, as_of_date=today_ist()
                )
                self.assertGreaterEqual(created, 1)

                use_qty = session.scalar(
                    select(func.coalesce(func.sum(InventoryMovement.quantity), 0)).where(
                        InventoryMovement.shop_id == current_shop.id,
                        InventoryMovement.inventory_item_id == item.id,
                        InventoryMovement.movement_type == InventoryMovementType.USE,
                    )
                )
                self.assertEqual(Decimal(str(use_qty)), Decimal("2.000"))

                created_again = await ensure_shop_weight_loss_applied(
                    db, current_shop.id, as_of_date=today_ist()
                )
                self.assertEqual(created_again, 0)
                use_qty_again = session.scalar(
                    select(func.coalesce(func.sum(InventoryMovement.quantity), 0)).where(
                        InventoryMovement.shop_id == current_shop.id,
                        InventoryMovement.inventory_item_id == item.id,
                        InventoryMovement.movement_type == InventoryMovementType.USE,
                    )
                )
                self.assertEqual(Decimal(str(use_qty_again)), Decimal("2.000"))

        self.run_async(scenario())

    def test_clamps_loss_to_available_kg(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user(shop_name="WL Clamp"))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.get(Shop, shop.id)
                item = await create_inventory_management_item(
                    db,
                    InventoryItemCreate(
                        name="WL Clamp Item",
                        tamil_name="clamp",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[],
                        billing_item_ids=[],
                    ),
                )
                await allocate_shop_inventory_items(db, current_shop, [item.id])
                await update_inventory_weight_loss(db, item.id, 500)
                add_day = today_ist() - timedelta(days=1)
                _seed_add(
                    session,
                    shop_id=current_shop.id,
                    item_id=item.id,
                    quantity=Decimal("0.200"),
                    bird_count=10,
                    occurred_at=ist_midnight(add_day),
                )

                await ensure_shop_weight_loss_applied(db, current_shop.id, as_of_date=today_ist())
                use_qty = session.scalar(
                    select(func.coalesce(func.sum(InventoryMovement.quantity), 0)).where(
                        InventoryMovement.shop_id == current_shop.id,
                        InventoryMovement.inventory_item_id == item.id,
                        InventoryMovement.movement_type == InventoryMovementType.USE,
                    )
                )
                self.assertEqual(Decimal(str(use_qty)), Decimal("0.200"))

                db_item = session.get(InventoryItem, item.id)
                self.assertEqual(db_item.weight_loss_grams_per_day, 500)

        self.run_async(scenario())
