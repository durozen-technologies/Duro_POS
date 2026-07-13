# Postgres

PostgreSQL is the relational database for the Billing System.

## Responsibilities

- Users and auth data
- Shops and shop accounts
- Items, Tamil names, categories, custom attributes, and allocation metadata
- Daily prices
- Inventory items, categories, allocations, and movement ledger
- Bills, bill items, payments, and receipts

## Production Compose Service

Defined in `docker-compose.prod.yml`:

```yaml
postgres:
  image: postgres:17-alpine
  profiles: ["infra"]
  ports:
    - "${POSTGRES_PUBLISH_PORT:-5432}:5432"
```

Important environment:

```env
POSTGRES_DB=brolier_360
POSTGRES_USER=postgres
POSTGRES_PASSWORD=...
POSTGRES_DATA_DIR=/home/ubuntu/pos-postgress/data
```

The backend connects with:

```env
DATABASE_URL=postgresql+asyncpg://postgres:<password>@postgres:5432/brolier_360
```

## Persistence

Production data is bind-mounted:

```text
/home/ubuntu/pos-postgress/data -> /var/lib/postgresql/data
```

The repo also has:

```text
postgres/data/.gitkeep
```

This is only a placeholder so the directory exists in Git.

## Healthcheck

```bash
pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

## Local Usage

If Postgres runs on the host, backend default local connection often looks like:

```env
DATABASE_URL=postgresql+asyncpg://postgres:root@localhost:5432/brolier_360
```

If backend runs inside Docker while Postgres runs on the host:

```env
DATABASE_URL=postgresql+asyncpg://postgres:root@host.docker.internal:5432/brolier_360
```

## Operational Notes

- Do not store item image bytes in Postgres.
- Use migrations for schema changes.
- Back up data before risky migrations or major deploys.
- If the production Postgres container is unhealthy, deploy tries **data-dir permission repair** (`chown 70:70`) and one container recreate. WAL/checkpoint corruption still needs `scripts/postgres-recover.sh` (manual).
- Recovery helpers live in `scripts/postgres-recover.sh`.
- Automated production backup flow: `implementations/backup-system.md` and `scripts/backup.sh`.

## Schema-per-tenant (ADR-003)

PostgreSQL production uses **platform `public`** plus one schema per organization (`tenant_<slug>` on `organizations.schema_name`). Super-admin accounts and `user_auth_index` live in `public`; operational data lives in tenant schemas.

### One-shot cutover (existing shared-schema data)

1. `pg_dump` the database.
2. From `backend/`: `uv run python migrate.py` — platform head + all tenant Alembic chains.
3. Preview: `uv run python -m app.cli migrate-tenant-data --all-legacy --dry-run`
4. Apply: `uv run python -m app.cli migrate-tenant-data --all-legacy --execute`
5. Optional cleanup: add `--cleanup-public-backups` to drop `public._migrated_*` tables.
6. Deploy application build with tenant session routing enabled.

### Day-to-day

| Task | Command |
|------|---------|
| Platform + tenants migrate | `uv run python migrate.py` |
| Bootstrap super admin (prod VM) | `docker compose ... run --rm migrate python -m app.cli bootstrap-super-admin ...` — see [`README.md`](../README.md#one-time-vm-setup) |
| Tenants only | `uv run python migrate.py --tenants-only` |
| Single tenant schema | `uv run python migrate.py --tenants-only --schema tenant_foo` |
| Baseline table check | `uv run python scripts/check_tenant_baseline.py` |

### Pool safety

Tenant requests set `search_path` via `ContextVar` + `after_begin` on each transaction. Do not assume pooled connections retain `search_path` between requests.

### Integration tests

```bash
TEST_DATABASE_URL=postgresql+asyncpg://postgres:root@localhost:5432/brolier_360_test \
  uv run --directory backend python -m unittest test.integration.test_schema_provisioning -v
```

(Run from repo root with `PYTHONPATH=backend:`.)

