"""Postgres integration harness for schema-per-tenant tests."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

ROOT_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT_DIR / "backend"


def postgres_test_url() -> str | None:
    raw = os.environ.get("TEST_DATABASE_URL", "").strip()
    if not raw:
        return None
    if raw.startswith("postgresql+asyncpg:"):
        return raw
    if raw.startswith("postgresql:"):
        return raw.replace("postgresql:", "postgresql+asyncpg:", 1)
    if raw.startswith("postgres:"):
        return raw.replace("postgres:", "postgresql+asyncpg:", 1)
    return raw


def postgres_sync_url(async_url: str) -> str:
    return async_url.replace("postgresql+asyncpg:", "postgresql+psycopg:", 1).replace(
        "postgresql+asyncpg:", "postgresql:", 1
    )


class PostgresHarness:
    def __init__(self) -> None:
        url = postgres_test_url()
        if url is None:
            raise RuntimeError("TEST_DATABASE_URL is not set")
        self.database_url = url
        self.sync_url = url.replace("postgresql+asyncpg:", "postgresql:", 1)
        self.engine = create_async_engine(url, future=True, pool_pre_ping=True)
        self.session_factory = async_sessionmaker(
            bind=self.engine,
            autoflush=False,
            expire_on_commit=False,
        )
        self._sync_engine = create_engine(self.sync_url, future=True)

    def run_migrations(self) -> None:
        env = os.environ.copy()
        env["DATABASE_URL"] = self.database_url
        subprocess.run(
            [sys.executable, "migrate.py"],
            cwd=BACKEND_DIR,
            check=True,
            env=env,
        )

    def dispose(self) -> None:
        self._sync_engine.dispose()

    async def close(self) -> None:
        await self.engine.dispose()

    async def drop_schema(self, schema_name: str) -> None:
        async with self.session_factory() as session:
            await session.execute(text(f'DROP SCHEMA IF EXISTS "{schema_name}" CASCADE'))
            await session.commit()

    async def schema_exists(self, schema_name: str) -> bool:
        async with self.session_factory() as session:
            result = await session.scalar(
                text(
                    "SELECT 1 FROM information_schema.schemata "
                    "WHERE schema_name = :name"
                ),
                {"name": schema_name},
            )
            return result is not None

    async def tenant_alembic_at_head(self, schema_name: str, head: str = "0001_tenant_baseline") -> bool:
        async with self.session_factory() as session:
            await session.execute(text(f'SET search_path TO "{schema_name}", public'))
            version = await session.scalar(
                text(f'SELECT version_num FROM "{schema_name}".alembic_version LIMIT 1')
            )
            return version == head
