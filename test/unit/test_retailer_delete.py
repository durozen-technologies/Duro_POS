from __future__ import annotations

import unittest
from decimal import Decimal

from fastapi import HTTPException

from test.support import AsyncSessionAdapter, BackendTestCase

from app.models import Retailer, RetailerSale, RetailerSaleStatus
from app.schemas.retailers import RetailerCreate
from app.services.retailers import create_retailer, delete_retailer, list_retailers


class RetailerDeleteTests(BackendTestCase):
    def test_delete_retailer_without_billing_history(self) -> None:
        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                retailer = await create_retailer(db, RetailerCreate(name="Wrong Name Shop"))
                await delete_retailer(db, retailer.id)
                deleted = session.get(Retailer, retailer.id)
                self.assertIsNone(deleted)

        self.run_async(scenario())

    def test_delete_retailer_with_billing_history_is_blocked(self) -> None:
        _user, shop = self.run_async(self.harness.create_shop_user())

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                retailer = await create_retailer(db, RetailerCreate(name="Billed Retailer"))
                session.add(
                    RetailerSale(
                        sale_no="RS-TEST-001",
                        retailer_id=retailer.id,
                        shop_id=shop.id,
                        total_amount=Decimal("100.00"),
                        amount_paid_total=Decimal("0.00"),
                        balance_due=Decimal("100.00"),
                        status=RetailerSaleStatus.OPEN,
                        created_by_user_id=_user.id,
                    )
                )
                session.commit()

                with self.assertRaises(HTTPException) as denied:
                    await delete_retailer(db, retailer.id)
                self.assertEqual(denied.exception.status_code, 409)
                self.assertIn("billing history", str(denied.exception.detail).lower())

                still_exists = session.get(Retailer, retailer.id)
                self.assertIsNotNone(still_exists)

        self.run_async(scenario())

    def test_list_retailers_marks_billed_retailers_as_not_deletable(self) -> None:
        _user, shop = self.run_async(self.harness.create_shop_user())

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                deletable = await create_retailer(db, RetailerCreate(name="Fresh Retailer"))
                billed = await create_retailer(db, RetailerCreate(name="Billed Retailer"))
                session.add(
                    RetailerSale(
                        sale_no="RS-TEST-002",
                        retailer_id=billed.id,
                        shop_id=shop.id,
                        total_amount=Decimal("50.00"),
                        amount_paid_total=Decimal("50.00"),
                        balance_due=Decimal("0.00"),
                        status=RetailerSaleStatus.SETTLED,
                        created_by_user_id=_user.id,
                    )
                )
                session.commit()

                page = await list_retailers(db, page_size=100)
                by_id = {item.id: item for item in page.items}
                self.assertTrue(by_id[deletable.id].can_delete)
                self.assertFalse(by_id[billed.id].can_delete)

        self.run_async(scenario())


if __name__ == "__main__":
    unittest.main()
