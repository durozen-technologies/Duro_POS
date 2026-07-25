from __future__ import annotations

import unittest

from app.services.report_blank_columns import _filter_empty_report_columns, _is_blank_report_cell


class ReportBlankColumnTests(unittest.TestCase):
    def test_blank_cell_detector(self) -> None:
        self.assertTrue(_is_blank_report_cell(""))
        self.assertTrue(_is_blank_report_cell("-"))
        self.assertTrue(_is_blank_report_cell("0"))
        self.assertTrue(_is_blank_report_cell("0.00"))
        self.assertTrue(_is_blank_report_cell("Rs. 0.00"))
        self.assertTrue(_is_blank_report_cell("Rs.0.00"))
        self.assertTrue(_is_blank_report_cell("₹0.00"))
        self.assertTrue(_is_blank_report_cell("- Count"))
        self.assertTrue(_is_blank_report_cell("0 Kg\n- Count"))
        self.assertTrue(_is_blank_report_cell("0 Kg × ₹0.00\n= ₹0.00"))
        self.assertFalse(_is_blank_report_cell("Rs. 1.00"))
        self.assertFalse(_is_blank_report_cell("5 Kg"))
        self.assertFalse(_is_blank_report_cell("5 Kg\n- Count"))
        self.assertFalse(_is_blank_report_cell("Chicken"))

    def test_filter_drops_all_zero_columns_keeps_always_keep(self) -> None:
        headers = ["Bill No", "Items", "Wallet", "Cash", "UPI"]
        rows = [
            ["RS-1", "Chicken", "Rs. 0.00", "Rs. 0.00", "Rs. 10.00"],
            ["", "Duck", "Rs. 0.00", "", ""],
        ]
        filtered_headers, filtered_rows, widths, aligns, kept = _filter_empty_report_columns(
            headers,
            rows,
            always_keep={0, 1},
            widths=[10, 20, 30, 40, 50],
            aligns=["left", "left", "right", "right", "right"],
        )
        self.assertEqual(kept, [0, 1, 4])
        self.assertEqual(filtered_headers, ["Bill No", "Items", "UPI"])
        self.assertEqual(filtered_rows[0], ["RS-1", "Chicken", "Rs. 10.00"])
        self.assertEqual(widths, [10, 20, 50])
        self.assertEqual(aligns, ["left", "left", "right"])

    def test_filter_keeps_mixed_column(self) -> None:
        headers = ["A", "B"]
        rows = [["-", "1"], ["-", "-"]]
        _, _, _, _, kept = _filter_empty_report_columns(
            headers,
            rows,
            always_keep={0},
        )
        self.assertEqual(kept, [0, 1])

    def test_filter_drops_dash_only_metric(self) -> None:
        headers = ["Date", "Item", "Transfer"]
        rows = [["2026-07-25", "Chicken", "-"], ["", "Duck", "- Count"]]
        filtered_headers, _, _, _, kept = _filter_empty_report_columns(
            headers,
            rows,
            always_keep={0, 1},
        )
        self.assertEqual(kept, [0, 1])
        self.assertEqual(filtered_headers, ["Date", "Item"])


if __name__ == "__main__":
    unittest.main()
