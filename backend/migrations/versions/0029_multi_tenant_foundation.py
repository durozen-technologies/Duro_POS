"""multi-tenant foundation: organizations, RBAC, org scoping

Revision ID: 0029_multi_tenant_foundation
Revises: 0028_user_last_login
Create Date: 2026-06-30 00:00:00
"""

from __future__ import annotations

from collections.abc import Sequence
from uuid import UUID

from app.core.ids import uuid7

import sqlalchemy as sa
from alembic import op

revision: str = "0029_multi_tenant_foundation"
down_revision: str | None = "0028b_userrole_enum_values"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DEFAULT_ORG_ID = UUID("01900000-0000-7000-8000-000000000001")

PERMISSIONS = [
    ("organizations.read", "View organizations", "organizations"),
    ("organizations.manage", "Manage organizations", "organizations"),
    ("tenant_admins.read", "View tenant admins", "tenant_admins"),
    ("tenant_admins.manage", "Create and update tenant admins", "tenant_admins"),
    ("tenant_admins.disable", "Enable or disable tenant admins", "tenant_admins"),
    ("shops.read", "View shops", "shops"),
    ("shops.manage", "Manage shops", "shops"),
    ("catalogue.manage", "Manage catalogue items", "catalogue"),
    ("inventory.manage", "Manage inventory", "inventory"),
    ("pricing.manage", "Manage daily prices", "pricing"),
    ("billing.read", "View bills and payments", "billing"),
    ("reports.export", "Export reports", "reports"),
    ("expenses.manage", "Manage expenses", "expenses"),
    ("transfers.manage", "Manage inventory transfers", "transfers"),
]

TENANT_FULL_PERMISSIONS = [
    code for code, _, _ in PERMISSIONS if not code.startswith("organizations")
]


def _table_names(bind) -> set[str]:
    return set(sa.inspect(bind).get_table_names())


