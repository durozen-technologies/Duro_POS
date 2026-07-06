# Backend

The backend is a FastAPI application in `backend/`. It owns auth, multi-tenant data access, billing, inventory, images, and admin APIs.

## Stack

- FastAPI
- SQLAlchemy async (`asyncpg` on PostgreSQL)
- Pydantic v2 schemas
- Alembic (platform + per-tenant chains)
- `uv` for dependencies
- RustFS (S3-compatible) for item images
- Redis for org/schema caching

## Layout

```text
backend/main.py                       Uvicorn entry (imports app.main)
backend/app/main.py                   FastAPI factory, lifespan, middleware
backend/app/core/                     Config, logging, errors, middleware
backend/app/db/                       Database, startup guards, tenant routing
backend/app/models/                   SQLAlchemy models (platform + tenant tables)
backend/app/schemas/                  Pydantic request/response types
backend/app/routers/                  HTTP routes
backend/app/services/                 Domain logic
backend/migrate.py                    Deployment migration CLI
backend/migrations/                   Platform Alembic
backend/migrations/tenant/            Tenant Alembic
```

Shared API contracts live in `backend.app.models` and `backend.app.schemas` only.

## Multi-tenant database model

PostgreSQL uses **schema-per-tenant** (see [ADR-003](decisions/ADR-003-schema-per-tenant.md)).

| Schema | Contents |
|--------|----------|
| `public` | `organizations`, super-admin `users`, `user_auth_index`, `permissions`, `audit_logs`, platform `alembic_version` |
| `tenant_<slug>` | Shops, tenant users, catalogue, inventory, bills, receipts, tenant RBAC, etc. |

### Request routing

- Tenant APIs resolve `organizations.schema_name` from JWT `org_id` (cached in Redis).
- `tenant_schema_scope()` sets `search_path` and a context var for the active schema.
- Super-admin routes use `public` only unless drilling into a tenant.

### Organization provisioning

Creating an organization (`POST` super-admin organizations API):

1. Insert `organizations` row with `schema_name = derive_schema_name(slug)`.
2. `CREATE SCHEMA` for the tenant.
3. `provision_tenant_schema_async()` — create tables from models, apply drift patches, stamp tenant Alembic head, seed retailer RBAC grants.
4. Create `TenantFullAdmin` system role in the tenant schema.

This path does **not** run the tenant Alembic upgrade chain. Full Alembic is for schemas that already exist and are behind head.

### Startup

On application lifespan (`app/main.py`):

1. `run_database_startup_tasks()` — idempotent platform column/index guards and legacy image migration.
2. `run_all_tenant_migrations(quiet=True)` — per-tenant drift check; upgrades only when behind head. Routine messages are DEBUG, not INFO.

Deploy-time schema changes should still go through `migrate.py` before or with the new image.

## Local setup

```bash
cd backend
cp .env.example .env
uv sync
uv run python migrate.py
uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## Core environment

```env
DATABASE_URL=postgresql+asyncpg://postgres:root@localhost:5432/brolier_360
SECRET_KEY=replace-this-in-production
PRODUCTION=False
ALLOWED_HOSTS=["*"]
CORS_ORIGINS=["*"]
RUSTFS_ENDPOINT_URL=http://localhost:9000
RUSTFS_ACCESS_KEY_ID=...
RUSTFS_SECRET_ACCESS_KEY=...
RUSTFS_BUCKET_NAME=pos-mlb-items
```

Production requirements:

- Strong `SECRET_KEY`
- No wildcard `ALLOWED_HOSTS`
- RustFS credentials for image workflows
- OpenAPI docs disabled

## Billing flow

Checkout is two-phase:

1. **Preview** — validate items, prices, quantities, exact payment; return preview + checkout token.
2. **Commit** — validate token; persist bill, payment, receipt.

Required client order: `preview → print → commit`.

## Migrations

Platform and tenant migration workflows, CLI flags, and head revision rules are documented in [migrations.md](migrations.md).

## Validation

```bash
cd backend
uv run ruff check .
uv run --with pytest pytest ../test/
```
