from __future__ import annotations

from datetime import date
from decimal import Decimal

from test.support import AsyncSessionAdapter, BackendTestCase

from fastapi import HTTPException
from sqlalchemy import select

from app.models import Item, Shop, User
from app.schemas.admin import ShopCreate
from app.schemas.auth import RegisterRequest
from app.schemas.billing import BillCheckoutRequest, BillItemInput, CheckoutPaymentInput
from app.schemas.pricing import DailyPriceCreate, DailyPriceEntry
from app.services.admin import create_shop_account
from app.services.auth import register_admin
from app.services.billing import create_bill
from app.services.pricing import create_daily_prices, create_global_daily_prices


class ServiceUnitTests(BackendTestCase):
    def test_register_admin_rejects_second_admin(self) -> None:
        self.run_async(self.harness.create_admin_user())

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                with self.assertRaises(HTTPException) as ctx:
                    await register_admin(
                        db,
                        RegisterRequest(
                            username="second-admin",
                            password="password123",
                            confirm_password="password123",
                        ),
                    )
                self.assertEqual(ctx.exception.status_code, 409)
                self.assertEqual(
                    ctx.exception.detail, "Admin registration is already completed"
                )

        self.run_async(scenario())

    def test_create_shop_account_returns_created_shop(self) -> None:
        actor = self.run_async(self.harness.create_admin_user())
        self.run_async(
            self.harness.create_shop_user(username="ml7", shop_name="Existing Shop")
        )

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                created = await create_shop_account(
                    AsyncSessionAdapter(session),
                    ShopCreate(
                        name="Fresh Shop", username="ml8", password="password123"
                    ),
                    actor,
                )
                self.assertEqual(created.username, "ml8")
                self.assertEqual(created.name, "Fresh Shop")

        self.run_async(scenario())

    def test_seeded_default_items_include_database_images(self) -> None:
        async def scenario() -> None:
            with self.harness.session_factory() as session:
                chicken = session.scalar(select(Item).where(Item.name == "Chicken"))
                self.assertIsNotNone(chicken)
                self.assertIsNotNone(chicken.image_data)
                self.assertGreater(len(chicken.image_data), 0)
                self.assertTrue(chicken.image_content_type.startswith("image/"))

        self.run_async(scenario())

    def test_create_daily_prices_requires_all_active_items(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                items = session.scalars(
                    select(Item).where(Item.is_active.is_(True)).order_by(Item.id)
                ).all()
                db = AsyncSessionAdapter(session)
                payload = DailyPriceCreate(
                    entries=[
                        DailyPriceEntry(
                            item_id=items[0].id, price_per_unit=Decimal("120.00")
                        )
                    ]
                )
                with self.assertRaises(HTTPException) as ctx:
                    await create_daily_prices(db, shop, payload)
                self.assertEqual(ctx.exception.status_code, 422)
                self.assertEqual(
                    ctx.exception.detail,
                    "Prices must be provided for every active item",
                )

        self.run_async(scenario())

    def test_create_global_daily_prices_requires_active_shops(self) -> None:
        self.run_async(self.harness.create_admin_user())

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                items = session.scalars(
                    select(Item).where(Item.is_active.is_(True)).order_by(Item.id)
                ).all()
                db = AsyncSessionAdapter(session)
                payload = DailyPriceCreate(
                    entries=[
                        DailyPriceEntry(
                            item_id=item.id, price_per_unit=Decimal("150.00")
                        )
                        for item in items
                    ]
                )
                with self.assertRaises(HTTPException) as ctx:
                    await create_global_daily_prices(db, payload)
                self.assertEqual(ctx.exception.status_code, 422)
                self.assertEqual(
                    ctx.exception.detail, "No active shops to apply global prices to"
                )

        self.run_async(scenario())

    def test_create_global_daily_prices_rejects_duplicate_items(self) -> None:
        self.run_async(self.harness.create_shop_user())

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                items = session.scalars(
                    select(Item).where(Item.is_active.is_(True)).order_by(Item.id)
                ).all()
                db = AsyncSessionAdapter(session)
                payload = DailyPriceCreate(
                    entries=[
                        DailyPriceEntry(
                            item_id=items[0].id, price_per_unit=Decimal("150.00")
                        ),
                        DailyPriceEntry(
                            item_id=items[0].id, price_per_unit=Decimal("175.00")
                        ),
                    ]
                )
                with self.assertRaises(HTTPException) as ctx:
                    await create_global_daily_prices(db, payload)
                self.assertEqual(ctx.exception.status_code, 422)
                self.assertEqual(
                    ctx.exception.detail,
                    f"Duplicate price entry for item {items[0].id}",
                )

        self.run_async(scenario())

    def test_create_bill_rejects_fractional_count_item_quantities(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(
            self.harness.create_prices_for_shop(
                shop.id,
                date.today(),
                {
                    "Duck": "200.00",
                },
            )
        )

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                duck = session.scalar(select(Item).where(Item.name == "Duck"))
                db = AsyncSessionAdapter(session)
                payload = BillCheckoutRequest(
                    items=[BillItemInput(item_id=duck.id, quantity=Decimal("1.5"))],
                    payment=CheckoutPaymentInput(
                        cash_amount=Decimal("300.00"), upi_amount=Decimal("0.00")
                    ),
                )
                with self.assertRaises(HTTPException) as ctx:
                    await create_bill(db, shop, payload)
                self.assertEqual(ctx.exception.status_code, 422)
                self.assertEqual(
                    ctx.exception.detail, "Duck only accepts integer unit quantities"
                )

        self.run_async(scenario())

    def test_create_bill_rejects_underpayment(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(
            self.harness.create_prices_for_shop(
                shop.id,
                date.today(),
                {
                    "Chicken": "100.00",
                },
            )
        )

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                chicken = session.scalar(select(Item).where(Item.name == "Chicken"))
                db = AsyncSessionAdapter(session)
                payload = BillCheckoutRequest(
                    items=[BillItemInput(item_id=chicken.id, quantity=Decimal("2"))],
                    payment=CheckoutPaymentInput(
                        cash_amount=Decimal("150.00"), upi_amount=Decimal("0.00")
                    ),
                )
                with self.assertRaises(HTTPException) as ctx:
                    await create_bill(db, shop, payload)
                self.assertEqual(ctx.exception.status_code, 422)
                self.assertEqual(
                    ctx.exception.detail, "Payment pending. Balance: 50.00"
                )

        self.run_async(scenario())

    def test_create_bill_persists_paid_bill(self) -> None:
        actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(
            self.harness.create_prices_for_shop(
                shop.id,
                date.today(),
                {
                    "Chicken": "100.00",
                },
            )
        )

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                chicken = session.scalar(select(Item).where(Item.name == "Chicken"))
                db = AsyncSessionAdapter(session)
                payload = BillCheckoutRequest(
                    items=[BillItemInput(item_id=chicken.id, quantity=Decimal("2"))],
                    payment=CheckoutPaymentInput(
                        cash_amount=Decimal("200.00"), upi_amount=Decimal("0.00")
                    ),
                )
                created = await create_bill(db, shop, payload)
                self.assertEqual(created.status, "paid")
                self.assertEqual(created.total_amount, Decimal("200.00"))
                self.assertEqual(created.payment.total_paid, Decimal("200.00"))

                stored_shop = session.get(Shop, shop.id)
                stored_actor = session.get(User, actor.id)
                self.assertIsNotNone(stored_shop)
                self.assertIsNotNone(stored_actor)

        self.run_async(scenario())
