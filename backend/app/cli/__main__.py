"""Management CLI entrypoints."""

from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import select

from app.core.security import get_password_hash
from app.db.database import close_database_connections, get_session_local
from app.db.tenant_schema import set_search_path
from app.models import User, UserRole
from app.schemas.auth import normalize_username
from app.services.user_auth_index import username_is_globally_taken


async def bootstrap_super_admin(username: str, password: str) -> None:
    normalized = normalize_username(username)
    session_factory = get_session_local()
    async with session_factory() as db:
        await set_search_path(db, None)
        existing = await db.scalar(select(User.id).where(User.role == UserRole.SUPER_ADMIN))
        if existing is not None:
            raise SystemExit("A super admin already exists")

        conflict = await username_is_globally_taken(db, normalized)
        if conflict:
            raise SystemExit("Username already exists")

        user = User(
            username=normalized,
            password_hash=get_password_hash(password),
            role=UserRole.SUPER_ADMIN,
            organization_id=None,
            is_active=True,
        )
        db.add(user)
        await db.commit()
        print(f"Super admin created: {normalized}")


async def set_super_admin_password(username: str, password: str) -> None:
    normalized = normalize_username(username)
    session_factory = get_session_local()
    async with session_factory() as db:
        await set_search_path(db, None)
        user = await db.scalar(
            select(User).where(
                User.role == UserRole.SUPER_ADMIN,
                User.organization_id.is_(None),
                User.username == normalized,
            )
        )
        if user is None:
            raise SystemExit(f"Super admin not found: {normalized}")

        user.password_hash = get_password_hash(password)
        await db.commit()
        print(f"Super admin password updated: {normalized}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="app.cli")
    subparsers = parser.add_subparsers(dest="command", required=True)

    bootstrap = subparsers.add_parser("bootstrap-super-admin")
    bootstrap.add_argument("--username", required=True)
    bootstrap.add_argument("--password", required=True)

    set_password = subparsers.add_parser("set-super-admin-password")
    set_password.add_argument("--username", required=True)
    set_password.add_argument("--password", required=True)

    migrate = subparsers.add_parser("migrate-tenant-data")
    migrate.add_argument("--org-id", default=None)
    migrate.add_argument("--slug", default=None)
    migrate.add_argument("--all-legacy", action="store_true")
    migrate.add_argument("--dry-run", action="store_true")
    migrate.add_argument("--execute", action="store_true")
    migrate.add_argument("--cleanup-public-backups", action="store_true")

    args = parser.parse_args(argv)

    async def run() -> None:
        try:
            if args.command == "bootstrap-super-admin":
                await bootstrap_super_admin(args.username, args.password)
            elif args.command == "set-super-admin-password":
                await set_super_admin_password(args.username, args.password)
            elif args.command == "migrate-tenant-data":
                from app.cli.migrate_tenant_data import run_migrate_tenant_data

                migrate_argv = []
                if args.org_id:
                    migrate_argv.extend(["--org-id", args.org_id])
                if args.slug:
                    migrate_argv.extend(["--slug", args.slug])
                if args.all_legacy:
                    migrate_argv.append("--all-legacy")
                if args.dry_run:
                    migrate_argv.append("--dry-run")
                if args.execute:
                    migrate_argv.append("--execute")
                if getattr(args, "cleanup_public_backups", False):
                    migrate_argv.append("--cleanup-public-backups")
                await run_migrate_tenant_data(migrate_argv)
                return
        finally:
            await close_database_connections()

    asyncio.run(run())


if __name__ == "__main__":
    main(sys.argv[1:])
