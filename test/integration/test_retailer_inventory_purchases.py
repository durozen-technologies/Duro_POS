from __future__ import annotations

from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select

from test.support import AsyncSessionAdapter, BackendTestCase  # isort: skip

from app.models import BaseUnit, Retailer, RetailerPayment, RetailerSale, RetailerSaleStatus, UnitType
from app.schemas.billing import CheckoutPaymentInput
from app.schemas.inventory import InventoryItemCreate
from app.schemas.retailer_inventory import RetailerInventoryPurchaseCreate, RetailerInventoryPurchaseLineInput
from app.schemas.retailers import (
    RetailerCreate,
    RetailerItemPriceInput,
    RetailerSaleCheckoutCommitRequest,
    RetailerSaleCheckoutRequest,
    RetailerSaleItemInput,
)
from app.services.admin.catalogue import allocate_catalogue_item
from app.services.inventory import allocate_shop_inventory_items, create_inventory_item
from app.services.retailer_inventory_purchases import (
    create_retailer_inventory_purchase,
    void_retailer_inventory_purchase,
)
from app.services.retailer_sales import create_retailer_sale, preview_retailer_sale
from app.services.retailers import (
    create_retailer,
    sync_retailer_branch_allocations,
    sync_retailer_item_prices,
    sync_shop_retailer_item_catalog,
)


