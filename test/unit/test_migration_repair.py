"""Self-check for alembic_version repair heuristics."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from alembic.config import Config
from alembic.script import ScriptDirectory

from app.db.migration_repair import (
    REVISION_0040,
    _is_ancestor,
    _pick_consolidated_revision,
    _public_post_cutover_revision,
    _repair_on_connection,
    _revision_exists,
)


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


def test_public_post_cutover_revision_reads_enums() -> None:
    connection = MagicMock()
    connection.dialect.name = "postgresql"
    connection.execute.return_value.fetchall.return_value = [("retailerreceipttype",)]
    assert _public_post_cutover_revision(connection) == REVISION_0040


def test_revision_exists_on_known_revision() -> None:
    cfg = Config()
    cfg.set_main_option("script_location", "migrations")
    script = ScriptDirectory.from_config(cfg)
    assert _revision_exists(script, REVISION_0040)
    assert not _revision_exists(script, "8eda37ee166b")


def test_repair_unknown_revision_stamps_schema_target() -> None:
    cfg = Config()
    cfg.set_main_option("script_location", "migrations")
    script = ScriptDirectory.from_config(cfg)
    connection = MagicMock()
    inspector = MagicMock()
    inspector.get_table_names.return_value = [
        "organizations",
        "permissions",
        "user_auth_index",
        "users",
        "audit_logs",
        "alembic_version",
    ]
    inspector.get_columns.return_value = [
        {"name": "schema_name", "nullable": False},
    ]
    connection.dialect.name = "postgresql"
    enum_result = MagicMock()
    enum_result.fetchall.return_value = [("retailerreceipttype",)]
    version_result = MagicMock()
    version_result.fetchall.return_value = [("8eda37ee166b",)]
    connection.execute.side_effect = [version_result, enum_result, MagicMock()]

    with patch("app.db.migration_repair.inspect", return_value=inspector):
        repaired = _repair_on_connection(connection, script, REVISION_0040)

    assert repaired is True
    update_call = connection.execute.call_args_list[-1]
    assert update_call.args[1] == {
        "target": REVISION_0040,
        "recorded": "8eda37ee166b",
    }
