#!/usr/bin/env python3
"""Verify tenant Alembic baseline matches SQLAlchemy tenant table names."""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.db.tenant_metadata import PLATFORM_TABLES, tenant_table_names  # noqa: E402
from app.db.tenant_schema import TENANT_MIGRATION_HEAD  # noqa: E402


def main() -> int:
    names = set(tenant_table_names())
    if not names:
        print("check_tenant_baseline: no tenant tables registered", file=sys.stderr)
        return 1
    if "alembic_version" in names:
        print(
            "check_tenant_baseline: alembic_version must not be in tenant_table_names",
            file=sys.stderr,
        )
        return 1
    if names & PLATFORM_TABLES:
        overlap = sorted(names & PLATFORM_TABLES)
        print(f"check_tenant_baseline: platform tables in tenant set: {overlap}", file=sys.stderr)
        return 1
    print(f"check_tenant_baseline: ok ({len(names)} tables, head={TENANT_MIGRATION_HEAD})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
