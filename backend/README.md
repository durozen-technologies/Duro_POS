# Meat Billing System Backend

FastAPI backend for the Billing System. It handles:

- JWT login for admins and shop accounts
- one-time first admin registration
- shop CRUD and shop enable/disable controls
- active item CRUD with optional RustFS-backed item images
- shop-level and global daily pricing
- exact-payment checkout with cash and UPI split
- receipt creation after successful settlement
- admin analytics, bill history, and dashboard bootstrap data

## Stack

- FastAPI
- SQLAlchemy async
- PostgreSQL via `asyncpg`
- `pwdlib[argon2]` for password hashing
- `python-jose` for JWT tokens
- `uv` for dependency and runtime management

## Project Layout

```text
backend/
├── __init__.py
├── app/
│   ├── auth/
│   ├── core/
│   ├── db/
│   ├── models/
│   ├── routers/
│   ├── schemas/
│   └── services/
├── .env.example
├── main.py
├── pyproject.toml
├── uv.lock
└── README.md
```

## Shared Package Contract

`backend.app` is the shared domain package for both the backend API and the WhatsApp bot.

- Put shared SQLAlchemy entities in [`app/models/`](app/models/)
- Put shared Pydantic response/request types in [`app/schemas/`](app/schemas/)
- Put WhatsApp-specific shared entities in [`app/models/whatsapp.py`](app/models/whatsapp.py)
- Put WhatsApp-specific shared payload/state schemas in [`app/schemas/whatsapp.py`](app/schemas/whatsapp.py)

The WhatsApp bot imports these as `backend.app.models` and `backend.app.schemas`. Its local [`../WhatsApp Bot/app/models.py`](../WhatsApp%20Bot/app/models.py) and [`../WhatsApp Bot/app/schemas.py`](../WhatsApp%20Bot/app/schemas.py) files are only thin re-export shims for compatibility with existing bot imports.

If a model or schema is used by both services, define it here instead of duplicating it under the bot app package.

## Prerequisites

- Python `3.11.9+`
- `uv`
- PostgreSQL

## Environment

Copy the sample file first:

```bash
cp .env.example .env
```

Core settings used by the current backend:

```env
DATABASE_URL=postgresql+asyncpg://postgres:root@localhost:5432/meat_billing
SECRET_KEY=replace-this-in-production
ACCESS_TOKEN_EXPIRE_MINUTES=720
PRODUCTION=False
CORS_ORIGINS=["*"]
ALLOWED_HOSTS=["*"]
CORS_ALLOW_CREDENTIALS=False
RUSTFS_ENDPOINT_URL=
RUSTFS_ACCESS_KEY_ID=
RUSTFS_SECRET_ACCESS_KEY=
RUSTFS_REGION_NAME=us-east-1
RUSTFS_BUCKET_NAME=pos-mlb-items
RUSTFS_PUBLIC_BASE_URL=
RUSTFS_PUBLIC_READ_ENABLED=False
RUSTFS_CONNECT_TIMEOUT_SECONDS=5
RUSTFS_READ_TIMEOUT_SECONDS=15
ITEM_IMAGE_MAX_BYTES=5242880
ITEM_IMAGE_THUMBNAIL_SIZE=192
ITEM_IMAGE_FULL_MAX_SIZE=1024
```

Important backend defaults from [`app/core/config.py`](app/core/config.py):

- `APP_NAME=Meat Billing System API`
- `API_V1_PREFIX=/api/v1`
- `SHOP_DEFAULT_PASSWORD=ml123`
- `DB_POOL_SIZE=5`
- `DB_MAX_OVERFLOW=10`
- `DB_POOL_TIMEOUT=30`
- `DB_POOL_RECYCLE=1800`

Production validation rules:

- `SECRET_KEY` must be strong and at least 32 characters
- wildcard `ALLOWED_HOSTS` is rejected
- wildcard CORS is collapsed to an empty list
- RustFS settings must be supplied together if enabled

## Run Locally

Install dependencies:

