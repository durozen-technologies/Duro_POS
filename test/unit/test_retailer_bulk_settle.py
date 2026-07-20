from __future__ import annotations

from decimal import Decimal
from unittest import TestCase

from test.support import BackendTestCase  # noqa: F401 — sets up sys.path

from app.services.retailer_sales import _take_cash_upi


class RetailerBulkSettleUnitTests(TestCase):
    def test_take_cash_upi_cash_first_waterfall(self) -> None:
        cash_used, upi_used, cash_left, upi_left = _take_cash_upi(
            Decimal("5000.00"),
            Decimal("4000.00"),
            Decimal("3000.00"),
        )
        self.assertEqual(cash_used, Decimal("4000.00"))
        self.assertEqual(upi_used, Decimal("1000.00"))
        self.assertEqual(cash_left, Decimal("0.00"))
        self.assertEqual(upi_left, Decimal("2000.00"))

    def test_take_cash_upi_cash_only(self) -> None:
        cash_used, upi_used, cash_left, upi_left = _take_cash_upi(
            Decimal("200.00"),
            Decimal("500.00"),
            Decimal("0.00"),
        )
        self.assertEqual(cash_used, Decimal("200.00"))
        self.assertEqual(upi_used, Decimal("0.00"))
        self.assertEqual(cash_left, Decimal("300.00"))
        self.assertEqual(upi_left, Decimal("0.00"))