def _column_names(bind, table_name: str) -> set[str]:
    if table_name not in _table_names(bind):
        return set()
    return {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def _legacy_default_org_id(bind) -> UUID | None:
    """Seed default org only when upgrading legacy single-tenant rows."""
    existing = bind.execute(
        sa.text("SELECT id FROM organizations WHERE slug = 'default' LIMIT 1")
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    orphan_shops = 0
    if "shops" in _table_names(bind):
        orphan_shops = bind.execute(
            sa.text("SELECT COUNT(*) FROM shops WHERE organization_id IS NULL")
        ).scalar_one()

    orphan_admins = 0
    if "users" in _table_names(bind):
        if bind.dialect.name == "postgresql":
            orphan_admins = bind.execute(
                sa.text(
                    "SELECT COUNT(*) FROM users "
                    "WHERE organization_id IS NULL AND role = 'ADMIN'"
                )
            ).scalar_one()
        else:
            orphan_admins = bind.execute(
                sa.text(
                    "SELECT COUNT(*) FROM users "
                    "WHERE organization_id IS NULL AND role IN ('ADMIN', 'admin')"
                )
            ).scalar_one()

    if orphan_shops == 0 and orphan_admins == 0:
        return None

    bind.execute(
        sa.text(
            "INSERT INTO organizations (id, name, slug, is_active, settings, created_at, updated_at) "
            "VALUES (:id, :name, :slug, true, '{}', NOW(), NOW())"
        ),
        {"id": DEFAULT_ORG_ID, "name": "Brolier 360 Default", "slug": "default"},
    )
    return DEFAULT_ORG_ID


def upgrade() -> None:
    bind = op.get_bind()

    if "organizations" not in _table_names(bind):
        op.create_table(
            "organizations",
            sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("slug", sa.String(length=80), nullable=False),
            sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            sa.Column("settings", sa.JSON(), server_default=sa.text("'{}'"), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.UniqueConstraint("slug", name=op.f("uq_organizations_slug")),
        )
        op.create_index(op.f("ix_organizations_id"), "organizations", ["id"], unique=False)
        op.create_index(
            op.f("ix_organizations_created_at"), "organizations", ["created_at"], unique=False
        )

    if "permissions" not in _table_names(bind):
        op.create_table(
            "permissions",
            sa.Column("code", sa.String(length=80), primary_key=True, nullable=False),
            sa.Column("description", sa.String(length=255), nullable=False),
            sa.Column("module", sa.String(length=40), nullable=False),
        )

    if "admin_roles" not in _table_names(bind):
        op.create_table(
            "admin_roles",
            sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("organization_id", sa.Uuid(as_uuid=True), nullable=True),
            sa.Column("name", sa.String(length=80), nullable=False),
            sa.Column("is_system", sa.Boolean(), server_default=sa.text("false"), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(
                ["organization_id"],
                ["organizations.id"],
                name=op.f("fk_admin_roles_organization_id_organizations"),
                ondelete="CASCADE",
            ),
        )
        op.create_index(op.f("ix_admin_roles_id"), "admin_roles", ["id"], unique=False)
        op.create_index(
            op.f("ix_admin_roles_organization_id"), "admin_roles", ["organization_id"], unique=False
        )
        op.create_index(
            op.f("ix_admin_roles_created_at"), "admin_roles", ["created_at"], unique=False
        )

    if "admin_role_permissions" not in _table_names(bind):
        op.create_table(
            "admin_role_permissions",
            sa.Column("role_id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("permission_code", sa.String(length=80), primary_key=True, nullable=False),
            sa.ForeignKeyConstraint(
                ["permission_code"],
                ["permissions.code"],
                name=op.f("fk_admin_role_permissions_permission_code_permissions"),
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["role_id"],
                ["admin_roles.id"],
                name=op.f("fk_admin_role_permissions_role_id_admin_roles"),
                ondelete="CASCADE",
            ),
        )

    if "admin_user_roles" not in _table_names(bind):
        op.create_table(
            "admin_user_roles",
            sa.Column("user_id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("role_id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
            sa.ForeignKeyConstraint(
                ["role_id"],
                ["admin_roles.id"],
                name=op.f("fk_admin_user_roles_role_id_admin_roles"),
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["user_id"],
                ["users.id"],
                name=op.f("fk_admin_user_roles_user_id_users"),
                ondelete="CASCADE",
            ),
        )

    if "organization_id" not in _column_names(bind, "users"):
        op.add_column("users", sa.Column("organization_id", sa.Uuid(as_uuid=True), nullable=True))
        op.create_foreign_key(
            op.f("fk_users_organization_id_organizations"),
            "users",
            "organizations",
            ["organization_id"],
            ["id"],
            ondelete="SET NULL",
        )
        op.create_index(
            op.f("ix_users_organization_id"), "users", ["organization_id"], unique=False
        )

    if "permissions_version" not in _column_names(bind, "users"):
        op.add_column(
            "users",
            sa.Column(
                "permissions_version",
                sa.Integer(),
                server_default=sa.text("0"),
                nullable=False,
            ),
        )

    if "organization_id" not in _column_names(bind, "shops"):
        op.add_column("shops", sa.Column("organization_id", sa.Uuid(as_uuid=True), nullable=True))
        op.create_foreign_key(
            op.f("fk_shops_organization_id_organizations"),
            "shops",
            "organizations",
            ["organization_id"],
            ["id"],
            ondelete="RESTRICT",
        )
        op.create_index(
            op.f("ix_shops_organization_id"), "shops", ["organization_id"], unique=False
        )

    if "organization_id" not in _column_names(bind, "audit_logs"):
        op.add_column(
            "audit_logs", sa.Column("organization_id", sa.Uuid(as_uuid=True), nullable=True)
        )
        op.create_foreign_key(
            op.f("fk_audit_logs_organization_id_organizations"),
            "audit_logs",
            "organizations",
            ["organization_id"],
            ["id"],
            ondelete="SET NULL",
        )
        op.create_index(
            op.f("ix_audit_logs_organization_id"), "audit_logs", ["organization_id"], unique=False
        )

    default_org_id = _legacy_default_org_id(bind)

    if default_org_id is not None:
        bind.execute(
            sa.text("UPDATE shops SET organization_id = :org_id WHERE organization_id IS NULL"),
            {"org_id": default_org_id},
        )
        bind.execute(
            sa.text(
                "UPDATE users SET organization_id = :org_id "
                "WHERE organization_id IS NULL AND role = 'ADMIN'"
            ),
            {"org_id": default_org_id},
        )

    if "shops" in _table_names(bind) and bind.dialect.name == "postgresql":
        op.alter_column("shops", "organization_id", nullable=False)

    # Drop legacy global username unique if present (postgres)
    if bind.dialect.name == "postgresql":
        op.execute(sa.text("DROP INDEX IF EXISTS ix_users_username"))
        op.execute(sa.text("ALTER TABLE users DROP CONSTRAINT IF EXISTS uq_users_username"))

    op.create_index(
        "ix_users_org_role_active",
        "users",
        ["organization_id", "role", "is_active"],
        unique=False,
        if_not_exists=True,
    )
    op.create_index(
        "ix_shops_org_active",
        "shops",
        ["organization_id", "is_active"],
        unique=False,
        if_not_exists=True,
    )

    if bind.dialect.name == "postgresql":
        bind.execute(sa.text("UPDATE users SET role = 'TENANT_ADMIN' WHERE role = 'ADMIN'"))
    else:
        bind.execute(
            sa.text("UPDATE users SET role = 'TENANT_ADMIN' WHERE role IN ('ADMIN', 'admin')")
        )

    # Seed permissions
    for code, description, module in PERMISSIONS:
        bind.execute(
            sa.text(
                "INSERT INTO permissions (code, description, module) "
                "VALUES (:code, :description, :module) "
                "ON CONFLICT (code) DO NOTHING"
            ),
            {"code": code, "description": description, "module": module},
        )

    # Seed tenant full admin role for default org (legacy upgrade path only)
    if default_org_id is not None:
        role_id = bind.execute(
            sa.text(
                "SELECT id FROM admin_roles WHERE organization_id = :org_id AND name = 'TenantFullAdmin'"
            ),
            {"org_id": default_org_id},
        ).scalar_one_or_none()
        if role_id is None:
            role_id = uuid7()
            bind.execute(
                sa.text(
                    "INSERT INTO admin_roles (id, organization_id, name, is_system, created_at) "
                    "VALUES (:id, :org_id, 'TenantFullAdmin', true, NOW())"
                ),
                {"id": role_id, "org_id": default_org_id},
            )
            for code in TENANT_FULL_PERMISSIONS:
                bind.execute(
                    sa.text(
                        "INSERT INTO admin_role_permissions (role_id, permission_code) "
                        "VALUES (:role_id, :code) ON CONFLICT DO NOTHING"
                    ),
                    {"role_id": role_id, "code": code},
                )

        # Assign existing tenant admins to TenantFullAdmin role
        tenant_admin_roles = (
            "u.role = 'TENANT_ADMIN'"
            if bind.dialect.name == "postgresql"
            else "u.role IN ('TENANT_ADMIN', 'tenant_admin', 'ADMIN', 'admin')"
        )
        bind.execute(
            sa.text(
                "INSERT INTO admin_user_roles (user_id, role_id) "
                f"SELECT u.id, :role_id FROM users u "
                f"WHERE {tenant_admin_roles} "
                "AND NOT EXISTS (SELECT 1 FROM admin_user_roles aur WHERE aur.user_id = u.id)"
            ),
            {"role_id": role_id},
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(sa.text("UPDATE users SET role = 'ADMIN' WHERE role = 'TENANT_ADMIN'"))

    for table in ("admin_user_roles", "admin_role_permissions", "admin_roles", "permissions"):
        if table in _table_names(bind):
            op.drop_table(table)

    if "organization_id" in _column_names(bind, "audit_logs"):
        op.drop_constraint(
            op.f("fk_audit_logs_organization_id_organizations"),
            "audit_logs",
            type_="foreignkey",
        )
        op.drop_index(op.f("ix_audit_logs_organization_id"), table_name="audit_logs")
        op.drop_column("audit_logs", "organization_id")

    if "organization_id" in _column_names(bind, "shops"):
        op.drop_constraint(
            op.f("fk_shops_organization_id_organizations"), "shops", type_="foreignkey"
        )
        op.drop_index(op.f("ix_shops_organization_id"), table_name="shops")
        op.drop_column("shops", "organization_id")

    if "permissions_version" in _column_names(bind, "users"):
        op.drop_column("users", "permissions_version")

    if "organization_id" in _column_names(bind, "users"):
        op.drop_constraint(
            op.f("fk_users_organization_id_organizations"), "users", type_="foreignkey"
        )
        op.drop_index(op.f("ix_users_organization_id"), table_name="users")
        op.drop_column("users", "organization_id")

    op.drop_index("ix_shops_org_active", table_name="shops", if_exists=True)
    op.drop_index("ix_users_org_role_active", table_name="users", if_exists=True)

    if "organizations" in _table_names(bind):
        op.drop_table("organizations")