```bash
uv sync
```

Install dev tools:

```bash
uv sync --group dev
```

Start the API:

```bash
# from repo root
make backend-dev

# or from backend/
uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

One-off migration:

```bash
make backend-migrate
# or: uv run python migrate.py
```

Plain uvicorn after migrations:

```bash
uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Run with Gunicorn:

```bash
uv run python -m gunicorn main:app \
  --bind 0.0.0.0:${PORT:-8000} \
  --worker-class uvicorn_worker.UvicornWorker \
  --workers ${WEB_CONCURRENCY:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1)} \
  --timeout ${GUNICORN_TIMEOUT:-60} \
  --graceful-timeout ${GUNICORN_GRACEFUL_TIMEOUT:-30} \
  --keep-alive ${GUNICORN_KEEPALIVE:-5} \
  --access-logfile - \
  --error-logfile - \
  --log-level ${LOG_LEVEL:-info} \
  --capture-output
```

This backend uses `uvicorn-worker` as the Gunicorn worker class.

## Startup Behavior

On startup the backend:

- validates that key identifier columns use UUID-compatible schema
- leaves item catalog creation to admin users; startup no longer seeds fixed/default items
- stores new item images in RustFS when RustFS is configured
- migrates legacy `items.image_data` rows to RustFS when RustFS is configured, then drops the legacy column

In production, startup fails fast if database initialization fails.

## Database migrations

Schema migrations are Alembic-based. [`migrate.py`](migrate.py) first migrates any legacy `items.image_data` bytes to RustFS, then runs `alembic upgrade head`, then runs idempotent data tasks from [`app/db/startup.py`](app/db/startup.py).

| Environment | Command / trigger |
|-------------|-------------------|
| Local one-off | `make backend-migrate` or `uv run python migrate.py` |
| Local dev server | run `make backend-migrate`, then `make backend-dev` |
| Docker / production image | [`docker-entrypoint.sh`](docker-entrypoint.sh) runs `migrate.py` before Gunicorn |
| Production CI/CD | Root [`scripts/deploy-prod.sh`](../scripts/deploy-prod.sh) runs `migrate.py` on the pulled image **before** recreating the backend (triggered by pushes to `backend/**` on `main`) |

