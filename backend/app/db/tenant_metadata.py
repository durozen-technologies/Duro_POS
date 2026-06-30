"""Tenant-only SQLAlchemy metadata (excludes platform control-plane tables)."""

from __future__ import annotations

from sqlalchemy.engine import Connection

# Tables that live only in public; never created inside a tenant schema.
PLATFORM_TABLES = frozenset(
    {
        "organizations",
        "permissions",
        "user_auth_index",
    }
)


def tenant_table_names() -> tuple[str, ...]:
    from app import models as _models  # noqa: F401
    from app.db.database import Base

    return tuple(
        table.name for table in Base.metadata.sorted_tables if table.name not in PLATFORM_TABLES
    )


def create_tenant_tables(connection: Connection) -> None:
    """Create all tenant tables in the current search_path (tenant schema + public)."""
    from app import models as _models  # noqa: F401
    from app.db.database import Base

    for table in Base.metadata.sorted_tables:
        if table.name in PLATFORM_TABLES:
            continue
        table.create(connection, checkfirst=True)


def drop_tenant_tables(connection: Connection) -> None:
    from app import models as _models  # noqa: F401
    from app.db.database import Base

    for table in reversed(Base.metadata.sorted_tables):
        if table.name in PLATFORM_TABLES:
            continue
        table.drop(connection, checkfirst=True)
