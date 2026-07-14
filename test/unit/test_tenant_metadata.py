"""Unit tests for tenant metadata DDL helpers."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from app.db.tenant_metadata import (
    ensure_tenant_schema_column_patches,
    ensure_tenant_schema_drift_patches,
    verify_tenant_schema_ddl,
    _ensure_receipt_status_uses_public_enum,
    _reuse_public_pg_enums,
)


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


class EnsureTenantSchemaColumnPatchesTests(unittest.TestCase):
    def test_adds_missing_daily_prices_published_on_column(self) -> None:
        connection = MagicMock()
        connection.dialect.name = "postgresql"
        inspector = MagicMock()
        inspector.get_table_names.return_value = ["shops", "bills", "receipts", "checkout_snapshots"]
        inspector.get_columns.side_effect = lambda table, schema=None: {
            "shops": [{"name": "id"}, {"name": "name"}],
            "bills": [{"name": "id"}],
            "receipts": [{"name": "id"}, {"name": "printed_at", "nullable": True}],
        }[table]
        inspector.get_foreign_keys.return_value = []

        with (
            patch("app.db.tenant_metadata.inspect", return_value=inspector),
            patch("app.db.tenant_metadata.create_tenant_tables"),
            patch("app.db.tenant_metadata._ensure_public_receipt_status_enum"),
            patch("app.db.tenant_metadata._ensure_public_billstatus_cancelled_enum"),
            patch("app.db.tenant_metadata._ensure_public_retailer_sale_status_cancelled_enum"),
        ):
            ensure_tenant_schema_drift_patches(connection, "tenant_test")

        executed_sql = " ".join(
            getattr(call.args[0], "text", str(call.args[0]))
            for call in connection.execute.call_args_list
        )
        self.assertIn("daily_prices_published_on", executed_sql)
        self.assertIn("checkout_token", executed_sql)
        self.assertIn("receipt_status", executed_sql)
        self.assertIn("public.receiptstatus", executed_sql)

    def test_skips_when_column_already_present(self) -> None:
        connection = MagicMock()
        connection.dialect.name = "postgresql"
        inspector = MagicMock()
        inspector.get_table_names.return_value = ["shops", "bills", "receipts", "checkout_snapshots"]
        inspector.get_columns.side_effect = lambda table, schema=None: {
            "shops": [{"name": "id"}, {"name": "daily_prices_published_on"}],
            "bills": [
                {"name": "id"},
                {"name": "checkout_token"},
                {"name": "created_by_user_id"},
                {"name": "item_count"},
                {"name": "total_quantity"},
            ],
            "receipts": [
                {"name": "id"},
                {"name": "receipt_status"},
                {"name": "print_attempts"},
                {"name": "last_print_error"},
                {"name": "printed_at", "nullable": True},
            ],
        }[table]
        inspector.get_foreign_keys.return_value = []

        with (
            patch("app.db.tenant_metadata.inspect", return_value=inspector),
            patch("app.db.tenant_metadata.create_tenant_tables"),
            patch("app.db.tenant_metadata._ensure_receipt_status_uses_public_enum") as ensure_type,
            patch("app.db.tenant_metadata._ensure_public_receipt_status_enum"),
            patch("app.db.tenant_metadata._ensure_public_billstatus_cancelled_enum"),
            patch("app.db.tenant_metadata._ensure_public_retailer_sale_status_cancelled_enum"),
        ):
            ensure_tenant_schema_column_patches(connection, "tenant_test")
            ensure_type.assert_called_once_with(connection, "tenant_test")

        alter_calls = [
            call
            for call in connection.execute.call_args_list
            if "ALTER TABLE" in getattr(call.args[0], "text", "")
        ]
        self.assertEqual(alter_calls, [])


class EnsureReceiptStatusUsesPublicEnumTests(unittest.TestCase):
    def test_drops_default_before_type_change(self) -> None:
        """Postgres cannot cast varchar defaults onto receiptstatus automatically."""
        connection = MagicMock()
        connection.dialect.name = "postgresql"
        row = {"type_schema": "tenant_demo_broliers", "type_name": "receiptstatus"}
        connection.execute.return_value.mappings.return_value.first.return_value = row

        with patch("app.db.tenant_metadata._ensure_public_receipt_status_enum") as ensure_enum:
            _ensure_receipt_status_uses_public_enum(connection, "tenant_demo_broliers")
            ensure_enum.assert_called_once_with(connection)

        executed_sql = [
            getattr(call.args[0], "text", str(call.args[0]))
            for call in connection.execute.call_args_list
        ]
        # First execute is the type lookup; remaining are DDL.
        ddl = " ".join(executed_sql[1:])
        self.assertIn("DROP DEFAULT", ddl)
        self.assertIn("TYPE public.receiptstatus", ddl)
        self.assertIn("USING receipt_status::text::public.receiptstatus", ddl)
        self.assertIn("SET DEFAULT 'pending'::public.receiptstatus", ddl)
        drop_idx = ddl.index("DROP DEFAULT")
        type_idx = ddl.index("TYPE public.receiptstatus")
        set_idx = ddl.index("SET DEFAULT")
        self.assertLess(drop_idx, type_idx)
        self.assertLess(type_idx, set_idx)

    def test_skips_when_already_public_receiptstatus(self) -> None:
        connection = MagicMock()
        connection.dialect.name = "postgresql"
        row = {"type_schema": "public", "type_name": "receiptstatus"}
        connection.execute.return_value.mappings.return_value.first.return_value = row

        with patch("app.db.tenant_metadata._ensure_public_receipt_status_enum") as ensure_enum:
            _ensure_receipt_status_uses_public_enum(connection, "tenant_demo_broliers")
            ensure_enum.assert_not_called()

        self.assertEqual(connection.execute.call_count, 1)


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
