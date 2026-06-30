"""Management CLI entrypoints."""

from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import func, select

from app.core.security import get_password_hash
from app.db.database import close_database_connections, get_session_local
from app.models import User, UserRole
from app.schemas.auth import normalize_username


async def bootstrap_super_admin(username: str, password: str) -> None:
    normalized = normalize_username(username)
    session_factory = get_session_local()
    async with session_factory() as db:
        existing = await db.scalar(
            select(User.id).where(User.role == UserRole.SUPER_ADMIN)
        )
        if existing is not None:
            raise SystemExit("A super admin already exists")

        conflict = await db.scalar(
            select(User.id).where(
                func.lower(User.username) == normalized,
                User.organization_id.is_(None),
            )
        )
        if conflict is not None:
            raise SystemExit("Username already exists for a platform account")

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


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="app.cli")
    subparsers = parser.add_subparsers(dest="command", required=True)

    bootstrap = subparsers.add_parser("bootstrap-super-admin")
    bootstrap.add_argument("--username", required=True)
    bootstrap.add_argument("--password", required=True)

    args = parser.parse_args(argv)

    async def run() -> None:
        try:
            if args.command == "bootstrap-super-admin":
                await bootstrap_super_admin(args.username, args.password)
        finally:
            await close_database_connections()

    asyncio.run(run())


if __name__ == "__main__":
    main(sys.argv[1:])
