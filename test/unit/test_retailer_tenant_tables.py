from __future__ import annotations

import unittest

from app.db.tenant_metadata import tenant_table_names


class RetailerTenantTablesTests(unittest.TestCase):
    def test_retailer_tables_registered(self) -> None:
        names = set(tenant_table_names())
        expected = {
            "retailers",
            "retailer_item_prices",
            "retailer_sales",
            "retailer_sale_items",
            "retailer_payments",
            "retailer_sale_receipts",
            "monthly_retailer_sale_sequences",
            "retailer_inventory_purchases",
            "retailer_inventory_purchase_lines",
            "shop_retailer_allocations",
            "shop_retailer_item_allocations",
        }
        self.assertTrue(expected.issubset(names))


if __name__ == "__main__":
    unittest.main()
