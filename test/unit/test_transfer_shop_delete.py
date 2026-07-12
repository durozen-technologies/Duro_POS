from __future__ import annotations

from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select

from test.support import AsyncSessionAdapter, BackendTestCase  # isort: skip

from app.models import BaseUnit, InventoryTransfer, Shop, TransferShop, UnitType
from app.schemas.inventory import InventoryItemCreate
from app.schemas.transfer import TransferShopCreate
from app.services.inventory import allocate_shop_inventory_items, create_inventory_item
from app.services.transfer import (
    create_transfer_shop,
    delete_transfer_shop,
    list_transfer_shops,
)


class TransferShopDeleteTests(BackendTestCase):
    def test_list_transfer_shops_projects_has_history(self) -> None:
        admin_user = self.ensure_admin_user()
        _actor, shop = self.run_async(self.harness.create_shop_user(shop_name="Transfer Branch"))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.get(Shop, shop.id)
                created = await create_transfer_shop(
                    db,
                    TransferShopCreate(name="No History Shop", tamil_name="வரலாறு இல்லை"),
                    user_id=admin_user.id,
                )
                inventory_item = await create_inventory_item(
                    db,
                    InventoryItemCreate(
                        name="Transfer Stock",
                        tamil_name="பரிமாற்ற இருப்பு",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[],
                        billing_item_ids=[],
                    ),
                )
                await allocate_shop_inventory_items(db, current_shop, [inventory_item.id])
                destination = TransferShop(
                    name="History Shop",
                    tamil_name="வரலாறு கடை",
                    organization_id=current_shop.organization_id,
                )
                session.add(destination)
                session.flush()
                session.add(
                    InventoryTransfer(
                        source_shop_id=current_shop.id,
                        transfer_shop_id=destination.id,
                        inventory_item_id=inventory_item.id,
                        quantity=Decimal("2"),
                        unit=BaseUnit.KG,
                    )
                )
                session.commit()

                rows = await list_transfer_shops(db)
                by_id = {row.id: row for row in rows}
                self.assertFalse(by_id[created.id].has_history)
                self.assertTrue(by_id[destination.id].has_history)

        self.run_async(scenario())

    def test_delete_transfer_shop_without_history(self) -> None:
        admin_user = self.ensure_admin_user()

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                shop = await create_transfer_shop(
                    db,
                    TransferShopCreate(name="Disposable Shop", tamil_name="நீக்கக்கூடிய கடை"),
                    user_id=admin_user.id,
                )
                await delete_transfer_shop(db, shop.id, user_id=admin_user.id)
                remaining = session.scalar(
                    select(TransferShop).where(TransferShop.id == shop.id)
                )
                self.assertIsNone(remaining)

        self.run_async(scenario())

    def test_delete_transfer_shop_rejects_history(self) -> None:
        admin_user = self.ensure_admin_user()
        _actor, shop = self.run_async(self.harness.create_shop_user(shop_name="Protected Branch"))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                current_shop = session.get(Shop, shop.id)
                destination = TransferShop(
                    name="Protected Shop",
                    tamil_name="பாதுகாக்கப்பட்ட கடை",
                    organization_id=current_shop.organization_id,
                )
                session.add(destination)
                session.flush()
                inventory_item = await create_inventory_item(
                    db,
                    InventoryItemCreate(
                        name="Protected Stock",
                        tamil_name="பாதுகாக்கப்பட்ட இருப்பு",
                        unit_type=UnitType.WEIGHT,
                        base_unit=BaseUnit.KG,
                        category_ids=[],
                        billing_item_ids=[],
                    ),
                )
                await allocate_shop_inventory_items(db, current_shop, [inventory_item.id])
                session.add(
                    InventoryTransfer(
                        source_shop_id=current_shop.id,
                        transfer_shop_id=destination.id,
                        inventory_item_id=inventory_item.id,
                        quantity=Decimal("1"),
                        unit=BaseUnit.KG,
                    )
                )
                session.commit()

                with self.assertRaises(HTTPException) as ctx:
                    await delete_transfer_shop(db, destination.id, user_id=admin_user.id)
                self.assertEqual(ctx.exception.status_code, 409)

        self.run_async(scenario())
