from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

# Importing support first adds backend/ to sys.path for direct unittest runs.
# isort: off
from test import support as _support

from app.models import (  # noqa: E402
    Bill,
    BillStatus,
    Payment,
    Retailer,
    RetailerPayment,
    RetailerSale,
    RetailerSaleStatus,
    ShopRetailerAllocation,
)
from app.services.admin.billing import get_dashboard_bootstrap  # noqa: E402
# isort: on

AsyncSessionAdapter = _support.AsyncSessionAdapter
BackendTestCase = _support.BackendTestCase


class DashboardBootstrapRetailerTests(BackendTestCase):
    def test_bootstrap_merges_retailer_paid_cash_upi_bills_and_outstanding(self) -> None:
        user, shop = self.run_async(self.harness.create_shop_user())
        org_id = shop.organization_id
        assert org_id is not None
        today = date.today()
        outside_period = datetime.now(UTC) - timedelta(days=40)

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)

                bill = Bill(
                    bill_no="BILL-DASH-001",
                    shop_id=shop.id,
                    created_by_user_id=user.id,
                    item_count=1,
                    total_quantity=Decimal("1.000"),
                    total_amount=Decimal("100.00"),
                    status=BillStatus.PAID,
                )
                session.add(bill)
                session.flush()
                session.add(
                    Payment(
                        bill_id=bill.id,
                        cash_amount=Decimal("60.00"),
                        upi_amount=Decimal("40.00"),
                        total_paid=Decimal("100.00"),
                        balance=Decimal("0.00"),
                        is_settled=True,
                    )
                )

                retailer = Retailer(
                    name="Credit Retailer",
                    opening_balance=Decimal("25.00"),
                    is_active=True,
                )
                session.add(retailer)
                session.flush()
                session.add(
                    ShopRetailerAllocation(
                        shop_id=shop.id,
                        retailer_id=retailer.id,
                        is_active=True,
                    )
                )

                in_period_sale = RetailerSale(
                    sale_no="RS-DASH-001",
                    retailer_id=retailer.id,
                    shop_id=shop.id,
                    retailer_name=retailer.name,
                    shop_name=shop.name,
                    total_amount=Decimal("200.00"),
                    amount_paid_total=Decimal("80.00"),
                    balance_due=Decimal("120.00"),
                    status=RetailerSaleStatus.PARTIAL,
                    created_by_user_id=user.id,
                )
                session.add(in_period_sale)
                session.flush()
                session.add(
                    RetailerPayment(
                        retailer_sale_id=in_period_sale.id,
                        cash_amount=Decimal("50.00"),
                        upi_amount=Decimal("30.00"),
                        wallet_amount=Decimal("0.00"),
                        total_paid=Decimal("80.00"),
                        paid_at=datetime.now(UTC),
                        recorded_by_user_id=user.id,
                    )
                )

                old_sale = RetailerSale(
                    sale_no="RS-DASH-OLD",
                    retailer_id=retailer.id,
                    shop_id=shop.id,
                    retailer_name=retailer.name,
                    shop_name=shop.name,
                    total_amount=Decimal("90.00"),
                    amount_paid_total=Decimal("0.00"),
                    balance_due=Decimal("90.00"),
                    status=RetailerSaleStatus.OPEN,
                    created_by_user_id=user.id,
                )
                session.add(old_sale)
                session.flush()
                old_sale.created_at = outside_period

                cancelled = RetailerSale(
                    sale_no="RS-DASH-CANCEL",
                    retailer_id=retailer.id,
                    shop_id=shop.id,
                    retailer_name=retailer.name,
                    shop_name=shop.name,
                    total_amount=Decimal("500.00"),
                    amount_paid_total=Decimal("0.00"),
                    balance_due=Decimal("500.00"),
                    status=RetailerSaleStatus.CANCELLED,
                    created_by_user_id=user.id,
                )
                session.add(cancelled)
                session.commit()

                bootstrap = await get_dashboard_bootstrap(
                    db,
                    organization_id=org_id,
                    period="date",
                    reference_date=today,
                    shop_id=shop.id,
                )

                self.assertEqual(len(bootstrap.sales_summary), 1)
                summary = bootstrap.sales_summary[0]
                self.assertEqual(summary.total_sales, Decimal("100.00"))
                self.assertEqual(summary.total_paid, Decimal("180.00"))
                self.assertEqual(summary.retailer_sale_count, 1)
                # Branch view excludes retailer-level opening balance.
                self.assertEqual(bootstrap.total_outstanding_due, Decimal("210.00"))

                self.assertEqual(len(bootstrap.payment_summary), 1)
                payment = bootstrap.payment_summary[0]
                self.assertEqual(payment.cash_total, Decimal("110.00"))
                self.assertEqual(payment.upi_total, Decimal("70.00"))

                self.assertEqual(bootstrap.bills.total_count, 2)
                self.assertEqual(bootstrap.bills.shop_stats[0].bill_count, 2)

        self.run_async(scenario())

    def test_outstanding_counts_opening_once_across_shop_allocations(self) -> None:
        user, shop_a = self.run_async(
            self.harness.create_shop_user(username="shop-a", shop_name="Shop A")
        )
        _user_b, shop_b = self.run_async(
            self.harness.create_shop_user(username="shop-b", shop_name="Shop B")
        )
        org_id = shop_a.organization_id
        assert org_id is not None

        async def scenario() -> None:
            with self.harness.session_factory() as session:
                db = AsyncSessionAdapter(session)
                retailer = Retailer(
                    name="Multi Branch Retailer",
                    opening_balance=Decimal("1000.00"),
                    is_active=True,
                )
                session.add(retailer)
                session.flush()
                session.add_all(
                    [
                        ShopRetailerAllocation(
                            shop_id=shop_a.id,
                            retailer_id=retailer.id,
                            is_active=True,
                        ),
                        ShopRetailerAllocation(
                            shop_id=shop_b.id,
                            retailer_id=retailer.id,
                            is_active=True,
                        ),
                        RetailerSale(
                            sale_no="RS-MULTI-001",
                            retailer_id=retailer.id,
                            shop_id=shop_a.id,
                            retailer_name=retailer.name,
                            shop_name=shop_a.name,
                            total_amount=Decimal("500.00"),
                            amount_paid_total=Decimal("0.00"),
                            balance_due=Decimal("500.00"),
                            status=RetailerSaleStatus.OPEN,
                            created_by_user_id=user.id,
                        ),
                    ]
                )
                session.commit()

                bootstrap = await get_dashboard_bootstrap(
                    db,
                    organization_id=org_id,
                    period="date",
                    reference_date=date.today(),
                )
                # Opening 1000 once + sale 500 — not opening*2 shops.
                self.assertEqual(bootstrap.total_outstanding_due, Decimal("1500.00"))

                shop_a_bootstrap = await get_dashboard_bootstrap(
                    db,
                    organization_id=org_id,
                    period="date",
                    reference_date=date.today(),
                    shop_id=shop_a.id,
                )
                self.assertEqual(shop_a_bootstrap.total_outstanding_due, Decimal("500.00"))

                shop_b_bootstrap = await get_dashboard_bootstrap(
                    db,
                    organization_id=org_id,
                    period="date",
                    reference_date=date.today(),
                    shop_id=shop_b.id,
                )
                self.assertEqual(shop_b_bootstrap.total_outstanding_due, Decimal("0.00"))

        self.run_async(scenario())


if __name__ == "__main__":
    import unittest

    unittest.main()
