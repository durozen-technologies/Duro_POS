"""Authentication and authorization utilities."""

from app.auth.dependencies import (
    get_current_active_user,
    get_current_shop,
    get_current_user,
    require_roles,
)
from app.auth.tenant_context import (
    TenantContext,
    get_super_admin_context,
    get_tenant_context,
    load_user_permissions,
    require_permission,
    session_role_for_user,
    user_has_permission,
)

__all__ = [
    "TenantContext",
    "get_current_active_user",
    "get_current_shop",
    "get_current_user",
    "get_super_admin_context",
    "get_tenant_context",
    "load_user_permissions",
    "require_permission",
    "require_roles",
    "session_role_for_user",
    "user_has_permission",
]
