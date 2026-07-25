"""Organization printing preference helpers."""

from __future__ import annotations

import unittest

# Importing support first adds backend/ to sys.path for direct unittest runs.
# isort: off
from test import support as _support  # noqa: F401

from app.services.org_printing import printing_enabled_from_settings

# isort: on


class OrgPrintingTests(unittest.TestCase):
    def test_defaults_to_enabled_when_missing(self) -> None:
        self.assertTrue(printing_enabled_from_settings({}))
        self.assertTrue(printing_enabled_from_settings(None))

    def test_reads_false_from_settings(self) -> None:
        self.assertFalse(printing_enabled_from_settings({"printing_enabled": False}))

    def test_reads_true_from_settings(self) -> None:
        self.assertTrue(printing_enabled_from_settings({"printing_enabled": True}))


if __name__ == "__main__":
    unittest.main()
