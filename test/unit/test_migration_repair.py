"""Self-check for alembic_version repair heuristics."""

from __future__ import annotations

from unittest.mock import MagicMock

from alembic.config import Config
from alembic.script import ScriptDirectory

from app.db.migration_repair import _is_ancestor, _pick_consolidated_revision


def test_pick_consolidated_prefers_schema_match() -> None:
    picked = _pick_consolidated_revision(
        ["0016_inventory_item_perf", "0030_master_data_org_scope"],
        "0030_master_data_org_scope",
        "0030_master_data_org_scope",
    )
    assert picked == "0030_master_data_org_scope"


def test_is_ancestor_on_linear_chain() -> None:
    cfg = Config()
    cfg.set_main_option("script_location", "migrations")
    script = ScriptDirectory.from_config(cfg)
    assert _is_ancestor(script, "b4c5d6e7f8a9", "0029_multi_tenant_foundation")
    assert not _is_ancestor(script, "0029_multi_tenant_foundation", "b4c5d6e7f8a9")


def test_schema_revision_detects_0030() -> None:
    from app.db.migration_repair import _schema_revision

    inspector = MagicMock()
    inspector.get_table_names.return_value = ["organizations", "items"]
    inspector.get_columns.return_value = [{"name": "organization_id"}]
    assert _schema_revision(inspector) == "0030_master_data_org_scope"

    inspector.get_columns.return_value = [{"name": "id"}]
    assert _schema_revision(inspector) == "0029_multi_tenant_foundation"
