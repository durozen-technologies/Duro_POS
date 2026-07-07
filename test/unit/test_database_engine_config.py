import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from sqlalchemy.pool import NullPool

from app.db.database import _build_engine_config
from app.db.postgres_url import strip_async_only_query_params, uses_pgbouncer
from sqlalchemy.engine import make_url


class DatabaseEngineConfigTests(unittest.TestCase):
    def test_pgbouncer_uses_psycopg_nullpool_no_prepare(self) -> None:
        url, connect_args, engine_kwargs = _build_engine_config(
            "postgresql+asyncpg://postgres:secret@pgbouncer:6432/brolier_360"
            "?prepared_statement_cache_size=0&statement_cache_size=0"
        )

        self.assertEqual(url.host, "pgbouncer")
        self.assertEqual(url.drivername, "postgresql+psycopg")
        self.assertNotIn("prepared_statement_cache_size", url.query)
        self.assertNotIn("statement_cache_size", url.query)
        self.assertIsNone(connect_args.get("prepare_threshold"))
        self.assertNotIn("prepared_statement_cache_size", connect_args)
        self.assertIs(engine_kwargs["poolclass"], NullPool)

    def test_direct_postgres_keeps_asyncpg_pool(self) -> None:
        url, connect_args, engine_kwargs = _build_engine_config(
            "postgresql+asyncpg://postgres:secret@postgres:5432/brolier_360"
        )

        self.assertEqual(url.drivername, "postgresql+asyncpg")
        self.assertEqual(connect_args["prepared_statement_cache_size"], 0)
        self.assertNotIn("poolclass", engine_kwargs)

    def test_uses_pgbouncer_host_detection(self) -> None:
        self.assertTrue(uses_pgbouncer(make_url("postgresql+asyncpg://u:p@pgbouncer:6432/db")))
        self.assertFalse(uses_pgbouncer(make_url("postgresql+asyncpg://u:p@postgres:5432/db")))

    def test_strip_async_only_query_params(self) -> None:
        url = make_url(
            "postgresql+asyncpg://postgres:secret@pgbouncer:6432/brolier_360"
            "?prepared_statement_cache_size=0&sslmode=disable"
        )
        stripped = strip_async_only_query_params(url)
        self.assertNotIn("prepared_statement_cache_size", stripped.query)
        self.assertEqual(stripped.query.get("sslmode"), "disable")


if __name__ == "__main__":
    unittest.main()
