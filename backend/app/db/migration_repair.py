"""Repair alembic_version when schema and revision history diverge."""

from __future__ import annotations

import asyncio
import logging

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import get_settings

logger = logging.getLogger(__name__)

REVISION_0029 = "0029_multi_tenant_foundation"
REVISION_0030 = "0030_master_data_org_scope"


def _schema_revision(inspector) -> str | None:
    tables = set(inspector.get_table_names())
    if "organizations" not in tables:
        return None
    if "items" in tables:
        cols = {column["name"] for column in inspector.get_columns("items")}
        if "organization_id" in cols:
            return REVISION_0030
    return REVISION_0029


def _is_ancestor(script: ScriptDirectory, ancestor: str, revision: str) -> bool:
    if ancestor == revision:
        return True
    current = script.get_revision(revision)
    while current is not None:
        if current.revision == ancestor:
            return True
        down = current.down_revision
        if down is None:
            break
        if not isinstance(down, str):
            return False
        current = script.get_revision(down)
    return False


def _pick_consolidated_revision(
    versions: list[str],
    schema_target: str | None,
    head: str | None,
) -> str:
    if schema_target and schema_target in versions:
        return schema_target
    if head and head in versions:
        return head
    if schema_target:
        return schema_target
    if head:
        return head
    return versions[0]


def _repair_on_connection(connection, script: ScriptDirectory, head: str | None) -> bool:
    inspector = inspect(connection)
    if "alembic_version" not in inspector.get_table_names():
        # Fresh database — Alembic creates this table on first upgrade.
        return False

    versions = [
        row[0]
        for row in connection.execute(text("SELECT version_num FROM alembic_version")).fetchall()
    ]
    schema_target = _schema_revision(inspector)

    if len(versions) > 1:
        target = _pick_consolidated_revision(versions, schema_target, head)
        connection.execute(text("DELETE FROM alembic_version"))
        connection.execute(
            text("INSERT INTO alembic_version (version_num) VALUES (:version)"),
            {"version": target},
        )
        logger.warning(
            "Repaired %d alembic_version rows -> %s",
            len(versions),
            target,
        )
        return True

    if not versions:
        if schema_target:
            connection.execute(
                text("INSERT INTO alembic_version (version_num) VALUES (:version)"),
                {"version": schema_target},
            )
            logger.warning("Created missing alembic_version row at %s", schema_target)
            return True
        return False

    recorded = versions[0]
    if (
        schema_target
        and recorded != schema_target
        and _is_ancestor(script, recorded, schema_target)
    ):
        connection.execute(
            text("UPDATE alembic_version SET version_num = :target WHERE version_num = :recorded"),
            {"target": schema_target, "recorded": recorded},
        )
        logger.warning(
            "Stamped alembic_version forward %s -> %s (schema already migrated)",
            recorded,
            schema_target,
        )
        return True

    return False


async def _repair_async(alembic_config: Config) -> bool:
    script = ScriptDirectory.from_config(alembic_config)
    head = script.get_current_head()
    engine = create_async_engine(str(get_settings().database_url), poolclass=NullPool)
    try:
        async with engine.begin() as connection:
            return await connection.run_sync(
                lambda sync_conn: _repair_on_connection(sync_conn, script, head)
            )
    finally:
        await engine.dispose()


def repair_alembic_version(alembic_config: Config) -> bool:
    """Normalize alembic_version before upgrade. Returns True if repair ran."""
    return asyncio.run(_repair_async(alembic_config))
