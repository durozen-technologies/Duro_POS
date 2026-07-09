from __future__ import annotations

import unittest
from decimal import Decimal


class RetailerWalletVoidBalanceTests(unittest.TestCase):
    def test_void_purchase_can_make_credit_negative(self) -> None:
        credit_before = Decimal("100.00")
        purchase_total = Decimal("150.00")
        credit_after_void = (credit_before - purchase_total).quantize(Decimal("0.01"))
        self.assertEqual(credit_after_void, Decimal("-50.00"))


if __name__ == "__main__":
    unittest.main()
