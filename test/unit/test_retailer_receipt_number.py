from __future__ import annotations

import unittest
from datetime import UTC, datetime
from uuid import UUID

from app.services.retailer_receipt_number import balance_receipt_number, invoice_receipt_number


class RetailerReceiptNumberTests(unittest.TestCase):
    def test_invoice_receipt_number(self) -> None:
        self.assertEqual(invoice_receipt_number("RS-202607-0001"), "RCT-RS-202607-0001")

    def test_balance_receipt_number_embeds_datetime(self) -> None:
        paid_at = datetime(2026, 7, 3, 14, 30, 52, tzinfo=UTC)
        number = balance_receipt_number("RS-202607-0001", paid_at)
        self.assertEqual(number, "RCT-RS-202607-0001-20260703-143052")

    def test_balance_receipt_number_can_include_payment_suffix(self) -> None:
        paid_at = datetime(2026, 7, 3, 14, 30, 52, tzinfo=UTC)
        payment_id = UUID("01234567-89ab-cdef-0123-456789abcdef")
        number = balance_receipt_number("RS-202607-0001", paid_at, payment_id=payment_id)
        self.assertTrue(number.startswith("RCT-RS-202607-0001-20260703-143052-"))
        self.assertTrue(number.endswith("01234567"))


if __name__ == "__main__":
    unittest.main()
