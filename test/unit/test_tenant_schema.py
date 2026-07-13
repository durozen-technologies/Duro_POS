from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from app.db.tenant_schema import (  # noqa: E402
    TENANT_MIGRATION_HEAD,
    ensure_tenant_schema_drift_repaired,
    repair_tenant_schema_ddl,
)


class TenantSchemaRepairTests(unittest.TestCase):
    @patch("app.db.tenant_schema.run_tenant_migrations")
    @patch("app.db.tenant_schema._finalize_tenant_schema")
    @patch("app.db.tenant_schema._read_tenant_alembic_revision")
    @patch("app.db.tenant_schema._tenant_schema_exists")
    @patch("sqlalchemy.create_engine")
    def test_repair_skips_alembic_when_at_head(
        self,
        create_engine_mock: MagicMock,
        schema_exists_mock: MagicMock,
        read_revision_mock: MagicMock,
        finalize_mock: MagicMock,
        run_migrations_mock: MagicMock,
    ) -> None:
        schema_exists_mock.return_value = True
        read_revision_mock.return_value = TENANT_MIGRATION_HEAD

        connection = MagicMock()
        begin_ctx = MagicMock()
        begin_ctx.__enter__.return_value = connection
        begin_ctx.__exit__.return_value = False
        engine = MagicMock()
        connect_ctx = MagicMock()
        connect_ctx.__enter__.return_value = connection
        connect_ctx.__exit__.return_value = False
        engine.connect.return_value = connect_ctx
        engine.begin.return_value = begin_ctx
        create_engine_mock.return_value = engine

        changed = repair_tenant_schema_ddl("tenant_demo", quiet=True)

        self.assertFalse(changed)
        run_migrations_mock.assert_not_called()
        finalize_mock.assert_called_once()

    @patch("app.db.tenant_schema.run_tenant_migrations")
    @patch("app.db.tenant_schema._provision_fresh_tenant_schema")
    @patch("app.db.tenant_schema._read_tenant_alembic_revision")
    @patch("app.db.tenant_schema._tenant_schema_exists")
    @patch("sqlalchemy.create_engine")
    def test_repair_provisions_fresh_schema_without_alembic(
        self,
        create_engine_mock: MagicMock,
        schema_exists_mock: MagicMock,
        read_revision_mock: MagicMock,
        provision_mock: MagicMock,
        run_migrations_mock: MagicMock,
    ) -> None:
        schema_exists_mock.return_value = False
        read_revision_mock.return_value = None

        connection = MagicMock()
        begin_ctx = MagicMock()
        begin_ctx.__enter__.return_value = connection
        begin_ctx.__exit__.return_value = False
        engine = MagicMock()
        connect_ctx = MagicMock()
        connect_ctx.__enter__.return_value = connection
        connect_ctx.__exit__.return_value = False
        engine.connect.return_value = connect_ctx
        engine.begin.return_value = begin_ctx
        create_engine_mock.return_value = engine

        changed = repair_tenant_schema_ddl("tenant_new_shop", quiet=True)

        self.assertTrue(changed)
        provision_mock.assert_called_once_with(connection, "tenant_new_shop")
        run_migrations_mock.assert_not_called()

    @patch("app.db.tenant_schema.run_tenant_migrations")
    @patch("app.db.tenant_schema._sync_tenant_schema_to_head")
    @patch("app.db.tenant_schema._tenant_schema_ddl_is_complete")
    @patch("app.db.tenant_schema._read_tenant_alembic_revision")
    @patch("app.db.tenant_schema._tenant_schema_exists")
    @patch("sqlalchemy.create_engine")
    def test_repair_stamps_complete_schema_without_alembic(
        self,
        create_engine_mock: MagicMock,
        schema_exists_mock: MagicMock,
        read_revision_mock: MagicMock,
        ddl_complete_mock: MagicMock,
        sync_head_mock: MagicMock,
        run_migrations_mock: MagicMock,
    ) -> None:
        schema_exists_mock.return_value = True
        read_revision_mock.return_value = None
        ddl_complete_mock.return_value = True

        connection = MagicMock()
        begin_ctx = MagicMock()
        begin_ctx.__enter__.return_value = connection
        begin_ctx.__exit__.return_value = False
        engine = MagicMock()
        connect_ctx = MagicMock()
        connect_ctx.__enter__.return_value = connection
        connect_ctx.__exit__.return_value = False
        engine.connect.return_value = connect_ctx
        engine.begin.return_value = begin_ctx
        create_engine_mock.return_value = engine

        changed = repair_tenant_schema_ddl("tenant_abc", quiet=True)

        self.assertTrue(changed)
        sync_head_mock.assert_called_once_with(connection, "tenant_abc")
        run_migrations_mock.assert_not_called()

    @patch("app.db.tenant_schema.repair_tenant_schema_ddl")
    @patch("app.db.tenant_schema._tenant_schema_ddl_is_complete")
    @patch("app.db.tenant_schema._read_tenant_alembic_revision")
    @patch("app.db.tenant_schema._tenant_schema_exists")
    @patch("app.db.tenant_schema.is_postgres_database", return_value=True)
    @patch("sqlalchemy.create_engine")
    def test_drift_repair_skips_uncommitted_fresh_schema(
        self,
        create_engine_mock: MagicMock,
        _is_postgres_mock: MagicMock,
        schema_exists_mock: MagicMock,
        read_revision_mock: MagicMock,
        ddl_complete_mock: MagicMock,
        repair_mock: MagicMock,
    ) -> None:
        schema_exists_mock.return_value = False

        connection = MagicMock()
        engine = MagicMock()
        connect_ctx = MagicMock()
        connect_ctx.__enter__.return_value = connection
        connect_ctx.__exit__.return_value = False
        engine.connect.return_value = connect_ctx
        create_engine_mock.return_value = engine

        ensure_tenant_schema_drift_repaired("tenant_new_org")

        repair_mock.assert_not_called()

    @patch("app.db.tenant_schema.repair_tenant_schema_ddl")
    @patch("app.db.tenant_schema._tenant_schema_ddl_is_complete", return_value=False)
    @patch("app.db.tenant_schema._read_tenant_alembic_revision", return_value=None)
    @patch("app.db.tenant_schema._tenant_schema_exists", return_value=True)
    @patch("app.db.tenant_schema.is_postgres_database", return_value=True)
    @patch("sqlalchemy.create_engine")
    def test_drift_repair_skips_empty_schema_mid_provision(
        self,
        create_engine_mock: MagicMock,
        _is_postgres_mock: MagicMock,
        _schema_exists_mock: MagicMock,
        _read_revision_mock: MagicMock,
        _ddl_complete_mock: MagicMock,
        repair_mock: MagicMock,
    ) -> None:
        connection = MagicMock()
        engine = MagicMock()
        connect_ctx = MagicMock()
        connect_ctx.__enter__.return_value = connection
        connect_ctx.__exit__.return_value = False
        engine.connect.return_value = connect_ctx
        create_engine_mock.return_value = engine

        ensure_tenant_schema_drift_repaired("tenant_new_org")

        repair_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
