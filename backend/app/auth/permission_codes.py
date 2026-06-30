"""Permission codes for tenant RBAC."""

from __future__ import annotations

ORGANIZATIONS_READ = "organizations.read"
ORGANIZATIONS_MANAGE = "organizations.manage"
TENANT_ADMINS_READ = "tenant_admins.read"
TENANT_ADMINS_MANAGE = "tenant_admins.manage"
TENANT_ADMINS_DISABLE = "tenant_admins.disable"
SHOPS_READ = "shops.read"
SHOPS_MANAGE = "shops.manage"
CATALOGUE_MANAGE = "catalogue.manage"
INVENTORY_MANAGE = "inventory.manage"
PRICING_MANAGE = "pricing.manage"
BILLING_READ = "billing.read"
REPORTS_EXPORT = "reports.export"
EXPENSES_MANAGE = "expenses.manage"
TRANSFERS_MANAGE = "transfers.manage"

ALL_PERMISSION_CODES: frozenset[str] = frozenset(
    [
        ORGANIZATIONS_READ,
        ORGANIZATIONS_MANAGE,
        TENANT_ADMINS_READ,
        TENANT_ADMINS_MANAGE,
        TENANT_ADMINS_DISABLE,
        SHOPS_READ,
        SHOPS_MANAGE,
        CATALOGUE_MANAGE,
        INVENTORY_MANAGE,
        PRICING_MANAGE,
        BILLING_READ,
        REPORTS_EXPORT,
        EXPENSES_MANAGE,
        TRANSFERS_MANAGE,
    ]
)

TENANT_FULL_ADMIN_PERMISSIONS: frozenset[str] = frozenset(
    code for code in ALL_PERMISSION_CODES if not code.startswith("organizations")
)
