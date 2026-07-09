# Migrations

DuroPOS uses **two Alembic chains** on PostgreSQL:

| Chain | Location | `alembic_version` table | When it runs |
|-------|----------|-------------------------|--------------|
| **Platform** | `backend/migrations/` | `public.alembic_version` | `migrate.py`, deploy entrypoint |
| **Tenant** | `backend/migrations/tenant/` | `<tenant_schema>.alembic_version` | CLI, startup repair, legacy upgrade paths |

SQLite is supported for unit tests only. Schema-per-tenant provisioning and tenant Alembic are **PostgreSQL-only**.

See also [ADR-003](decisions/ADR-003-schema-per-tenant.md) for tenancy layout.

## Key files

```text
backend/migrate.py                          Deployment entrypoint (platform + optional tenants)
backend/migrations/                         Platform Alembic env + versions
backend/migrations/tenant/                  Tenant Alembic env + versions
backend/app/db/startup.py                    Idempotent platform schema guards on app boot
backend/app/db/tenant_schema.py              Tenant provision, repair, search_path routing
backend/app/db/tenant_metadata.py            Tenant DDL helpers and drift patches
backend/app/services/super_admin/organizations.py   New-org provisioning API
```

Current tenant head revision is defined in code as `TENANT_MIGRATION_HEAD` in `tenant_schema.py` (must match the latest file under `migrations/tenant/versions/`).


## Platform migrations

### What they cover

Organizations registry, super-admin users, `user_auth_index`, permissions catalog, audit tables, and other **public** control-plane DDL.

### Commands

```bash
cd backend
uv run python migrate.py
```

This runs, in order:

1. Legacy item-image migration to RustFS (when needed).
2. `alembic upgrade head` on the platform chain.
3. Idempotent startup guards from `app/db/startup.py` (column/index patches).
4. Tenant repair for every registered `tenant_*` schema (when `DATABASE_URL` is PostgreSQL).

### Production

The backend image runs `migrate.py` before Gunicorn (`backend/docker-entrypoint.sh`). `scripts/deploy-prod.sh` can run migrations before recreating containers.

## Tenant migrations

### What they cover

Per-organization operational data: shops, tenant users, catalogue, inventory, billing, receipts, expenses, RBAC tables, etc. Each organization has its own PostgreSQL schema (`tenant_<slug>`).

### How a schema gets to current DDL

There are three paths:

| Path | Trigger | Alembic upgrade? |
|------|---------|------------------|
| **Provision** | Super-admin creates a new organization | **No** — tables are created from SQLAlchemy models, then head is stamped |
| **Repair (behind)** | Schema exists but `alembic_version` is older than head | **Yes** — `alembic upgrade` to `TENANT_MIGRATION_HEAD` |
| **Repair (at head)** | App startup / `migrate.py` when already at head | **No** — cheap drift patch + verify only |

App startup (`main.py`) repairs **only** schemas listed on `organizations.schema_name`, not every `tenant_*` name in `information_schema`. Use `migrate.py` to include orphan tenant schemas.

**New organizations** call `provision_tenant_schema_async()` — this must not run the full Alembic chain; it bootstraps from models and stamps head.

**Startup** calls `run_all_tenant_migrations(quiet=True)` from `app/main.py`. When every tenant is already at head, you should see **no migration INFO lines** in normal logs.

### CLI

```bash
cd backend

# Platform + tenants (default when DATABASE_URL is PostgreSQL)
uv run python migrate.py

# Tenants only
uv run python migrate.py --tenants-only

# Single tenant schema
uv run python migrate.py --tenants-only --schema tenant_my_shop

# Idempotent DDL repair (missing tables / drift) without platform migrations
uv run python migrate.py --repair-tenant-ddl --tenants-only

# Single schema repair
uv run python migrate.py --repair-tenant-ddl --tenants-only --schema tenant_my_shop
```

Set `TARGET_SCHEMA` when invoking tenant Alembic directly (normally handled by `tenant_schema.py`).

### Drift patches

`ensure_tenant_schema_drift_patches()` in `tenant_metadata.py` applies idempotent column/index fixes when physical schema lags stamped Alembic head (for example after a hotfix). Tenant migration `0012_billing_reliability` delegates to this helper instead of blocking `ALTER TABLE` in Alembic.



## App startup vs CLI

| Event | Platform guards | Tenant work | Log level |
|-------|-----------------|-------------|-----------|
| `uvicorn` / Gunicorn lifespan | `run_database_startup_tasks()` | `run_all_tenant_migrations(quiet=True)` | DEBUG for routine tenant messages |
| `migrate.py` | same + platform Alembic | `run_all_tenant_migrations(quiet=False)` | INFO |

Warnings and errors are always logged.

## Adding a platform migration

1. Update SQLAlchemy models under `backend/app/models/`.
2. Create a revision in `backend/migrations/versions/`.
3. Keep revisions reversible where practical.
4. Run lint and tests (see below).

## Adding a tenant migration

1. Update tenant models (same `Base.metadata` set, excluding `PLATFORM_TABLES`).
2. Add a revision under `backend/migrations/tenant/versions/`.
3. Prefer idempotent patterns for large tables (delegate to `ensure_tenant_schema_drift_patches` when appropriate).
4. Bump `TENANT_MIGRATION_HEAD` in `tenant_schema.py`.
5. Run `backend/scripts/check_tenant_baseline.py` and migration unit tests.

For **new** tenants after the change, provisioning from models plus stamp may be enough; Alembic still upgrades **existing** schemas on repair.

## Validation

```bash
cd backend
uv run ruff check .
uv run --with pytest pytest ../test/

# Postgres-only sanity scripts (require live DB)
uv run python scripts/check_public_schema.py
uv run python scripts/check_tenant_baseline.py
```

Migration-focused unit tests:

```bash
PYTHONPATH=".:backend" backend/.venv/bin/python test/unit/test_migrations.py
```

## Rules

- Do not store item image bytes in Postgres; use RustFS keys (`image_object_key`, `image_content_type`).
- Keep startup and drift tasks **idempotent**.
- Postgres enum labels in the database may differ from Python enum names — coordinate API and migration changes.
- Never derive `schema_name` at runtime without confirming `organizations.schema_name`.
- Reset `search_path` on pooled connections; tenant requests use `SET search_path TO "<tenant>", public`.
