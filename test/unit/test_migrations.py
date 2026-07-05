from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

MIGRATION_VERSION_LIMIT = 32
MIGRATION_VERSIONS_DIR = Path(__file__).resolve().parents[2] / "backend" / "migrations" / "versions"
TENANT_MIGRATION_VERSIONS_DIR = (
    Path(__file__).resolve().parents[2] / "backend" / "migrations" / "tenant" / "versions"
)


def _load_migration_module(path: Path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    if spec is None or spec.loader is None:
        raise AssertionError(f"Unable to load migration module {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MigrationTests(unittest.TestCase):
    def test_revision_ids_fit_default_alembic_version_column(self) -> None:
        for path in sorted(MIGRATION_VERSIONS_DIR.glob("*.py")):
            module = _load_migration_module(path)
            revision = getattr(module, "revision", "")
            self.assertLessEqual(
                len(revision),
                MIGRATION_VERSION_LIMIT,
                f"{path.name} revision id is too long for alembic_version.version_num",
            )

    def test_tenant_table_names_exclude_platform_tables(self) -> None:
        sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
        from app.db.tenant_metadata import PLATFORM_TABLES, tenant_table_names

        names = set(tenant_table_names())
        self.assertTrue(names)
        self.assertFalse(names & PLATFORM_TABLES)
        self.assertIn("shops", names)
        self.assertIn("users", names)

    def test_0007_drops_legacy_unique_before_branch_copy_insert(self) -> None:
        source = (TENANT_MIGRATION_VERSIONS_DIR / "0007_retailer_branch_prices.py").read_text()
        drop_idx = source.index('op.drop_constraint("uq_retailer_item_prices"')
        insert_idx = source.index("INSERT INTO retailer_item_prices")
        delete_legacy_idx = source.index("DELETE FROM retailer_item_prices legacy")
        self.assertLess(drop_idx, insert_idx)
        self.assertLess(insert_idx, delete_legacy_idx)


if __name__ == "__main__":
    unittest.main()
