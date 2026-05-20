# Meat Billing System Backend

FastAPI backend for the Billing System. It handles:

- JWT login for admins and shop accounts
- one-time first admin registration
- shop account creation and enable/disable controls
- daily per-shop item pricing
- exact-payment checkout with cash and UPI split
- receipt generation after successful settlement
- audit log tracking for important actions

## Stack

- FastAPI
- SQLAlchemy async
- PostgreSQL via `asyncpg`
- `pwdlib` for password hashing
- `python-jose` for JWT tokens
- `uv` for dependency and runtime management

## Project Layout

```text
backend/
├── app/
│   ├── auth/
│   ├── core/
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

## Prerequisites

- Python `3.11.9+`
- `uv`
- PostgreSQL database

## Environment

Copy the sample file and update values if needed:

```bash
cp .env.example .env
```

Supported settings:

```env
DATABASE_URL=postgresql+asyncpg://postgres:root@localhost:5432/meat_billing
SECRET_KEY=replace-this-in-production
ACCESS_TOKEN_EXPIRE_MINUTES=720
production=False
CORS_ORIGINS=["*"]
ALLOWED_HOSTS=["*"]
```

Other backend defaults come from `app/core/config.py`:

- `APP_NAME=Meat Billing System API`
- `API_V1_PREFIX=/api/v1`
- `SHOP_DEFAULT_PASSWORD=ml123`
- `CORS_ALLOW_CREDENTIALS=False`
- `DB_POOL_SIZE=5`
- `DB_MAX_OVERFLOW=10`
- `ENABLE_REQUEST_LOGGING=True`
- `ENABLE_RATE_LIMIT=True`
- `RATE_LIMIT_REQUESTS=120`
- `RATE_LIMIT_WINDOW_SECONDS=60`

## Run Locally

Install dependencies:

```bash
uv sync
```

Install dev tools, including `ruff`:

```bash
uv sync --group dev
```

Start the API:

```bash
uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Prefer `uv run uvicorn ...` instead of a global `uvicorn` binary so the app uses the project environment and installed packages.

Run with Gunicorn:

```bash
uv run gunicorn -c gunicorn.conf.py main:app
```

This project uses `uvicorn-worker` as the Gunicorn worker class.

## Linting And Formatting

This backend is configured to use `ruff` through `uv`.

Run checks:

```bash
uv run ruff check .
```

Auto-fix lint issues when possible:

```bash
uv run ruff check . --fix
```

Format Python files:

```bash
uv run ruff format .
```

Suggested workflow:

```bash
uv run ruff check . --fix
uv run ruff format .
```

The `ruff` configuration lives in `backend/pyproject.toml`.

## Finding Unused Code

There is no perfect static command for dead-code detection, but these checks
are useful for the backend:

Check unused imports and local variables in the app package:

```bash
uv run ruff check app --select F401,F841
```

Search for a symbol across the backend to see whether it is referenced
anywhere outside its own definition:

```bash
rg -n "symbol_name" backend -S
```

Suggested workflow:

1. Run `uv run ruff check app --select F401,F841`.
2. Search suspicious helpers with `rg -n "symbol_name" backend -S`.
3. Remove only code that has no real call sites and is not part of startup,
   FastAPI dependency injection, or framework registration.

Example:

```bash
rg -n "get_effective_shop_prices|_get_shop_price_map" backend -S
```

## Startup Behavior

On startup the app:

- creates database tables from the SQLAlchemy models
- seeds the default billing items if they do not exist yet
- updates the seeded item definitions to match the current code

Seeded items currently include:

- Chicken
- Chicken without skin
- Duck
- Country Chicken
- Live Country Chicken
- Live Chicken
- Chicken Cleaning

## Authentication And Roles

- `admin` users can create and manage shops, view summaries, review bills, and inspect audit logs.
- `shop_account` users can fetch their shop bootstrap data, save today's price sheet, and create bills.
- Only the first admin can be created through public registration.
- Shop logins are generated as `ml1`, `ml2`, `ml3`, and so on.
- New shop accounts use the configured default password, which currently defaults to `ml123`.

## Core Business Rules

- A shop must save today's full price sheet before billing begins.
- Prices are stored as a shop-specific daily snapshot.
- Count-based items accept only whole-number quantities.
- A bill is accepted only when `cash_amount + upi_amount` exactly equals the total.
- Underpayment and overpayment are both rejected.
- Receipt creation happens only after a successful settled payment.

## API Routes

### Utility

- `GET /api/v1/health`

### Auth

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`

### Admin

- `POST /api/v1/admin/shops`
- `GET /api/v1/admin/shops`
- `PATCH /api/v1/admin/shops/{shop_id}/status`
- `GET /api/v1/admin/sales-summary`
- `GET /api/v1/admin/payment-summary`
- `GET /api/v1/admin/bills`
- `GET /api/v1/admin/audit-logs`

### Shop

- `GET /api/v1/shop/bootstrap`
- `GET /api/v1/shop/daily-prices/today`
- `POST /api/v1/shop/daily-prices`
- `POST /api/v1/shop/bills`

## API Docs

When the server is running:

- Swagger UI: `http://127.0.0.1:8000/docs`
- ReDoc: `http://127.0.0.1:8000/redoc`

Docs are automatically disabled when `production=True`.

## Render Deployment

Recommended environment variables on Render:

```env
DATABASE_URL=<render-postgres-or-external-postgres-url>
SECRET_KEY=<at-least-32-random-characters>
production=True
CORS_ORIGINS=["https://your-frontend.example.com"]
ALLOWED_HOSTS=["your-backend.onrender.com"]
ACCESS_TOKEN_EXPIRE_MINUTES=720
```

Recommended start command:

```bash
gunicorn -c gunicorn.conf.py main:app
```

Health check path:

```text
/api/v1/health
```

Production behavior:

- startup fails fast if the database is unavailable
- API docs are disabled
- wildcard CORS and wildcard hosts are rejected
- database pool pre-ping and recycling are enabled for long-lived Render instances
- Gunicorn manages worker processes using the `uvicorn-worker` package

## Middleware

The backend includes:

- request logging middleware with `X-Request-ID` on responses
- IP-based rate limiting middleware with `429` responses
- rate limit headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

Default rate limit:

- `120` requests per `60` seconds per client IP
- exempt paths include `/api/v1/health`, `/docs`, `/redoc`, and OpenAPI routes

Note:

- the current rate limiter is in-memory per process
- when running multiple Gunicorn workers, limits apply independently in each worker

## Frontend Connectivity

The Expo frontend must call a reachable API host. Common cases:

- Android emulator: `http://10.0.2.2:8000`
- iOS simulator: `http://127.0.0.1:8000`
- Local web: `http://127.0.0.1:8000`
- Physical phone on Wi-Fi: `http://<your-lan-ip>:8000`

Example:

```bash
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.20:8000 npx expo start --lan
```

If you start Expo with `--tunnel`, expose the backend separately and point the frontend at that public backend URL.

## Current Gaps

- No Alembic migrations yet
- No automated backend test suite yet
- No printer integration yet; the frontend currently shows a plain receipt preview
