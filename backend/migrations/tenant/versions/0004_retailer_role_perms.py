"""Grant retailer RBAC codes to TenantFullAdmin inside tenant schema."""

from __future__ import annotations

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_retailer_role_perms"
down_revision: str | None = "0003_retailer_wholesale_sales"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

RETAILER_PERMISSIONS = ("retailers.read", "retailers.manage")


def _target_schema() -> str:
    schema = os.environ.get("TARGET_SCHEMA", "").strip()
    if not schema:
        raise RuntimeError("TARGET_SCHEMA environment variable is required for tenant migrations")
    return schema


def _set_search_path(bind, schema: str) -> None:
    from app.db.tenant_schema import assert_safe_schema_name

    safe = assert_safe_schema_name(schema)
    bind.execute(sa.text(f'SET search_path TO "{safe}", public'))


def _grant_to_tenant_full_admin_roles(bind, codes: Sequence[str]) -> None:
    inspector = sa.inspect(bind)
    if not inspector.has_table("admin_role_permissions"):
        return
    for code in codes:
        bind.execute(
            sa.text(
                """
                INSERT INTO admin_role_permissions (role_id, permission_code)
                SELECT r.id, :code
                FROM admin_roles r
                WHERE r.is_system = TRUE AND r.name = 'TenantFullAdmin'
                ON CONFLICT DO NOTHING
                """
            ),
            {"code": code},
        )


def _bump_tenant_admin_permission_versions(bind) -> None:
    if not sa.inspect(bind).has_table("users"):
        return
    if bind.dialect.name == "postgresql":
        bind.execute(
            sa.text(
                "UPDATE users SET permissions_version = permissions_version + 1 "
                "WHERE role = 'TENANT_ADMIN'"
            )
        )
        return
    bind.execute(
        sa.text(
            "UPDATE users SET permissions_version = permissions_version + 1 "
            "WHERE role IN ('TENANT_ADMIN', 'tenant_admin', 'ADMIN', 'admin')"
        )
    )


def upgrade() -> None:
    bind = op.get_bind()
    _set_search_path(bind, _target_schema())
    _grant_to_tenant_full_admin_roles(bind, RETAILER_PERMISSIONS)
    _bump_tenant_admin_permission_versions(bind)


def downgrade() -> None:
    bind = op.get_bind()
    _set_search_path(bind, _target_schema())
    if not sa.inspect(bind).has_table("admin_role_permissions"):
        return
    for code in RETAILER_PERMISSIONS:
        bind.execute(
            sa.text(
                """
                DELETE FROM admin_role_permissions
                WHERE permission_code = :code
                  AND role_id IN (
                    SELECT id FROM admin_roles
                    WHERE is_system = TRUE AND name = 'TenantFullAdmin'
                  )
                """
            ),
            {"code": code},
        )
    _bump_tenant_admin_permission_versions(bind)
