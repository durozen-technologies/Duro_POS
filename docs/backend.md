# Backend

The backend is a FastAPI application in `backend/`. It is the main domain owner for the system.

## Responsibilities

- JWT auth for admin and shop accounts
- Shop CRUD and shop status management
- Item and inventory item management
- Tamil item name validation
- Daily pricing
- Billing preview and commit
- Exact cash plus UPI payment validation
- Receipt records
- Admin analytics and bill history
- RustFS-backed image upload and thumbnail metadata
- Shared models and schemas for the WhatsApp bot

## Stack

- FastAPI
- SQLAlchemy async
- PostgreSQL through `asyncpg`
- Pydantic
- Alembic
- `uv`
- RustFS S3-compatible storage

## Key Files

```text
backend/main.py                       App entrypoint
backend/app/main.py                   FastAPI app factory and router setup
backend/app/core/config.py            Settings and production validation
backend/app/db/database.py            Async SQLAlchemy engine/session
backend/app/db/startup.py             Idempotent startup and storage tasks
backend/app/models/                   SQLAlchemy models
backend/app/models/enums.py           Shared backend enums
backend/app/schemas/                  Pydantic request/response schemas
backend/app/routers/                  FastAPI routers
backend/app/services/                 Domain service logic
backend/app/services/billing.py       Checkout preview/commit rules
backend/app/services/inventory.py     Inventory movement logic
backend/app/services/storage.py       Item image storage service
backend/migrate.py                    Deployment migration command
backend/docker-entrypoint.sh          Migrate then start Gunicorn
```

## Shared Domain Rule

`backend.app.models` and `backend.app.schemas` are the source of truth for both the API and the WhatsApp bot. If the bot and backend both need a model or schema, add it under `backend/app/` and import it from the bot.

## Local Setup

```bash
cd backend
cp .env.example .env
uv sync
uv run python migrate.py
uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## Core Environment

```env
DATABASE_URL=postgresql+asyncpg://postgres:root@localhost:5432/meat_billing
SECRET_KEY=replace-this-in-production
PRODUCTION=False
ALLOWED_HOSTS=["*"]
CORS_ORIGINS=["*"]
RUSTFS_ENDPOINT_URL=http://localhost:9000
RUSTFS_ACCESS_KEY_ID=...
RUSTFS_SECRET_ACCESS_KEY=...
RUSTFS_BUCKET_NAME=pos-mlb-items
```

In production:

- `SECRET_KEY` must be strong.
- wildcard `ALLOWED_HOSTS` is rejected.
- RustFS settings must be present for image workflows.
- OpenAPI docs are disabled.

## Billing Flow

The backend supports two checkout phases:

1. Preview: validate items, prices, quantities, and exact payment, then return bill preview data and a checkout token.
2. Commit: validate the checkout token and persist the final bill, payment, and receipt data.

The frontend is responsible for printing between preview and commit.

Required order:

```text
preview -> print -> commit
```

## Validation

```bash
cd backend
uv run ruff check .
uv run --with pytest pytest ../test/
```

