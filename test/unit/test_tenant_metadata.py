"""Unit tests for tenant metadata DDL helpers."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from app.db.tenant_metadata import verify_tenant_schema_ddl, _reuse_public_pg_enums


class VerifyTenantSchemaDdlTests(unittest.TestCase):
    def test_raises_with_missing_table_names(self) -> None:
        connection = MagicMock()
        inspector = MagicMock()
        inspector.get_table_names.return_value = ["alembic_version", "users"]

        with patch("app.db.tenant_metadata.inspect", return_value=inspector):
            with self.assertRaises(RuntimeError) as ctx:
                verify_tenant_schema_ddl(connection, "tenant_test")

        message = str(ctx.exception)
        self.assertIn("tenant_test", message)
        self.assertIn("shops", message)

    def test_passes_when_all_tenant_tables_present(self) -> None:
        from app.db.tenant_metadata import tenant_table_names

        connection = MagicMock()
        inspector = MagicMock()
        inspector.get_table_names.return_value = list(tenant_table_names()) + [
            "alembic_version"
        ]

        with patch("app.db.tenant_metadata.inspect", return_value=inspector):
            verify_tenant_schema_ddl(connection, "tenant_test")


class ReusePublicPgEnumsTests(unittest.TestCase):
    def test_patches_pg_enum_dialect_impl_in_place(self) -> None:
        from sqlalchemy import create_engine

        from app import models  # noqa: F401
        from app.db.database import Base

        items = Base.metadata.tables["items"]
        column = items.c.base_unit
        engine = create_engine("postgresql+psycopg://example/db")
        original_impl = column.type.dialect_impl(engine.dialect)
        original_create_type = original_impl.create_type
        original_schema = original_impl.schema
        connection = MagicMock()
        connection.dialect.name = "postgresql"
        connection.dialect = engine.dialect

        with _reuse_public_pg_enums(connection):
            patched_impl = column.type.dialect_impl(engine.dialect)
            self.assertIs(patched_impl, original_impl)
            self.assertEqual(patched_impl.schema, "public")
            self.assertFalse(patched_impl.create_type)

        restored_impl = column.type.dialect_impl(engine.dialect)
        self.assertEqual(restored_impl.create_type, original_create_type)
        self.assertEqual(restored_impl.schema, original_schema)


if __name__ == "__main__":
    unittest.main()
