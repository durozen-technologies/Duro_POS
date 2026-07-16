"""Global template image paths must resolve on retailer, inventory stock, and expense lists."""

from __future__ import annotations

import unittest
from types import SimpleNamespace
from uuid import uuid4

from app.models import BaseUnit, UnitType
from app.services.global_image_templates import (
    build_expense_image_paths_for_row,
    build_image_paths_for_row,
    build_inventory_image_paths_for_row,
)
from app.services.retailers import _allocation_read_from_row


class GlobalImageTemplateListPathTests(unittest.TestCase):
    def _template(self):
        template_id = uuid4()
        return SimpleNamespace(
            id=template_id,
            is_active=True,
            image_object_key="global/items/t/original/x.jpg",
            image_content_type="image/jpeg",
            image_thumbnail_object_key="global/items/t/thumb/x.jpg",
            image_thumbnail_content_type="image/jpeg",
        )

    def test_billing_style_row_resolves_template_paths(self) -> None:
        template = self._template()
        row = SimpleNamespace(
            id=uuid4(),
            image_object_key=None,
            image_content_type=None,
            image_thumbnail_object_key=None,
            image_thumbnail_content_type=None,
            global_image_template_id=template.id,
        )
        image_path, thumb_path, content_type = build_image_paths_for_row(
            row, {template.id: template}
        )
        self.assertIsNotNone(image_path)
        self.assertIn("/catalog/global-image-templates/", image_path or "")
        self.assertIsNotNone(thumb_path)
        self.assertEqual(content_type, "image/jpeg")

    def test_inventory_row_resolves_template_paths(self) -> None:
        template = self._template()
        row = SimpleNamespace(
            id=uuid4(),
            image_object_key=None,
            image_content_type=None,
            image_thumbnail_object_key=None,
            image_thumbnail_content_type=None,
            global_image_template_id=template.id,
        )
        image_path, thumb_path, _ = build_inventory_image_paths_for_row(
            row, {template.id: template}
        )
        self.assertIsNotNone(image_path)
        self.assertIn("/catalog/global-image-templates/", image_path or "")
        self.assertIsNotNone(thumb_path)

    def test_expense_row_resolves_template_paths(self) -> None:
        template = self._template()
        row = SimpleNamespace(
            id=uuid4(),
            image_object_key=None,
            image_content_type=None,
            image_thumbnail_object_key=None,
            image_thumbnail_content_type=None,
            global_image_template_id=template.id,
        )
        image_path, thumb_path, _ = build_expense_image_paths_for_row(
            row, {template.id: template}
        )
        self.assertIsNotNone(image_path)
        self.assertIn("/catalog/global-image-templates/", image_path or "")
        self.assertIsNotNone(thumb_path)

    def test_retailer_allocation_read_uses_template_paths(self) -> None:
        template = self._template()
        item = SimpleNamespace(
            id=uuid4(),
            name="Chicken",
            tamil_name="கோழி",
            unit_type=UnitType.WEIGHT,
            base_unit=BaseUnit.KG,
            image_object_key=None,
            image_content_type=None,
            image_thumbnail_object_key=None,
            image_thumbnail_content_type=None,
            global_image_template_id=template.id,
        )
        read = _allocation_read_from_row(
            item,  # type: ignore[arg-type]
            None,
            billing_price=None,
            is_allocated=True,
            templates_by_id={template.id: template},
        )
        self.assertIsNotNone(read.image_path)
        self.assertIn("/catalog/global-image-templates/", read.image_path or "")
        self.assertIsNotNone(read.image_thumb_path)


if __name__ == "__main__":
    unittest.main()
