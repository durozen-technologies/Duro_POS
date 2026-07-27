"""Organization printing preference helpers."""

from __future__ import annotations

import unittest

# Importing support first adds backend/ to sys.path for direct unittest runs.
# isort: off
from test import support as _support  # noqa: F401

from app.services.org_printing import (
    printing_enabled_from_settings,
    receipt_paper_mm_from_settings,
)

# isort: on


class OrgPrintingTests(unittest.TestCase):
    def test_defaults_to_enabled_when_missing(self) -> None:
        self.assertTrue(printing_enabled_from_settings({}))
        self.assertTrue(printing_enabled_from_settings(None))

    def test_reads_false_from_settings(self) -> None:
        self.assertFalse(printing_enabled_from_settings({"printing_enabled": False}))

    def test_reads_true_from_settings(self) -> None:
        self.assertTrue(printing_enabled_from_settings({"printing_enabled": True}))

    def test_receipt_paper_mm_defaults_to_58(self) -> None:
        self.assertEqual(receipt_paper_mm_from_settings({}), 58)
        self.assertEqual(receipt_paper_mm_from_settings(None), 58)

    def test_receipt_paper_mm_reads_valid_values(self) -> None:
        self.assertEqual(receipt_paper_mm_from_settings({"receipt_paper_mm": 58}), 58)
        self.assertEqual(receipt_paper_mm_from_settings({"receipt_paper_mm": 80}), 80)
        self.assertEqual(receipt_paper_mm_from_settings({"receipt_paper_mm": "80"}), 80)

    def test_receipt_paper_mm_coerces_invalid_to_58(self) -> None:
        self.assertEqual(receipt_paper_mm_from_settings({"receipt_paper_mm": 79}), 58)
        self.assertEqual(receipt_paper_mm_from_settings({"receipt_paper_mm": "wide"}), 58)
        self.assertEqual(receipt_paper_mm_from_settings({"receipt_paper_mm": None}), 58)


if __name__ == "__main__":
    unittest.main()
