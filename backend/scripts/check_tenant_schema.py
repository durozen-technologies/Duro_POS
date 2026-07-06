"""One-off tenant schema diagnostic."""
from __future__ import annotations

from sqlalchemy import create_engine, inspect, text

from app.core.config import get_settings
from app.db.postgres_url import sync_postgres_database_url
from app.db.tenant_schema import list_tenant_schema_names_from_db

NEEDED_BILLS = {"checkout_token", "created_by_user_id", "item_count", "total_quantity"}
NEEDED_RECEIPTS = {"receipt_status", "print_attempts", "last_print_error"}


def main() -> None:
    url = sync_postgres_database_url(str(get_settings().database_url))
    engine = create_engine(url)
    schemas = list_tenant_schema_names_from_db()
    print("schemas:", schemas)
    with engine.connect() as conn:
        for schema in schemas:
            insp = inspect(conn)
            tables = set(insp.get_table_names(schema=schema))
            print(f"--- {schema} ---")
            print("checkout_snapshots:", "checkout_snapshots" in tables)
            if "bills" in tables:
                cols = {c["name"] for c in insp.get_columns("bills", schema=schema)}
                print("bills missing:", sorted(NEEDED_BILLS - cols))
            else:
                print("bills table missing")
            if "receipts" in tables:
                cols = {c["name"] for c in insp.get_columns("receipts", schema=schema)}
                print("receipts missing:", sorted(NEEDED_RECEIPTS - cols))
            if "shops" in tables:
                cols = {c["name"] for c in insp.get_columns("shops", schema=schema)}
                print("shops.daily_prices_published_on:", "daily_prices_published_on" in cols)
            ver = conn.execute(
                text(f'SELECT version_num FROM "{schema}".alembic_version LIMIT 1')
            ).scalar_one_or_none()
            all_vers = conn.execute(
                text(f'SELECT version_num FROM "{schema}".alembic_version')
            ).fetchall()
            print("alembic:", ver, "all rows:", all_vers)
    with engine.connect() as conn:
        enum = conn.execute(
            text(
                "SELECT t.typname FROM pg_type t "
                "JOIN pg_namespace n ON n.oid = t.typnamespace "
                "WHERE n.nspname = 'public' AND t.typname = 'receiptstatus'"
            )
        ).fetchall()
        print("public receiptstatus enum:", enum)
        snap = conn.execute(
            text(
                "SELECT schemaname, tablename FROM pg_tables "
                "WHERE tablename = 'checkout_snapshots'"
            )
        ).fetchall()
        print("checkout_snapshots locations:", snap)


if __name__ == "__main__":
    main()
