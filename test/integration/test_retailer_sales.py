from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from io import BytesIO

from fastapi import HTTPException
from sqlalchemy import select

from test.support import AsyncSessionAdapter, BackendTestCase  # isort: skip

from app.models import Item, RetailerReceiptType, RetailerSaleStatus, Shop, User
from app.schemas.billing import CheckoutPaymentInput
from app.schemas.retailers import (
    RetailerCreate,
    RetailerItemPriceInput,
    RetailerPaymentCreate,
    RetailerSaleCheckoutCommitRequest,
    RetailerSaleCheckoutRequest,
    RetailerSaleItemInput,
)
from app.services.admin.catalogue import allocate_catalogue_item
from app.services.reports import generate_admin_report_pdf
from app.services.retailer_sales import (
    create_retailer_sale,
    get_retailer_sale,
    preview_retailer_sale,
    record_retailer_payment,
)
from app.services.retailers import create_retailer, sync_retailer_branch_allocations, sync_retailer_item_prices


class RetailerSalesIntegrationTests(BackendTestCase):
    async def _prepare_shop_retailer(
        self,
        session,
        *,
        username: str = "ml1",
    ):
        db = AsyncSessionAdapter(session)
        shop_user = session.scalar(select(User).where(User.username == username))
        current_shop = session.scalar(select(Shop).where(Shop.owner_user_id == shop_user.id))
        chicken = session.scalar(
            select(Item).where(Item.name == "Chicken", Item.shop_id.is_(None))
        )
        duck = session.scalar(select(Item).where(Item.name == "Duck", Item.shop_id.is_(None)))
        await allocate_catalogue_item(db, current_shop, chicken.id)
        retailer = await create_retailer(db, RetailerCreate(name="Wholesale Co"))
        await sync_retailer_branch_allocations(db, retailer.id, [current_shop.id])
        await sync_retailer_item_prices(
            db,
            retailer.id,
            [RetailerItemPriceInput(item_id=chicken.id, price_per_unit=Decimal("100.00"))],
        )
        return db, shop_user, current_shop, retailer, chicken, duck

    def test_create_retailer_and_map_items(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_catalogue_items(("Chicken",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db, _shop_user, _current_shop, retailer, chicken, _duck = (
                    await self._prepare_shop_retailer(session)
                )
                self.assertEqual(retailer.name, "Wholesale Co")
                mapped = await sync_retailer_item_prices(
                    db,
                    retailer.id,
                    [
                        RetailerItemPriceInput(
                            item_id=chicken.id,
                            price_per_unit=Decimal("125.50"),
                        )
                    ],
                )
                self.assertEqual(len(mapped), 1)
                self.assertEqual(mapped[0].price_per_unit, Decimal("125.50"))

        self.run_async(scenario())

    def test_shop_commit_full_payment_settles_sale(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_catalogue_items(("Chicken",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db, shop_user, current_shop, retailer, chicken, _duck = (
                    await self._prepare_shop_retailer(session)
                )
                payload = RetailerSaleCheckoutRequest(
                    retailer_id=retailer.id,
                    items=[RetailerSaleItemInput(item_id=chicken.id, quantity=Decimal("2"))],
                    payment=CheckoutPaymentInput(
                        cash_amount=Decimal("200.00"),
                        upi_amount=Decimal("0.00"),
                    ),
                )
                preview = await preview_retailer_sale(db, current_shop, shop_user, payload)
                sale = await create_retailer_sale(
                    db,
                    current_shop,
                    shop_user,
                    RetailerSaleCheckoutCommitRequest(
                        retailer_id=payload.retailer_id,
                        items=payload.items,
                        payment=payload.payment,
                        checkout_token=preview.checkout_token,
                    ),
                )
                self.assertEqual(sale.status, RetailerSaleStatus.SETTLED)
                self.assertEqual(sale.balance_due, Decimal("0.00"))
                self.assertEqual(sale.total_amount, Decimal("200.00"))
                self.assertTrue(sale.sale_no.startswith("RS-"))
                self.assertEqual(len(sale.receipts), 1)
                self.assertEqual(sale.receipts[0].receipt_type, RetailerReceiptType.SALE_INVOICE)
                self.assertEqual(sale.receipt.receipt_type, RetailerReceiptType.SALE_INVOICE)

        self.run_async(scenario())

    def test_partial_payment_then_second_payment_settles(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_catalogue_items(("Chicken",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db, shop_user, current_shop, retailer, chicken, _duck = (
                    await self._prepare_shop_retailer(session)
                )
                payload = RetailerSaleCheckoutRequest(
                    retailer_id=retailer.id,
                    items=[RetailerSaleItemInput(item_id=chicken.id, quantity=Decimal("3"))],
                    payment=CheckoutPaymentInput(
                        cash_amount=Decimal("100.00"),
                        upi_amount=Decimal("0.00"),
                    ),
                )
                preview = await preview_retailer_sale(db, current_shop, shop_user, payload)
                sale = await create_retailer_sale(
                    db,
                    current_shop,
                    shop_user,
                    RetailerSaleCheckoutCommitRequest(
                        retailer_id=payload.retailer_id,
                        items=payload.items,
                        payment=payload.payment,
                        checkout_token=preview.checkout_token,
                    ),
                )
                self.assertEqual(sale.status, RetailerSaleStatus.PARTIAL)
                self.assertEqual(sale.balance_due, Decimal("200.00"))
                self.assertEqual(len(sale.receipts), 1)
                self.assertEqual(sale.receipts[0].receipt_type, RetailerReceiptType.SALE_INVOICE)

                payment_result = await record_retailer_payment(
                    db,
                    current_shop,
                    shop_user,
                    sale.id,
                    RetailerPaymentCreate(
                        payment=CheckoutPaymentInput(
                            cash_amount=Decimal("150.00"),
                            upi_amount=Decimal("50.00"),
                        )
                    ),
                )
                settled = payment_result.sale
                self.assertEqual(settled.status, RetailerSaleStatus.SETTLED)
                self.assertEqual(settled.balance_due, Decimal("0.00"))
                self.assertEqual(len(settled.payments), 2)
                self.assertEqual(len(settled.receipts), 2)
                invoice_receipt = next(
                    receipt
                    for receipt in settled.receipts
                    if receipt.receipt_type == RetailerReceiptType.SALE_INVOICE
                )
                balance_receipt = payment_result.payment_receipt
                self.assertEqual(invoice_receipt.receipt_number, f"RCT-{sale.sale_no}")
                self.assertEqual(balance_receipt.receipt_type, RetailerReceiptType.BALANCE_PAYMENT)
                self.assertTrue(balance_receipt.receipt_number.startswith(f"RCT-{sale.sale_no}-"))
                self.assertEqual(
                    balance_receipt.retailer_payment_id,
                    settled.payments[-1].id,
                )

        self.run_async(scenario())

    def test_shop_rejects_unmapped_item(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_catalogue_items(("Chicken", "Duck")))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db, shop_user, current_shop, retailer, _chicken, duck = (
                    await self._prepare_shop_retailer(session)
                )
                payload = RetailerSaleCheckoutRequest(
                    retailer_id=retailer.id,
                    items=[RetailerSaleItemInput(item_id=duck.id, quantity=Decimal("1"))],
                    payment=CheckoutPaymentInput(
                        cash_amount=Decimal("50.00"),
                        upi_amount=Decimal("0.00"),
                    ),
                )
                with self.assertRaises(HTTPException) as context:
                    await preview_retailer_sale(db, current_shop, shop_user, payload)
                self.assertEqual(context.exception.status_code, 422)
                self.assertIn("not mapped", str(context.exception.detail).lower())

        self.run_async(scenario())

    def test_shop_cannot_access_other_shop_sale(self) -> None:
        _actor_a, shop_a = self.run_async(
            self.harness.create_shop_user(username="shop_a", shop_name="Shop A")
        )
        _actor_b, shop_b = self.run_async(
            self.harness.create_shop_user(username="shop_b", shop_name="Shop B")
        )
        self.run_async(self.harness.create_catalogue_items(("Chicken",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db, shop_user_a, current_shop_a, retailer, chicken, _duck = (
                    await self._prepare_shop_retailer(session, username="shop_a")
                )
                current_shop_b = session.scalar(
                    select(Shop).where(Shop.name == "Shop B")
                )
                await allocate_catalogue_item(db, current_shop_b, chicken.id)
                payload = RetailerSaleCheckoutRequest(
                    retailer_id=retailer.id,
                    items=[RetailerSaleItemInput(item_id=chicken.id, quantity=Decimal("1"))],
                    payment=CheckoutPaymentInput(
                        cash_amount=Decimal("100.00"),
                        upi_amount=Decimal("0.00"),
                    ),
                )
                preview = await preview_retailer_sale(db, current_shop_a, shop_user_a, payload)
                sale = await create_retailer_sale(
                    db,
                    current_shop_a,
                    shop_user_a,
                    RetailerSaleCheckoutCommitRequest(
                        retailer_id=payload.retailer_id,
                        items=payload.items,
                        payment=payload.payment,
                        checkout_token=preview.checkout_token,
                    ),
                )
                with self.assertRaises(HTTPException) as context:
                    await get_retailer_sale(db, sale.id, shop_id=shop_b.id)
                self.assertEqual(context.exception.status_code, 404)

        self.run_async(scenario())

    def test_report_section_returns_rows_for_period(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_catalogue_items(("Chicken",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db, shop_user, current_shop, retailer, chicken, _duck = (
                    await self._prepare_shop_retailer(session)
                )
                payload = RetailerSaleCheckoutRequest(
                    retailer_id=retailer.id,
                    items=[RetailerSaleItemInput(item_id=chicken.id, quantity=Decimal("1"))],
                    payment=CheckoutPaymentInput(
                        cash_amount=Decimal("60.00"),
                        upi_amount=Decimal("40.00"),
                    ),
                )
                preview = await preview_retailer_sale(db, current_shop, shop_user, payload)
                sale = await create_retailer_sale(
                    db,
                    current_shop,
                    shop_user,
                    RetailerSaleCheckoutCommitRequest(
                        retailer_id=payload.retailer_id,
                        items=payload.items,
                        payment=payload.payment,
                        checkout_token=preview.checkout_token,
                    ),
                )
                today = datetime.now(UTC).date()
                report = await generate_admin_report_pdf(
                    db,
                    sections=["retailers"],
                    period="range",
                    range_start_date=today - timedelta(days=1),
                    range_end_date=today + timedelta(days=1),
                    shop_ids=[current_shop.id],
                    organization_id=current_shop.organization_id,
                )
                try:
                    from pypdf import PdfReader

                    data = report.file.read()
                    text = " ".join(
                        "\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(data)).pages).split()
                    )
                    self.assertIn("Retailer Sales Report", text)
                    self.assertIn(sale.sale_no, text)
                    self.assertIn("Wholesale Co", text)
                finally:
                    report.file.close()

        self.run_async(scenario())
