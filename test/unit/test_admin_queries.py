from __future__ import annotations

import unittest
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects import postgresql

from test import support as _support  # noqa: F401

from app.models import Shop
from app.services.admin import _selected_shop_items_source


class AdminQueryTests(unittest.TestCase):
    def test_selected_shop_item_source_uses_typed_allocation_nulls(self) -> None:
        shop = Shop(id=UUID("019e4945-380f-7782-9e1c-b767087a20ae"))
        source = _selected_shop_items_source(shop)

        sql = str(select(source).compile(dialect=postgresql.dialect()))

        self.assertIn("CAST(NULL AS UUID) AS allocation_id", sql)
        self.assertIn("CAST(NULL AS VARCHAR(120)) AS allocation_display_name", sql)
        self.assertIn("CAST(NULL AS VARCHAR(120)) AS allocation_tamil_name", sql)
        self.assertIn("CAST(NULL AS BOOLEAN) AS allocation_is_active", sql)
        self.assertIn("CAST(NULL AS INTEGER) AS allocation_sort_order", sql)
        self.assertIn("CAST(NULL AS JSON) AS allocation_custom_attributes", sql)
        self.assertNotRegex(sql, r"%\(param_\d+\)s AS allocation_")


if __name__ == "__main__":
    unittest.main()
