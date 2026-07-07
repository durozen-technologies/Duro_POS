import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from app.db.postgres_url import (
    async_postgres_database_url,
    is_async_postgres_database_url,
    sync_postgres_database_url,
)


class PostgresUrlTests(unittest.TestCase):
    def test_async_detection_accepts_plain_postgresql_url(self) -> None:
        self.assertTrue(
            is_async_postgres_database_url("postgresql://postgres:root@localhost:5432/brolier_360")
        )

    def test_async_normalizes_plain_postgresql_url(self) -> None:
        self.assertEqual(
            async_postgres_database_url("postgresql://postgres:root@localhost:5432/brolier_360"),
            "postgresql+asyncpg://postgres:root@localhost:5432/brolier_360",
        )

    def test_sync_normalizes_asyncpg_url(self) -> None:
        self.assertEqual(
            sync_postgres_database_url(
                "postgresql+asyncpg://postgres:root@localhost:5432/brolier_360"
            ),
            "postgresql+psycopg://postgres:root@localhost:5432/brolier_360",
        )

    def test_sync_strips_asyncpg_only_query_params(self) -> None:
        self.assertEqual(
            sync_postgres_database_url(
                "postgresql+asyncpg://postgres:root@pgbouncer:6432/brolier_360"
                "?prepared_statement_cache_size=0&statement_cache_size=0"
            ),
            "postgresql+psycopg://postgres:root@pgbouncer:6432/brolier_360",
        )


if __name__ == "__main__":
    unittest.main()
