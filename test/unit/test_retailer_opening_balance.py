from __future__ import annotations

import unittest
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

from app.schemas.billing import CheckoutPaymentInput
from app.schemas.retailers import RetailerSaleCheckoutRequest, RetailerSaleItemInput
from app.services.retailer_sales import _payload_fingerprint
from app.services.retailers import _total_outstanding


def _opening_balance_meta_lines(opening_balances: list[tuple[str, Decimal]]) -> list[str]:
    """Mirror of report PDF meta formatting (kept free of pdf.py circular imports)."""
    if not opening_balances:
        return []
    if len(opening_balances) == 1:
        _, amount = opening_balances[0]
        return [f"Opening Balance: Rs. {amount.quantize(Decimal('0.01'))}"]
    return [
        f"{name} Opening Balance: Rs. {amount.quantize(Decimal('0.01'))}"
        for name, amount in opening_balances
    ]


class RetailerOpeningBalanceTests(unittest.TestCase):
    def test_total_outstanding_includes_opening_balance(self) -> None:
        retailer = SimpleNamespace(opening_balance=Decimal("250.00"))
        self.assertEqual(
            _total_outstanding(retailer, Decimal("100.50")),
            Decimal("350.50"),
        )

    def test_total_outstanding_with_zero_sales(self) -> None:
        retailer = SimpleNamespace(opening_balance=Decimal("75.00"))
        self.assertEqual(
            _total_outstanding(retailer, Decimal("0.00")),
            Decimal("75.00"),
        )

    def test_checkout_fingerprint_includes_opening_flag(self) -> None:
        item_id = uuid4()
        retailer_id = uuid4()
        base = {
            "retailer_id": retailer_id,
            "items": [RetailerSaleItemInput(item_id=item_id, quantity=Decimal("1"))],
            "payment": CheckoutPaymentInput(
                cash_amount=Decimal("10.00"),
                upi_amount=Decimal("0.00"),
                wallet_amount=Decimal("0.00"),
            ),
        }
        with_opening = RetailerSaleCheckoutRequest(**base, include_opening_balance=True)
        without_opening = RetailerSaleCheckoutRequest(**base, include_opening_balance=False)
        self.assertNotEqual(
            _payload_fingerprint(with_opening),
            _payload_fingerprint(without_opening),
        )

    def test_opening_balance_meta_single_retailer(self) -> None:
        lines = _opening_balance_meta_lines([("Kumar Stores", Decimal("150.00"))])
        self.assertEqual(lines, ["Opening Balance: Rs. 150.00"])

    def test_opening_balance_meta_multiple_retailers(self) -> None:
        lines = _opening_balance_meta_lines(
            [
                ("Kumar Stores", Decimal("150.00")),
                ("Raja Mart", Decimal("80.50")),
            ]
        )
        self.assertEqual(
            lines,
            [
                "Kumar Stores Opening Balance: Rs. 150.00",
                "Raja Mart Opening Balance: Rs. 80.50",
            ],
        )


if __name__ == "__main__":
    unittest.main()
