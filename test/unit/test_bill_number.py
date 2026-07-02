"""Bill number prefix helpers."""

from __future__ import annotations

import unittest
from datetime import UTC, datetime

from app.services.bill_number import (
    bill_no_from_sequence,
    bill_number_prefix_from_settings,
    normalize_bill_number_prefix,
)


class BillNumberPrefixTests(unittest.TestCase):
    def test_default_prefix_when_setting_missing(self) -> None:
        self.assertEqual(bill_number_prefix_from_settings({}), "SMB")
        self.assertEqual(bill_number_prefix_from_settings(None), "SMB")

    def test_prefix_from_settings(self) -> None:
        self.assertEqual(
            bill_number_prefix_from_settings({"bill_number_prefix": "demo"}),
            "DEMO",
        )

    def test_bill_no_format(self) -> None:
        now = datetime(2026, 7, 2, tzinfo=UTC)
        self.assertEqual(
            bill_no_from_sequence(now, 42, "DEMO"),
            "DEMO-2026-07-000042",
        )

    def test_rejects_invalid_prefix(self) -> None:
        with self.assertRaises(ValueError):
            normalize_bill_number_prefix("bad prefix!")


if __name__ == "__main__":
    unittest.main()