class RetailerInventoryPurchaseIntegrationTests(BackendTestCase):
    async def _prepare_shop_retailer_with_inventory(
        self,
        session,
        *,
        username: str = "ml1",
    ):
        db = AsyncSessionAdapter(session)
        from app.models import Item, Shop, User

        shop_user = session.scalar(select(User).where(User.username == username))
        current_shop = session.scalar(select(Shop).where(Shop.owner_user_id == shop_user.id))
        chicken = session.scalar(
            select(Item).where(Item.name == "Chicken", Item.shop_id.is_(None))
        )
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
        inventory_item = await create_inventory_item(
            db,
            InventoryItemCreate(
                name="Purchase Chicken Stock",
                tamil_name="வாங்கல் கோழி இருப்பு",
                unit_type=UnitType.WEIGHT,
                base_unit=BaseUnit.KG,
                category_ids=[],
                billing_item_ids=[],
            ),
        )
        await allocate_shop_inventory_items(db, current_shop, [inventory_item.id])
        return db, shop_user, current_shop, retailer, chicken, inventory_item

    async def _create_partial_sale(self, db, shop, user, retailer, chicken):
        payload = RetailerSaleCheckoutRequest(
            retailer_id=retailer.id,
            items=[RetailerSaleItemInput(item_id=chicken.id, quantity=Decimal("3"))],
            payment=CheckoutPaymentInput(cash_amount=Decimal("100.00"), upi_amount=Decimal("0.00")),
        )
        preview = await preview_retailer_sale(db, shop, user, payload)
        return await create_retailer_sale(
            db,
            shop,
            user,
            RetailerSaleCheckoutCommitRequest(
                retailer_id=payload.retailer_id,
                items=payload.items,
                payment=payload.payment,
                checkout_token=preview.checkout_token,
            ),
        )

    def test_purchase_applies_fifo_and_deposits_remainder(self) -> None:
        _actor, _shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_catalogue_items(("Chicken",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db, shop_user, current_shop, retailer, chicken, inventory_item = (
                    await self._prepare_shop_retailer_with_inventory(session)
                )
                sale = await self._create_partial_sale(
                    db, current_shop, shop_user, retailer, chicken
                )
                self.assertEqual(sale.balance_due, Decimal("200.00"))

                purchase = await create_retailer_inventory_purchase(
                    db,
                    current_shop,
                    RetailerInventoryPurchaseCreate(
                        retailer_id=retailer.id,
                        lines=[
                            RetailerInventoryPurchaseLineInput(
                                inventory_item_id=inventory_item.id,
                                quantity=Decimal("5"),
                                bird_count=3,
                                price_per_unit=Decimal("100.00"),
                            )
                        ],
                    ),
                    actor=shop_user,
                )
                self.assertEqual(purchase.total_amount, Decimal("500.00"))
                self.assertEqual(purchase.lines[0].bird_count, 3)
                self.assertEqual(purchase.amount_applied_to_outstanding, Decimal("200.00"))
                self.assertEqual(purchase.amount_deposited_to_wallet, Decimal("300.00"))

                retailer_row = session.get(Retailer, retailer.id)
                session.refresh(retailer_row)
                self.assertEqual(retailer_row.credit_balance, Decimal("300.00"))

                sale_row = session.get(RetailerSale, sale.id)
                session.refresh(sale_row)
                self.assertEqual(sale_row.balance_due, Decimal("0.00"))
                self.assertEqual(sale_row.status, RetailerSaleStatus.SETTLED)

                payments = session.scalars(
                    select(RetailerPayment).where(
                        RetailerPayment.retailer_inventory_purchase_id == purchase.id
                    )
                ).all()
                self.assertEqual(len(payments), 1)
                self.assertEqual(payments[0].wallet_amount, Decimal("200.00"))

        self.run_async(scenario())

    def test_purchase_without_open_sales_deposits_full_amount(self) -> None:
        _actor, _shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_catalogue_items(("Chicken",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db, shop_user, current_shop, retailer, _chicken, inventory_item = (
                    await self._prepare_shop_retailer_with_inventory(session)
                )
                purchase = await create_retailer_inventory_purchase(
                    db,
                    current_shop,
                    RetailerInventoryPurchaseCreate(
                        retailer_id=retailer.id,
                        lines=[
                            RetailerInventoryPurchaseLineInput(
                                inventory_item_id=inventory_item.id,
                                quantity=Decimal("2"),
                                price_per_unit=Decimal("150.00"),
                            )
                        ],
                    ),
                    actor=shop_user,
                )
                self.assertEqual(purchase.amount_applied_to_outstanding, Decimal("0.00"))
                self.assertEqual(purchase.amount_deposited_to_wallet, Decimal("300.00"))
                retailer_row = session.get(Retailer, retailer.id)
                session.refresh(retailer_row)
                self.assertEqual(retailer_row.credit_balance, Decimal("300.00"))

        self.run_async(scenario())

    def test_void_after_settlement_restores_sale_and_wallet(self) -> None:
        _actor, _shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_catalogue_items(("Chicken",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db, shop_user, current_shop, retailer, chicken, inventory_item = (
                    await self._prepare_shop_retailer_with_inventory(session)
                )
                sale = await self._create_partial_sale(
                    db, current_shop, shop_user, retailer, chicken
                )
                purchase = await create_retailer_inventory_purchase(
                    db,
                    current_shop,
                    RetailerInventoryPurchaseCreate(
                        retailer_id=retailer.id,
                        lines=[
                            RetailerInventoryPurchaseLineInput(
                                inventory_item_id=inventory_item.id,
                                quantity=Decimal("2"),
                                price_per_unit=Decimal("200.00"),
                            )
                        ],
                    ),
                    actor=shop_user,
                )
                self.assertEqual(purchase.amount_applied_to_outstanding, Decimal("200.00"))

                voided = await void_retailer_inventory_purchase(
                    db,
                    current_shop,
                    purchase.id,
                    actor=shop_user,
                )
                self.assertEqual(voided.status, "void")

                sale_row = session.get(RetailerSale, sale.id)
                session.refresh(sale_row)
                self.assertEqual(sale_row.balance_due, Decimal("200.00"))
                self.assertEqual(sale_row.status, RetailerSaleStatus.PARTIAL)

                retailer_row = session.get(Retailer, retailer.id)
                session.refresh(retailer_row)
                self.assertEqual(retailer_row.credit_balance, Decimal("0.00"))

        self.run_async(scenario())

    def test_void_rejects_when_stock_insufficient(self) -> None:
        _actor, _shop = self.run_async(self.harness.create_shop_user())
        self.run_async(self.harness.create_catalogue_items(("Chicken",)))

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db, shop_user, current_shop, retailer, _chicken, inventory_item = (
                    await self._prepare_shop_retailer_with_inventory(session)
                )
                purchase = await create_retailer_inventory_purchase(
                    db,
                    current_shop,
                    RetailerInventoryPurchaseCreate(
                        retailer_id=retailer.id,
                        lines=[
                            RetailerInventoryPurchaseLineInput(
                                inventory_item_id=inventory_item.id,
                                quantity=Decimal("4"),
                                price_per_unit=Decimal("100.00"),
                            )
                        ],
                    ),
                    actor=shop_user,
                )
                from app.models import InventoryMovement, InventoryMovementType

                session.add(
                    InventoryMovement(
                        shop_id=current_shop.id,
                        inventory_item_id=inventory_item.id,
                        movement_type=InventoryMovementType.USE,
                        quantity=Decimal("4"),
                    )
                )
                session.commit()

                with self.assertRaises(HTTPException):
                    await void_retailer_inventory_purchase(
                        db,
                        current_shop,
                        purchase.id,
                        actor=shop_user,
                    )

        self.run_async(scenario())
