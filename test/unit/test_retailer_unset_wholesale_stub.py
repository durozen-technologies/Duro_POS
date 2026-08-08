"""Allocation stub 0.01 must surface as unset to clients."""

from __future__ import annotations

import unittest
from decimal import Decimal

from app.services.retailers import UNSET_WHOLESALE_STUB, public_wholesale_price


class PublicWholesalePriceTests(unittest.TestCase):
    def test_stub_maps_to_none(self) -> None:
        self.assertIsNone(public_wholesale_price(UNSET_WHOLESALE_STUB))
        self.assertIsNone(public_wholesale_price(Decimal("0.01")))
        self.assertIsNone(public_wholesale_price(None))

    def test_real_price_passes_through(self) -> None:
        self.assertEqual(public_wholesale_price(Decimal("155.00")), Decimal("155.00"))
        self.assertEqual(public_wholesale_price(Decimal("0.02")), Decimal("0.02"))


if __name__ == "__main__":
    unittest.main()
