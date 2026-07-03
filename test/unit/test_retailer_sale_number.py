from __future__ import annotations

import unittest
from datetime import UTC, datetime

from app.services.retailer_sale_number import retailer_sale_no_from_sequence


class RetailerSaleNumberTests(unittest.TestCase):
    def test_formats_rs_prefix_sequence(self) -> None:
        moment = datetime(2026, 7, 3, tzinfo=UTC)
        self.assertEqual(
            retailer_sale_no_from_sequence(moment, 1),
            "RS-2026-07-000001",
        )


if __name__ == "__main__":
    unittest.main()