See the root [README.md — Database migrations](../README.md#database-migrations) for the full production flow.

## Docker

The active stack uses [`compose.yaml`](../compose.yaml), not Nginx.

Current services in the active compose file:

- `backend`
- `caddy`

Production images use [`Dockerfile`](Dockerfile) with [`docker-entrypoint.sh`](docker-entrypoint.sh) (migrate, then `exec` the Gunicorn command).

Useful commands from the repo root:

```bash
make docker-build
make docker-config
make docker-up
make docker-rebuild
make docker-down
make docker-logs
make docker-ps
```

The active proxy is Caddy and terminates HTTPS for `CADDY_PUBLIC_HOST`.

Backend connectivity reference:

- direct local backend: `http://127.0.0.1:8000`
- internal Docker upstream: `http://backend:8000`
- through Caddy: `https://<CADDY_PUBLIC_HOST>`

Current Compose defaults point the backend to host services:

```env
DATABASE_URL=postgresql+asyncpg://postgres:root@host.docker.internal:5432/meat_billing
RUSTFS_ENDPOINT_URL=http://host.docker.internal:9000
```

So inside the backend container:

- `localhost` means the container itself
- `host.docker.internal` is the host machine

Item images are stored and served from RustFS. New image uploads fail if RustFS is not configured or unavailable. Production startup requires RustFS configuration. Existing legacy `items.image_data` bytes are migrated to RustFS and the legacy column is dropped by Alembic; the application no longer reads or writes image bytes from Postgres.

## Middleware And Security

The app adds:

- CORS middleware
- request ID middleware
- gzip middleware
- trusted host middleware

Behavior includes:

- `X-Request-ID` response IDs

Docs behavior:

- Swagger UI and ReDoc are enabled when `PRODUCTION=False`
- OpenAPI routes are disabled when `PRODUCTION=True`

## Authentication And Roles

- `POST /api/v1/auth/register` creates the first admin only
- `POST /api/v1/auth/login` authenticates admins and shop accounts
- `GET /api/v1/auth/me` returns the current session payload

Role behavior:

- `admin` users manage shops, items, prices, analytics, and bills
- `shop_account` users manage their daily prices and checkout bills
- disabled users cannot log in
- disabled shops block their linked shop account

Shop login behavior:

- shop usernames are generated as `ml1`, `ml2`, `ml3`, and so on
- default password comes from `SHOP_DEFAULT_PASSWORD`
- shop sessions include `requires_price_setup` and `next_screen`

## Core Business Rules

- a shop must have today's prices before billing can start
- prices must be submitted for every active item
- duplicate or unknown price entries are rejected
- count-based items only accept integer unit quantities
- total payment must exactly match the bill
- underpayment returns a balance error
- overpayment is rejected
- receipts are created only for successful paid bills

## API Routes

### Utility

- `GET /api/v1/health`

### Catalog

- `GET /api/v1/catalog/items/{item_id}/image`

### Auth

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/register`
- `GET /api/v1/auth/me`

### Admin

- `POST /api/v1/admin/shops`
- `GET /api/v1/admin/shops`
- `GET /api/v1/admin/shops/{shop_id}`
- `PATCH /api/v1/admin/shops/{shop_id}`
- `PATCH /api/v1/admin/shops/{shop_id}/status`
- `DELETE /api/v1/admin/shops/{shop_id}`
- `POST /api/v1/admin/items`
- `PATCH /api/v1/admin/items/{item_id}`
- `PUT /api/v1/admin/items/{item_id}/image`
- `DELETE /api/v1/admin/items/{item_id}`
- `GET /api/v1/admin/sales-summary`
- `GET /api/v1/admin/payment-summary`
- `GET /api/v1/admin/item-sales`
- `GET /api/v1/admin/bills`
- `GET /api/v1/admin/bills/{bill_id}`
- `GET /api/v1/admin/shops/{shop_id}/prices/bootstrap`
- `POST /api/v1/admin/shops/{shop_id}/daily-prices`
- `GET /api/v1/admin/prices/bootstrap`
- `POST /api/v1/admin/daily-prices`
- `GET /api/v1/admin/dashboard/bootstrap`

### Shop

- `GET /api/v1/shop/bootstrap`
- `GET /api/v1/shop/daily-prices/today`
- `POST /api/v1/shop/daily-prices`
- `POST /api/v1/shop/bills`

## Useful URLs

Local backend:

- `http://127.0.0.1:8000/api/v1/health`
- `http://127.0.0.1:8000/api/v1/openapi.json`
- `http://127.0.0.1:8000/docs`
- `http://127.0.0.1:8000/redoc`

Through Caddy:

- `https://<CADDY_PUBLIC_HOST>/api/v1/health`
- `https://<CADDY_PUBLIC_HOST>/docs`

## Testing

Run all backend tests:

```bash
cd backend
uv run --with pytest pytest ../test/ -v
```

Run unit tests:

```bash
cd backend
uv run --with pytest pytest ../test/unit/ -v
```

Run integration tests:

```bash
cd backend
uv run --with pytest pytest ../test/integration/ -v
```

Run coverage:

```bash
cd backend
uv run --with pytest --with pytest-cov pytest ../test/ --cov=app --cov-report=html
```

## Linting And Formatting

```bash
cd backend
uv run ruff check .
uv run ruff check . --fix
uv run ruff format .
```

Useful unused-code check:

```bash
cd backend
uv run ruff check app --select F401,F841
```

## API pagination

Cursor-paginated list endpoints accept `limit` plus cursor fields from the previous response (`next_cursor_*`). Supply both cursor fields together or omit both — partial cursors return 422.

## Current Gaps

- Application-level rate limiting is not implemented; auth throttling is handled at the Caddy edge
