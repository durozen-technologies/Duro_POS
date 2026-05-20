from __future__ import annotations

from decimal import Decimal

from test.support import AsyncSessionAdapter, BackendTestCase

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models import Item, Shop, User
from app.routers.admin import (
    bills,
    create_shop,
    get_shops,
    global_daily_prices,
    global_prices_bootstrap,
    payment_summary,
    sales_summary,
    shop_daily_prices,
    shop_prices_bootstrap,
    update_shop_status,
)
from app.routers.auth import login, me, register
from app.routers.health import health_check
from app.routers.shop import bootstrap, checkout, save_daily_prices, today_prices
from app.schemas.admin import ShopCreate, ShopStatusUpdate
from app.schemas.auth import LoginRequest, RegisterRequest
from app.schemas.billing import BillCheckoutRequest, BillItemInput, CheckoutPaymentInput
from app.schemas.pricing import DailyPriceCreate, DailyPriceEntry


class BackendApiIntegrationTests(BackendTestCase):
    def test_health_endpoint(self) -> None:
        from fastapi import Request
        from unittest.mock import Mock
        mock_request = Mock(spec=Request)
        mock_request.app.state.database_ready = True
        mock_request.app.state.database_error = None
        import json
        response = health_check(mock_request)
        self.assertEqual(json.loads(response.body), {"status": "ok", "database": "connected", "error": None})

    def test_auth_endpoints(self) -> None:
        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                registered = await register(
                    RegisterRequest(
                        username="admin",
                        password="password123",
                        confirm_password="password123",
                    ),
                    db,
                )
                self.assertEqual(registered.user.role.value, "admin")
                self.assertEqual(registered.user.next_screen, "admin_dashboard")
                self.assertTrue(registered.access_token)

                admin_user = session.scalar(select(User).where(User.id == registered.user.id))
                current_session = await me(current_user=admin_user, db=db)
                self.assertEqual(current_session.username, "admin")

                logged_in = await login(LoginRequest(username="admin", password="password123"), db)
                self.assertEqual(logged_in.user.username, "admin")
                self.assertTrue(logged_in.access_token)

        self.run_async(scenario())

    def test_admin_and_shop_api_flow(self) -> None:
        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)

                registered_admin = await register(
                    RegisterRequest(
                        username="admin",
                        password="password123",
                        confirm_password="password123",
                    ),
                    db,
                )
                admin_user = session.scalar(select(User).where(User.id == registered_admin.user.id))

                created_shop = await create_shop(ShopCreate(name="Main Shop", username="ml1", password="password"), db, admin_user)
                self.assertEqual(created_shop.username, "ml1")
                shop_id = created_shop.id

                listed_shops = await get_shops(db)
                self.assertEqual(len(listed_shops), 1)

                global_bootstrap_before = await global_prices_bootstrap(db)
                self.assertFalse(global_bootstrap_before.prices_set)

                items = session.scalars(select(Item).where(Item.is_active.is_(True)).order_by(Item.id)).all()
                price_payload = DailyPriceCreate(
                    entries=[
                        DailyPriceEntry(
                            item_id=item.id,
                            price_per_unit=Decimal("100.00") + Decimal(index),
                        )
                        for index, item in enumerate(items)
                    ]
                )

                saved_global_prices = await global_daily_prices(price_payload, db, admin_user)
                self.assertEqual(len(saved_global_prices), len(items))

                current_shop = session.scalar(select(Shop).where(Shop.id == shop_id))

                admin_shop_bootstrap = await shop_prices_bootstrap(current_shop, db)
                self.assertTrue(admin_shop_bootstrap.prices_set)

                admin_shop_prices = await shop_daily_prices(price_payload, current_shop, db)
                self.assertEqual(len(admin_shop_prices), len(items))

                shop_login = await login(LoginRequest(username="ml1", password="password"), db)
                self.assertEqual(shop_login.user.next_screen, "billing")

                shop_user = await db.scalar(
                    select(User).options(selectinload(User.shop)).where(User.id == shop_login.user.id)
                )
                shop_session = await me(current_user=shop_user, db=db)
                self.assertEqual(shop_session.shop_id, shop_id)

                shop_bootstrap_response = await bootstrap(current_shop, db)
                self.assertTrue(shop_bootstrap_response.prices_set)

                today_price_rows = await today_prices(current_shop, db)
                self.assertEqual(len(today_price_rows), len(items))

                saved_shop_prices = await save_daily_prices(price_payload, db, current_shop)
                self.assertEqual(len(saved_shop_prices), len(items))

                refreshed_bootstrap = await bootstrap(current_shop, db)
                self.assertEqual(refreshed_bootstrap.next_screen, "billing")

                duck_item = next(item for item in refreshed_bootstrap.items if item.item_name == "Duck")
                chicken_item = next(item for item in refreshed_bootstrap.items if item.item_name == "Chicken")
                total_amount = duck_item.current_price + chicken_item.current_price * Decimal("2")

                created_bill = await checkout(
                    BillCheckoutRequest(
                        items=[
                            BillItemInput(item_id=duck_item.item_id, quantity=Decimal("1")),
                            BillItemInput(item_id=chicken_item.item_id, quantity=Decimal("2")),
                        ],
                        payment=CheckoutPaymentInput(
                            cash_amount=total_amount,
                            upi_amount=Decimal("0.00"),
                        ),
                    ),
                    db,
                    current_shop,
                )
                self.assertEqual(created_bill.status, "paid")
                self.assertTrue(created_bill.payment.is_settled)

                sales_rows = await sales_summary(period="date", reference_date=None, shop_id=None, db=db)
                self.assertEqual(sales_rows[0].shop_name, current_shop.name)

                weekly_sales_rows = await sales_summary(period="week", reference_date=None, shop_id=None, db=db)
                self.assertEqual(weekly_sales_rows[0].shop_name, current_shop.name)

                yearly_sales_rows = await sales_summary(period="year", reference_date=None, shop_id=None, db=db)
                self.assertEqual(yearly_sales_rows[0].shop_name, current_shop.name)

                payment_rows = await payment_summary(period="date", reference_date=None, shop_id=None, db=db)
                self.assertEqual(payment_rows[0].cash_total, total_amount)

                weekly_payment_rows = await payment_summary(period="week", reference_date=None, shop_id=None, db=db)
                self.assertEqual(weekly_payment_rows[0].cash_total, total_amount)

                yearly_payment_rows = await payment_summary(period="year", reference_date=None, shop_id=None, db=db)
                self.assertEqual(yearly_payment_rows[0].cash_total, total_amount)

                bill_rows = await bills(period="date", reference_date=None, shop_id=None, limit=50, cursor_created_at=None, cursor_id=None, db=db)
                self.assertEqual(len(bill_rows.items), 1)

                weekly_bill_rows = await bills(period="week", reference_date=None, shop_id=None, limit=50, cursor_created_at=None, cursor_id=None, db=db)
                self.assertEqual(len(weekly_bill_rows.items), 1)

                yearly_bill_rows = await bills(period="year", reference_date=None, shop_id=None, limit=50, cursor_created_at=None, cursor_id=None, db=db)
                self.assertEqual(len(yearly_bill_rows.items), 1)


                disabled_shop = await update_shop_status(shop_id, ShopStatusUpdate(is_active=False), db)
                self.assertFalse(disabled_shop.is_active)

        self.run_async(scenario())
