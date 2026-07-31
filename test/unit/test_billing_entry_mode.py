"""Amount-mode billing entry and org setting helpers."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select

from test.support import AsyncSessionAdapter, BackendTestCase, bill_item

from app.models import Item, Organization, Shop, User
from app.schemas.billing import (
    BillCheckoutCommitRequest,
    BillCheckoutRequest,
    BillItemInput,
    CheckoutPaymentInput,
)
from app.services.billing import (
    _derive_quantity_from_amount,
    create_bill,
    preview_bill,
)
from app.services.org_billing import (
    BILLING_ENTRY_MODE_SETTING,
    billing_entry_mode_from_settings,
)


class OrgBillingEntryModeTests(BackendTestCase):
    def test_billing_entry_mode_defaults_to_kg(self) -> None:
        self.assertEqual(billing_entry_mode_from_settings(None), "kg")
        self.assertEqual(billing_entry_mode_from_settings({}), "kg")
        self.assertEqual(billing_entry_mode_from_settings({"billing_entry_mode": "nope"}), "kg")
        self.assertEqual(
            billing_entry_mode_from_settings({BILLING_ENTRY_MODE_SETTING: "amount"}),
            "amount",
        )

    def test_derive_unit_quantity_half_up(self) -> None:
        self.assertEqual(
            _derive_quantity_from_amount(
                Decimal("320.00"),
                Decimal("50.00"),
                base_unit="unit",
                item_name="Duck",
            ),
            Decimal("6"),
        )
        self.assertEqual(
            _derive_quantity_from_amount(
                Decimal("330.00"),
                Decimal("50.00"),
                base_unit="unit",
                item_name="Duck",
            ),
            Decimal("7"),
        )

    def test_amount_mode_keeps_exact_line_total_for_kg(self) -> None:
        actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(
            self.harness.create_prices_for_shop(
                shop.id,
                date.today(),
                {"Chicken": "189.00"},
            )
        )

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                org = session.get(Organization, shop.organization_id)
                org.settings = {**(org.settings or {}), BILLING_ENTRY_MODE_SETTING: "amount"}
                session.commit()

                chicken = session.scalar(
                    select(Item).where(Item.name == "Chicken", Item.shop_id == shop.id)
                )
                current_shop = session.get(Shop, shop.id)
                db = AsyncSessionAdapter(session)
                payload = BillCheckoutRequest(
                    items=[
                        BillItemInput(
                            item_id=chicken.id,
                            quantity=Decimal("1.058"),
                            line_total=Decimal("200.00"),
                        )
                    ],
                    payment=CheckoutPaymentInput(
                        cash_amount=Decimal("200.00"),
                        upi_amount=Decimal("0.00"),
                    ),
                )
                preview = await preview_bill(db, current_shop, payload)
                self.assertEqual(preview.total_amount, Decimal("200.00"))
                self.assertEqual(preview.items[0].line_total, Decimal("200.00"))
                self.assertEqual(preview.items[0].quantity, Decimal("1.058"))

                created = await create_bill(
                    db,
                    current_shop,
                    BillCheckoutCommitRequest(
                        items=payload.items,
                        payment=payload.payment,
                        checkout_token=preview.checkout_token,
                    ),
                    actor=session.get(User, actor.id),
                )
                self.assertEqual(created.bill.total_amount, Decimal("200.00"))
                self.assertEqual(created.bill.items[0].line_total, Decimal("200.00"))

        self.run_async(scenario())

    def test_amount_mode_rejects_quantity_mismatch(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(
            self.harness.create_prices_for_shop(
                shop.id,
                date.today(),
                {"Chicken": "189.00"},
            )
        )

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                org = session.get(Organization, shop.organization_id)
                org.settings = {**(org.settings or {}), BILLING_ENTRY_MODE_SETTING: "amount"}
                session.commit()

                chicken = session.scalar(
                    select(Item).where(Item.name == "Chicken", Item.shop_id == shop.id)
                )
                current_shop = session.get(Shop, shop.id)
                db = AsyncSessionAdapter(session)
                payload = BillCheckoutRequest(
                    items=[
                        BillItemInput(
                            item_id=chicken.id,
                            quantity=Decimal("1.000"),
                            line_total=Decimal("200.00"),
                        )
                    ],
                    payment=CheckoutPaymentInput(
                        cash_amount=Decimal("200.00"),
                        upi_amount=Decimal("0.00"),
                    ),
                )
                with self.assertRaises(HTTPException) as ctx:
                    await preview_bill(db, current_shop, payload)
                self.assertEqual(ctx.exception.status_code, 422)
                self.assertIn("does not match amount mode", ctx.exception.detail)

        self.run_async(scenario())

    def test_kg_mode_rejects_line_total_mismatch(self) -> None:
        _actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(
            self.harness.create_prices_for_shop(
                shop.id,
                date.today(),
                {"Chicken": "100.00"},
            )
        )

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                chicken = session.scalar(
                    select(Item).where(Item.name == "Chicken", Item.shop_id == shop.id)
                )
                current_shop = session.get(Shop, shop.id)
                db = AsyncSessionAdapter(session)
                payload = BillCheckoutRequest(
                    items=[
                        BillItemInput(
                            item_id=chicken.id,
                            quantity=Decimal("2"),
                            line_total=Decimal("150.00"),
                        )
                    ],
                    payment=CheckoutPaymentInput(
                        cash_amount=Decimal("150.00"),
                        upi_amount=Decimal("0.00"),
                    ),
                )
                with self.assertRaises(HTTPException) as ctx:
                    await preview_bill(db, current_shop, payload)
                self.assertEqual(ctx.exception.status_code, 422)
                self.assertIn("does not match quantity", ctx.exception.detail)

        self.run_async(scenario())

    def test_amount_mode_unit_half_up_persists_exact_amount(self) -> None:
        actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_items_for_shop(shop.id, ("Duck",)))
        self.run_async(
            self.harness.create_prices_for_shop(
                shop.id,
                date.today(),
                {"Duck": "50.00"},
            )
        )

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                org = session.get(Organization, shop.organization_id)
                org.settings = {**(org.settings or {}), BILLING_ENTRY_MODE_SETTING: "amount"}
                session.commit()

                duck = session.scalar(
                    select(Item).where(Item.name == "Duck", Item.shop_id == shop.id)
                )
                current_shop = session.get(Shop, shop.id)
                db = AsyncSessionAdapter(session)
                # 6.4 units at ₹50 → ROUND_HALF_UP → 6; keep entered ₹320
                payload = BillCheckoutRequest(
                    items=[
                        BillItemInput(
                            item_id=duck.id,
                            quantity=Decimal("6"),
                            line_total=Decimal("320.00"),
                        )
                    ],
                    payment=CheckoutPaymentInput(
                        cash_amount=Decimal("320.00"),
                        upi_amount=Decimal("0.00"),
                    ),
                )
                preview = await preview_bill(db, current_shop, payload)
                self.assertEqual(preview.items[0].quantity, Decimal("6"))
                self.assertEqual(preview.items[0].line_total, Decimal("320.00"))

                created = await create_bill(
                    db,
                    current_shop,
                    BillCheckoutCommitRequest(
                        items=payload.items,
                        payment=payload.payment,
                        checkout_token=preview.checkout_token,
                    ),
                    actor=session.get(User, actor.id),
                )
                self.assertEqual(created.bill.items[0].quantity, Decimal("6"))
                self.assertEqual(created.bill.total_amount, Decimal("320.00"))

                # 6.6 units → 7
                payload_up = BillCheckoutRequest(
                    items=[
                        BillItemInput(
                            item_id=duck.id,
                            quantity=Decimal("7"),
                            line_total=Decimal("330.00"),
                        )
                    ],
                    payment=CheckoutPaymentInput(
                        cash_amount=Decimal("330.00"),
                        upi_amount=Decimal("0.00"),
                    ),
                )
                preview_up = await preview_bill(db, current_shop, payload_up)
                self.assertEqual(preview_up.items[0].quantity, Decimal("7"))

        self.run_async(scenario())

    def test_kg_mode_still_accepts_matching_line_total(self) -> None:
        actor, shop = self.run_async(self.harness.create_shop_user())
        self.run_async(
            self.harness.create_prices_for_shop(
                shop.id,
                date.today(),
                {"Chicken": "100.00"},
            )
        )

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                chicken = session.scalar(
                    select(Item).where(Item.name == "Chicken", Item.shop_id == shop.id)
                )
                current_shop = session.get(Shop, shop.id)
                db = AsyncSessionAdapter(session)
                payload = BillCheckoutRequest(
                    items=[bill_item(chicken.id, Decimal("2"), "100.00")],
                    payment=CheckoutPaymentInput(
                        cash_amount=Decimal("200.00"),
                        upi_amount=Decimal("0.00"),
                    ),
                )
                preview = await preview_bill(db, current_shop, payload)
                created = await create_bill(
                    db,
                    current_shop,
                    BillCheckoutCommitRequest(
                        items=payload.items,
                        payment=payload.payment,
                        checkout_token=preview.checkout_token,
                    ),
                    actor=session.get(User, actor.id),
                )
                self.assertEqual(created.bill.total_amount, Decimal("200.00"))

        self.run_async(scenario())
