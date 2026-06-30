"""Unit tests for tenant schema naming helpers."""

from __future__ import annotations

import unittest

from app.db.tenant_schema import assert_safe_schema_name, derive_schema_name


class DeriveSchemaNameTests(unittest.TestCase):
    def test_slug_with_hyphens(self) -> None:
        self.assertEqual(derive_schema_name("org-a"), "tenant_org_a")

    def test_truncates_to_sixty_three_chars(self) -> None:
        long_slug = "a" * 80
        self.assertEqual(len(derive_schema_name(long_slug)), 63)
        self.assertTrue(derive_schema_name(long_slug).startswith("tenant_"))

    def test_assert_safe_schema_name_accepts_derived(self) -> None:
        name = derive_schema_name("acme-corp")
        self.assertEqual(assert_safe_schema_name(name), name)

    def test_assert_safe_schema_name_rejects_invalid(self) -> None:
        with self.assertRaises(ValueError):
            assert_safe_schema_name("bad-schema")


if __name__ == "__main__":
    unittest.main()
