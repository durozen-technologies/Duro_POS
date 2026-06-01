from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


MIGRATION_VERSION_LIMIT = 32
MIGRATION_VERSIONS_DIR = Path(__file__).resolve().parents[2] / "backend" / "migrations" / "versions"


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


if __name__ == "__main__":
    unittest.main()
