from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select

from test.support import AsyncSessionAdapter, BackendTestCase  # isort: skip

from app.models import Bill, BillStatus, Item, Shop, User
from app.schemas.billing import (
    BillCheckoutCommitRequest,
    BillCheckoutRequest,
    BillEditPaymentInput,
    BillEditRequest,
    BillItemInput,
    CheckoutPaymentInput,
)
from app.services.admin.billing import get_shop_sales_summary
from app.services.billing import cancel_shop_bill, create_bill, edit_shop_bill, preview_bill


class ShopBillAdminIntegrationTests(BackendTestCase):
    async def _create_paid_bill(self, session, *, item_names: tuple[str, ...] = ("Chicken",)):
        db = AsyncSessionAdapter(session)
        shop_user = session.scalar(select(User).where(User.username == "ml1"))
        admin_user = session.scalar(select(User).where(User.username == "admin"))
        current_shop = session.scalar(select(Shop).where(Shop.owner_user_id == shop_user.id))
        await self.harness.create_prices_for_shop(
            current_shop.id,
            date.today(),
            {name: "100.00" for name in item_names},
        )
        chicken = session.scalar(
            select(Item).where(Item.name == "Chicken", Item.shop_id == current_shop.id)
        )
        payload = BillCheckoutRequest(
            items=[BillItemInput(item_id=chicken.id, quantity=Decimal("2"))],
            payment=CheckoutPaymentInput(
                cash_amount=Decimal("200.00"),
                upi_amount=Decimal("0.00"),
            ),
        )
        preview = await preview_bill(db, current_shop, payload)
        result = await create_bill(
            db,
            current_shop,
            BillCheckoutCommitRequest(
                items=payload.items,
                payment=payload.payment,
                checkout_token=preview.checkout_token,
            ),
            actor=shop_user,
        )
        return db, admin_user, current_shop, chicken, result.bill

    def test_admin_cancel_bill_within_24_hours(self) -> None:
        self.run_async(self.harness.create_admin_user())
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_items_for_shop(shop.id, ("Chicken",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db, admin_user, current_shop, _chicken, bill = await self._create_paid_bill(session)
                cancelled = await cancel_shop_bill(
                    db,
                    admin_user,
                    bill.id,
                    current_shop.organization_id,
                )
                self.assertEqual(cancelled.status, BillStatus.CANCELLED)

        self.run_async(scenario())

    def test_admin_cancel_bill_rejects_after_24_hours(self) -> None:
        self.run_async(self.harness.create_admin_user())
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_items_for_shop(shop.id, ("Chicken",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db, admin_user, current_shop, _chicken, bill = await self._create_paid_bill(session)
                row = session.get(Bill, bill.id)
                row.created_at = datetime.now(UTC) - timedelta(hours=25)
                await db.commit()
                with self.assertRaises(HTTPException) as ctx:
                    await cancel_shop_bill(
                        db,
                        admin_user,
                        bill.id,
                        current_shop.organization_id,
                    )
                self.assertEqual(ctx.exception.status_code, 409)

        self.run_async(scenario())

    def test_admin_cancel_bill_rejects_already_cancelled(self) -> None:
        self.run_async(self.harness.create_admin_user())
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_items_for_shop(shop.id, ("Chicken",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db, admin_user, current_shop, _chicken, bill = await self._create_paid_bill(session)
                await cancel_shop_bill(
                    db,
                    admin_user,
                    bill.id,
                    current_shop.organization_id,
                )
                with self.assertRaises(HTTPException) as ctx:
                    await cancel_shop_bill(
                        db,
                        admin_user,
                        bill.id,
                        current_shop.organization_id,
                    )
                self.assertEqual(ctx.exception.status_code, 409)

        self.run_async(scenario())

    def test_admin_edit_bill_updates_items_and_payment(self) -> None:
        self.run_async(self.harness.create_admin_user())
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_items_for_shop(shop.id, ("Chicken",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db, admin_user, current_shop, chicken, bill = await self._create_paid_bill(session)
                edited = await edit_shop_bill(
                    db,
                    admin_user,
                    bill.id,
                    current_shop.organization_id,
                    BillEditRequest(
                        items=[BillItemInput(item_id=chicken.id, quantity=Decimal("3"))],
                        payment=BillEditPaymentInput(
                            cash_amount=Decimal("150.00"),
                            upi_amount=Decimal("150.00"),
                        ),
                    ),
                )
                self.assertEqual(edited.status, BillStatus.PAID)
                self.assertEqual(edited.total_amount, Decimal("300.00"))
                self.assertEqual(edited.payment.cash_amount, Decimal("150.00"))
                self.assertEqual(edited.payment.upi_amount, Decimal("150.00"))
                self.assertEqual(edited.items[0].quantity, Decimal("3"))

        self.run_async(scenario())

    def test_admin_edit_bill_rejects_payment_mismatch(self) -> None:
        self.run_async(self.harness.create_admin_user())
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_items_for_shop(shop.id, ("Chicken",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db, admin_user, current_shop, chicken, bill = await self._create_paid_bill(session)
                with self.assertRaises(HTTPException) as ctx:
                    await edit_shop_bill(
                        db,
                        admin_user,
                        bill.id,
                        current_shop.organization_id,
                        BillEditRequest(
                            items=[BillItemInput(item_id=chicken.id, quantity=Decimal("3"))],
                            payment=BillEditPaymentInput(
                                cash_amount=Decimal("100.00"),
                                upi_amount=Decimal("100.00"),
                            ),
                        ),
                    )
                self.assertEqual(ctx.exception.status_code, 422)
                self.assertIn("Payment pending", ctx.exception.detail)

        self.run_async(scenario())

    def test_admin_edit_bill_rejects_wrong_item_set(self) -> None:
        self.run_async(self.harness.create_admin_user())
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_items_for_shop(shop.id, ("Chicken", "Duck")))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db, admin_user, current_shop, chicken, bill = await self._create_paid_bill(
                    session,
                    item_names=("Chicken", "Duck"),
                )
                duck = session.scalar(
                    select(Item).where(Item.name == "Duck", Item.shop_id == current_shop.id)
                )
                with self.assertRaises(HTTPException) as ctx:
                    await edit_shop_bill(
                        db,
                        admin_user,
                        bill.id,
                        current_shop.organization_id,
                        BillEditRequest(
                            items=[BillItemInput(item_id=duck.id, quantity=Decimal("1"))],
                            payment=BillEditPaymentInput(
                                cash_amount=Decimal("200.00"),
                                upi_amount=Decimal("0.00"),
                            ),
                        ),
                    )
                self.assertEqual(ctx.exception.status_code, 422)
                self.assertIn("Edited items must match", ctx.exception.detail)

        self.run_async(scenario())

    def test_shop_sales_summary_excludes_cancelled_bill(self) -> None:
        self.run_async(self.harness.create_admin_user())
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_items_for_shop(shop.id, ("Chicken",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db, admin_user, current_shop, _chicken, bill = await self._create_paid_bill(session)
                before = await get_shop_sales_summary(
                    db,
                    shop_id=current_shop.id,
                    organization_id=current_shop.organization_id,
                )
                self.assertEqual(len(before), 1)
                self.assertEqual(before[0].total_sales, Decimal("200.00"))

                await cancel_shop_bill(
                    db,
                    admin_user,
                    bill.id,
                    current_shop.organization_id,
                )
                after = await get_shop_sales_summary(
                    db,
                    shop_id=current_shop.id,
                    organization_id=current_shop.organization_id,
                )
                self.assertEqual(len(after), 1)
                self.assertEqual(after[0].total_sales, Decimal("0"))

        self.run_async(scenario())
