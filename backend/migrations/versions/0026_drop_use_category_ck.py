"""drop hashed inventory use category check constraint

Revision ID: 0026_drop_use_category_ck
Revises: 0025_uncat_inventory_use
Create Date: 2026-06-09 00:00:01
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0026_drop_use_category_ck"
down_revision: str | None = "0025_uncat_inventory_use"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE_NAME = "inventory_movements"
CHECK_NAME = "ck_inventory_movements_use_category_required"
CHECK_SQL = "movement_type != 'USE' OR category_id IS NOT NULL"
CHECK_NAME_PREFIX = "ck_inventory_movements_ck_inventory_movements_use_categ"


def _table_names(bind) -> set[str]:
    return set(sa.inspect(bind).get_table_names())


def _check_constraints(bind, table_name: str) -> list[dict[str, object]]:
    if table_name not in _table_names(bind):
        return []
    return sa.inspect(bind).get_check_constraints(table_name)


def _check_names(bind, table_name: str) -> set[str]:
    return {
        constraint["name"]
        for constraint in _check_constraints(bind, table_name)
        if constraint.get("name")
    }


def _is_old_category_required_check(constraint: dict[str, object]) -> bool:
    name = str(constraint.get("name") or "")
    if name in {CHECK_NAME, f"ck_{TABLE_NAME}_{CHECK_NAME}"} or name.startswith(CHECK_NAME_PREFIX):
        return True

    sqltext = str(constraint.get("sqltext") or "").lower()
    compact_sql = "".join(sqltext.split())
    return (
        "movement_type" in compact_sql
        and "use" in compact_sql
        and "category_id" in compact_sql
        and "isnotnull" in compact_sql
    )


def _quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _drop_check_constraint(bind, constraint_name: str) -> None:
    if bind.dialect.name == "postgresql":
        bind.execute(
            sa.text(
                "ALTER TABLE "
                f"{_quote_identifier(TABLE_NAME)} "
                f"DROP CONSTRAINT IF EXISTS {_quote_identifier(constraint_name)}"
            )
        )
        return
    with op.batch_alter_table(TABLE_NAME) as batch_op:
        batch_op.drop_constraint(constraint_name, type_="check")


def upgrade() -> None:
    bind = op.get_bind()
    old_check_names = [
        constraint["name"]
        for constraint in _check_constraints(bind, TABLE_NAME)
        if constraint.get("name") and _is_old_category_required_check(constraint)
    ]
    if not old_check_names:
        return
    for check_name in old_check_names:
        _drop_check_constraint(bind, check_name)


def downgrade() -> None:
    bind = op.get_bind()
    if TABLE_NAME not in _table_names(bind) or CHECK_NAME in _check_names(bind, TABLE_NAME):
        return
    with op.batch_alter_table(TABLE_NAME) as batch_op:
        batch_op.create_check_constraint(CHECK_NAME, CHECK_SQL)
