#!/usr/bin/env python3
"""Verify public schema contains only super-admin control-plane tables and rows."""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.exc import OperationalError  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.db.tenant_metadata import PUBLIC_SCHEMA_TABLES, verify_public_schema_clean  # noqa: E402
from app.db.tenant_schema import is_postgres_database, sync_postgres_database_url  # noqa: E402


def main() -> int:
    if not is_postgres_database():
        print("check_public_schema: skipped (not PostgreSQL)")
        return 0

    url = sync_postgres_database_url(str(get_settings().database_url))
    engine = create_engine(url, future=True)
    try:
        with engine.connect() as conn:
            verify_public_schema_clean(conn)
    except OperationalError as exc:
        print(f"check_public_schema: skipped (database unavailable: {exc})")
        return 0
    except RuntimeError as exc:
        print(f"check_public_schema: FAIL — {exc}", file=sys.stderr)
        return 1
    finally:
        engine.dispose()

    print(f"check_public_schema: ok ({len(PUBLIC_SCHEMA_TABLES)} allowed tables)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
