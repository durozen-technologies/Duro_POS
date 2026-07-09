from __future__ import annotations

import unittest
from decimal import Decimal

from app.schemas.billing import CheckoutPaymentInput


def _retailer_total_paid(payment: CheckoutPaymentInput) -> Decimal:
    return (
        payment.cash_amount + payment.upi_amount + payment.wallet_amount
    ).quantize(Decimal("0.01"))


class RetailerWalletMathTests(unittest.TestCase):
    def test_wallet_included_in_total_paid(self) -> None:
        payment = CheckoutPaymentInput(
            wallet_amount=Decimal("400.00"),
            cash_amount=Decimal("100.00"),
            upi_amount=Decimal("0.00"),
        )
        self.assertEqual(_retailer_total_paid(payment), Decimal("500.00"))

    def test_wallet_defaults_to_zero(self) -> None:
        payment = CheckoutPaymentInput(
            cash_amount=Decimal("50.00"),
            upi_amount=Decimal("25.00"),
        )
        self.assertEqual(payment.wallet_amount, Decimal("0"))
        self.assertEqual(_retailer_total_paid(payment), Decimal("75.00"))


if __name__ == "__main__":
    unittest.main()
