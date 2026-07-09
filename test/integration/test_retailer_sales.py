from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from io import BytesIO

from fastapi import HTTPException
from sqlalchemy import select

from test.support import AsyncSessionAdapter, BackendTestCase  # isort: skip

from app.models import Item, Retailer, RetailerReceiptType, RetailerSaleStatus, Shop, User
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
from app.services.retailer_sale_number import format_retailer_sale_bill_no
from app.services.retailer_sales import (
    create_retailer_sale,
    get_retailer_sale,
    preview_retailer_sale,
    record_retailer_payment,
)
from app.services.retailers import (
    bulk_allocate_retailer_items,
    create_retailer,
    list_retailer_item_allocations,
    list_retailer_item_prices,
    sync_retailer_branch_allocations,
    sync_retailer_item_prices,
    sync_shop_retailer_item_catalog,
)


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
        await sync_shop_retailer_item_catalog(db, current_shop.id, [chicken.id])
        await sync_retailer_item_prices(
            db,
            retailer.id,
            current_shop.id,
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
                    _current_shop.id,
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

    def test_list_and_bulk_allocate_items_skips_duplicates(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_catalogue_items(("Chicken", "Duck")))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db, _shop_user, current_shop, retailer, chicken, duck = (
                    await self._prepare_shop_retailer(session)
                )
                await allocate_catalogue_item(db, current_shop, duck.id)
                await sync_shop_retailer_item_catalog(
                    db, current_shop.id, [chicken.id, duck.id]
                )
                listing = await list_retailer_item_allocations(
                    db, retailer.id, shop_id=current_shop.id
                )
                self.assertGreaterEqual(len(listing.items), 2)
                chicken_row = next(row for row in listing.items if row.item_id == chicken.id)
                duck_row = next(row for row in listing.items if row.item_id == duck.id)
                self.assertTrue(chicken_row.is_allocated)
                self.assertFalse(duck_row.is_allocated)

                bulk = await bulk_allocate_retailer_items(
                    db,
                    retailer.id,
                    current_shop.id,
                    [
                        RetailerItemPriceInput(
                            item_id=chicken.id,
                            price_per_unit=Decimal("100.00"),
                        ),
                        RetailerItemPriceInput(
                            item_id=duck.id,
                            price_per_unit=Decimal("90.00"),
                        ),
                    ],
                )
                self.assertEqual(bulk.allocated_count, 1)
                self.assertEqual(bulk.already_allocated_count, 1)
                self.assertEqual(bulk.items[0].item_id, duck.id)

                allocated_only = await list_retailer_item_allocations(
                    db, retailer.id, shop_id=current_shop.id, allocated="allocated"
                )
                self.assertEqual(len(allocated_only.items), 2)
                self.assertTrue(all(row.is_allocated for row in allocated_only.items))

        self.run_async(scenario())

    def test_retailers_at_branch_can_have_different_wholesale_prices(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_catalogue_items(("Chicken",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db, _shop_user, current_shop, retailer_a, chicken, _duck = (
                    await self._prepare_shop_retailer(session)
                )
                retailer_b = await create_retailer(db, RetailerCreate(name="Second Wholesale"))
                await sync_retailer_branch_allocations(
                    db,
                    retailer_b.id,
                    [current_shop.id],
                )
                await sync_shop_retailer_item_catalog(db, current_shop.id, [chicken.id])

                from app.services.retailers import update_retailer_item_allocation
                from app.schemas.retailers import RetailerItemAllocationUpdate

                created = await update_retailer_item_allocation(
                    db,
                    retailer_b.id,
                    current_shop.id,
                    chicken.id,
                    RetailerItemAllocationUpdate(price_per_unit=Decimal("115.00")),
                )
                self.assertEqual(created.price_per_unit, Decimal("115.00"))

                await update_retailer_item_allocation(
                    db,
                    retailer_b.id,
                    current_shop.id,
                    chicken.id,
                    RetailerItemAllocationUpdate(price_per_unit=Decimal("115.00")),
                )
                prices_b = await list_retailer_item_prices(
                    db, retailer_b.id, shop_id=current_shop.id
                )
                self.assertEqual(prices_b[0].price_per_unit, Decimal("115.00"))

                await sync_retailer_item_prices(
                    db,
                    retailer_a.id,
                    current_shop.id,
                    [
                        RetailerItemPriceInput(
                            item_id=chicken.id,
                            price_per_unit=Decimal("100.00"),
                        )
                    ],
                )
                await sync_retailer_item_prices(
                    db,
                    retailer_b.id,
                    current_shop.id,
                    [
                        RetailerItemPriceInput(
                            item_id=chicken.id,
                            price_per_unit=Decimal("115.00"),
                        )
                    ],
                )

                prices_a = await list_retailer_item_prices(
                    db, retailer_a.id, shop_id=current_shop.id
                )
                prices_b = await list_retailer_item_prices(
                    db, retailer_b.id, shop_id=current_shop.id
                )
                self.assertEqual(prices_a[0].price_per_unit, Decimal("100.00"))
                self.assertEqual(prices_b[0].price_per_unit, Decimal("115.00"))

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
                    self.assertIn(format_retailer_sale_bill_no(sale.sale_no), text)
                    self.assertIn("Wholesale Co", text)
                finally:
                    report.file.close()

        self.run_async(scenario())

    def test_report_section_filters_by_retailer_ids(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_catalogue_items(("Chicken",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db, shop_user, current_shop, retailer, chicken, _duck = (
                    await self._prepare_shop_retailer(session)
                )
                other_retailer = await create_retailer(db, RetailerCreate(name="Other Retailer"))
                await sync_retailer_branch_allocations(db, other_retailer.id, [current_shop.id])
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
                report_params = {
                    "sections": ["retailers"],
                    "period": "range",
                    "range_start_date": today - timedelta(days=1),
                    "range_end_date": today + timedelta(days=1),
                    "shop_ids": [current_shop.id],
                    "organization_id": current_shop.organization_id,
                }

                def pdf_text(pdf_report) -> str:
                    from pypdf import PdfReader

                    data = pdf_report.file.read()
                    return " ".join(
                        "\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(data)).pages).split()
                    )

                matched_report = await generate_admin_report_pdf(
                    db,
                    retailer_ids=[retailer.id],
                    **report_params,
                )
                other_report = await generate_admin_report_pdf(
                    db,
                    retailer_ids=[other_retailer.id],
                    **report_params,
                )
                try:
                    matched_text = pdf_text(matched_report)
                    other_text = pdf_text(other_report)
                    bill_no = format_retailer_sale_bill_no(sale.sale_no)
                    self.assertIn(bill_no, matched_text)
                    self.assertIn("Wholesale Co", matched_text)
                    self.assertNotIn(bill_no, other_text)
                    self.assertNotIn("Wholesale Co", other_text)
                finally:
                    matched_report.file.close()
                    other_report.file.close()

        self.run_async(scenario())

    def test_wallet_payment_debits_credit_and_settles(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_catalogue_items(("Chicken",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db, shop_user, current_shop, retailer, chicken, _duck = (
                    await self._prepare_shop_retailer(session)
                )
                retailer_row = session.get(Retailer, retailer.id)
                retailer_row.credit_balance = Decimal("600.00")
                session.commit()

                zero_payload = RetailerSaleCheckoutRequest(
                    retailer_id=retailer.id,
                    items=[RetailerSaleItemInput(item_id=chicken.id, quantity=Decimal("6"))],
                    payment=CheckoutPaymentInput(
                        wallet_amount=Decimal("0.00"),
                        cash_amount=Decimal("0.00"),
                        upi_amount=Decimal("0.00"),
                    ),
                )
                zero_preview = await preview_retailer_sale(
                    db, current_shop, shop_user, zero_payload
                )
                with self.assertRaises(HTTPException):
                    await create_retailer_sale(
                        db,
                        current_shop,
                        shop_user,
                        RetailerSaleCheckoutCommitRequest(
                            retailer_id=zero_payload.retailer_id,
                            items=zero_payload.items,
                            payment=zero_payload.payment,
                            checkout_token=zero_preview.checkout_token,
                        ),
                    )

                payload = RetailerSaleCheckoutRequest(
                    retailer_id=retailer.id,
                    items=[RetailerSaleItemInput(item_id=chicken.id, quantity=Decimal("6"))],
                    payment=CheckoutPaymentInput(
                        wallet_amount=Decimal("400.00"),
                        cash_amount=Decimal("100.00"),
                        upi_amount=Decimal("100.00"),
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
                self.assertEqual(sale.payments[0].wallet_amount, Decimal("400.00"))
                session.refresh(retailer_row)
                self.assertEqual(retailer_row.credit_balance, Decimal("200.00"))

        self.run_async(scenario())

    def test_wallet_payment_rejects_insufficient_credit(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_catalogue_items(("Chicken",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db, shop_user, current_shop, retailer, chicken, _duck = (
                    await self._prepare_shop_retailer(session)
                )
                retailer_row = session.get(Retailer, retailer.id)
                retailer_row.credit_balance = Decimal("50.00")
                session.commit()

                payload = RetailerSaleCheckoutRequest(
                    retailer_id=retailer.id,
                    items=[RetailerSaleItemInput(item_id=chicken.id, quantity=Decimal("2"))],
                    payment=CheckoutPaymentInput(
                        wallet_amount=Decimal("100.00"),
                        cash_amount=Decimal("100.00"),
                        upi_amount=Decimal("0.00"),
                    ),
                )
                preview = await preview_retailer_sale(db, current_shop, shop_user, payload)
                with self.assertRaises(HTTPException) as ctx:
                    await create_retailer_sale(
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
                self.assertEqual(ctx.exception.status_code, 422)

        self.run_async(scenario())
