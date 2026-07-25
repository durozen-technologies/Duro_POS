"""Retailer shop catalog requires today's prices (no carry-forward)."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select

from test.support import AsyncSessionAdapter, BackendTestCase  # isort: skip

from app.models import Item, RetailerItemPrice, Shop, User
from app.schemas.billing import CheckoutPaymentInput
from app.schemas.retailers import (
    RetailerCreate,
    RetailerItemAllocationUpdate,
    RetailerItemPriceInput,
    RetailerSaleCheckoutRequest,
    RetailerSaleItemInput,
)
from app.services.admin.catalogue import allocate_catalogue_item
from app.services.retailer_sales import get_retailer_catalog, preview_retailer_sale
from app.services.retailers import (
    create_retailer,
    sync_retailer_branch_allocations,
    sync_retailer_item_prices,
    sync_shop_retailer_item_catalog,
    update_retailer_item_allocation,
)

class RetailerCatalogTodayPricesTests(BackendTestCase):
    def test_catalog_ignores_yesterday_prices(self) -> None:
        _actor, _shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_catalogue_items(("Chicken",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                shop_user = session.scalar(select(User).where(User.username == "ml1"))
                current_shop = session.scalar(select(Shop).where(Shop.owner_user_id == shop_user.id))
                chicken = session.scalar(
                    select(Item).where(Item.name == "Chicken", Item.shop_id.is_(None))
                )
                await allocate_catalogue_item(db, current_shop, chicken.id)
                retailer = await create_retailer(
                    db, RetailerCreate(name="Daily Gate Co", shop_name="Corner Meat Shop")
                )
                await sync_retailer_branch_allocations(db, retailer.id, [current_shop.id])
                await sync_shop_retailer_item_catalog(db, current_shop.id, [chicken.id])
                await sync_retailer_item_prices(
                    db,
                    retailer.id,
                    current_shop.id,
                    [RetailerItemPriceInput(item_id=chicken.id, price_per_unit=Decimal("100.00"))],
                )
                # Backdate the only price row to yesterday (carry-forward must not unlock billing).
                price_row = session.scalar(
                    select(RetailerItemPrice).where(
                        RetailerItemPrice.retailer_id == retailer.id,
                        RetailerItemPrice.shop_id == current_shop.id,
                        RetailerItemPrice.item_id == chicken.id,
                    )
                )
                assert price_row is not None
                price_row.effective_date = date.today() - timedelta(days=1)
                session.commit()

                locked = await get_retailer_catalog(db, current_shop, retailer.id)
                self.assertFalse(locked.prices_set)
                self.assertEqual(locked.items, [])
                self.assertEqual(locked.shop_name, current_shop.name)

                await update_retailer_item_allocation(
                    db,
                    retailer.id,
                    current_shop.id,
                    chicken.id,
                    RetailerItemAllocationUpdate(price_per_unit=Decimal("110.00"), is_active=True),
                )
                unlocked = await get_retailer_catalog(db, current_shop, retailer.id)
                self.assertTrue(unlocked.prices_set)
                self.assertEqual(len(unlocked.items), 1)
                self.assertEqual(unlocked.items[0].price_per_unit, Decimal("110.00"))

        self.run_async(scenario())

    def test_checkout_rejects_yesterday_only_prices(self) -> None:
        _actor, _shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_catalogue_items(("Chicken",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                shop_user = session.scalar(select(User).where(User.username == "ml1"))
                current_shop = session.scalar(select(Shop).where(Shop.owner_user_id == shop_user.id))
                chicken = session.scalar(
                    select(Item).where(Item.name == "Chicken", Item.shop_id.is_(None))
                )
                await allocate_catalogue_item(db, current_shop, chicken.id)
                retailer = await create_retailer(
                    db, RetailerCreate(name="Checkout Gate Co", shop_name="Corner Meat Shop")
                )
                await sync_retailer_branch_allocations(db, retailer.id, [current_shop.id])
                await sync_shop_retailer_item_catalog(db, current_shop.id, [chicken.id])
                await sync_retailer_item_prices(
                    db,
                    retailer.id,
                    current_shop.id,
                    [RetailerItemPriceInput(item_id=chicken.id, price_per_unit=Decimal("100.00"))],
                )
                price_row = session.scalar(
                    select(RetailerItemPrice).where(
                        RetailerItemPrice.retailer_id == retailer.id,
                        RetailerItemPrice.shop_id == current_shop.id,
                        RetailerItemPrice.item_id == chicken.id,
                    )
                )
                assert price_row is not None
                price_row.effective_date = date.today() - timedelta(days=1)
                session.commit()

                payload = RetailerSaleCheckoutRequest(
                    retailer_id=retailer.id,
                    items=[RetailerSaleItemInput(item_id=chicken.id, quantity=Decimal("1"))],
                    payment=CheckoutPaymentInput(cash_amount=Decimal("0.00"), upi_amount=Decimal("0.00")),
                )
                with self.assertRaises(HTTPException) as raised:
                    await preview_retailer_sale(db, current_shop, shop_user, payload)
                self.assertEqual(raised.exception.status_code, 422)
                self.assertIn("Today's retailer prices not set", str(raised.exception.detail))

        self.run_async(scenario())


if __name__ == "__main__":
    import unittest

    unittest.main()
