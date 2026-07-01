"""CLI: migrate legacy public tenant data into per-org schemas."""

from __future__ import annotations

import argparse
import asyncio
import sys
from uuid import UUID

from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.db.database import close_database_connections
from app.db.tenant_schema import sync_postgres_database_url
from app.models import Organization
from app.services.tenant_data_migration import (
    cleanup_public_migrated_backups,
    format_report,
    migrate_organization_data,
)


def _sync_database_url() -> str:
    return sync_postgres_database_url(str(get_settings().database_url))


async def _load_orgs(
    *,
    org_id: UUID | None,
    slug: str | None,
    all_legacy: bool,
) -> list[Organization]:
    async_url = str(get_settings().database_url)
    if "postgresql" not in async_url:
        raise SystemExit("migrate-tenant-data requires PostgreSQL")

    async_engine = create_async_engine(async_url, future=True)
    session_factory = async_sessionmaker(async_engine, expire_on_commit=False)
    try:
        async with session_factory() as session:
            if org_id is not None:
                org = await session.get(Organization, org_id)
                if org is None:
                    raise SystemExit(f"Organization not found: {org_id}")
                return [org]
            if slug:
                org = await session.scalar(select(Organization).where(Organization.slug == slug))
                if org is None:
                    raise SystemExit(f"Organization not found for slug: {slug}")
                return [org]
            if all_legacy:
                return list(
                    await session.scalars(
                        select(Organization).where(Organization.schema_name.is_(None))
                    )
                )
            raise SystemExit("Specify --org-id, --slug, or --all-legacy")
    finally:
        await async_engine.dispose()


def migrate_tenant_data_main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="app.cli migrate-tenant-data")
    parser.add_argument("--org-id", type=UUID, default=None)
    parser.add_argument("--slug", default=None)
    parser.add_argument("--all-legacy", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument(
        "--cleanup-public-backups",
        action="store_true",
        help="Drop public._migrated_* backup tables after successful migration",
    )
    args = parser.parse_args(argv)

    if not args.dry_run and not args.execute:
        parser.error("Pass --dry-run and/or --execute")

    async def run() -> None:
        orgs = await _load_orgs(
            org_id=args.org_id,
            slug=args.slug,
            all_legacy=args.all_legacy,
        )
        engine = create_engine(_sync_database_url(), future=True)
        try:
            for org in orgs:
                report = migrate_organization_data(
                    engine,
                    org,
                    dry_run=args.dry_run and not args.execute,
                    execute=args.execute,
                )
                print(format_report(report))
                if args.execute and not report.ok:
                    raise SystemExit(1)
            if args.cleanup_public_backups and args.execute:
                dropped = cleanup_public_migrated_backups(engine)
                print(f"cleanup_public_backups: dropped {dropped} table(s)")
        finally:
            engine.dispose()

    asyncio.run(run())
    asyncio.run(close_database_connections())


if __name__ == "__main__":
    migrate_tenant_data_main(sys.argv[1:])
