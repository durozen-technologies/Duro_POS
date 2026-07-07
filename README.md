# Brolier 360

Mobile-first meat billing and POS platform with multi-tenant PostgreSQL isolation and Android receipt printing.

## What’s in the repo

| Path | Role |
|------|------|
| [`backend/`](backend/) | FastAPI API — auth, shops, catalog, billing, inventory, reports, super-admin |
| [`frontend/`](frontend/) | Expo React Native app — tenant admin, shop counter, super-admin |
| [`caddy/`](caddy/) | Reverse proxy, TLS, rate limiting |
| [`rustfs/`](rustfs/) | Optional S3-compatible object storage helpers |
| [`test/`](test/) | Backend unit and integration tests |
| [`docs/`](docs/) | Ops notes, ADRs, Postgres runbook |

## Product flow

1. Super admin provisions organizations (each gets a dedicated Postgres schema on PostgreSQL).
2. Tenant admin signs in, creates shops and catalog items.
3. Shop staff set daily prices, build carts, and checkout with exact payment matching.
4. Receipts print on Android via Bluetooth/USB ESC/POS; web/iOS use fallback printing.
5. Bills, inventory movements, and audit data are stored in the tenant schema.

## Tech stack

- **Backend:** FastAPI, SQLAlchemy async, PostgreSQL, JWT, Alembic, `uv`
- **Frontend:** Expo 54, React Native, TypeScript, Zustand, React Navigation, NativeWind
- **Proxy:** Caddy 2 with `caddy-ratelimit`
- **Images:** RustFS / S3-compatible storage (not Postgres blobs)
- **Cache:** Redis (optional; app degrades gracefully without it)

## Architecture

```mermaid
flowchart TB
  subgraph clients [Clients]
    Mobile[Expo app]
  end

  subgraph edge [Edge]
    Caddy[Caddy TLS + rate limit]
  end

  subgraph api [API layer]
    BE[Backend FastAPI]
  end

  subgraph data [Data]
    PG[(PostgreSQL)]
    RF[RustFS]
    RD[(Redis optional)]
  end

  Mobile --> Caddy --> BE
  BE --> PG
  BE --> RF
  BE --> RD
```

### Schema-per-tenant (PostgreSQL)

Production uses **one database, many schemas** ([ADR-003](docs/decisions/ADR-003-schema-per-tenant.md)):

| Schema | Contents |
|--------|----------|
| `public` | `organizations`, `permissions`, `user_auth_index`, super-admin `users`, platform audit |
| `tenant_<slug>` | Shops, tenant users, items, bills, inventory, expenses, etc. |

- New orgs get `organizations.schema_name` and a provisioned tenant schema automatically.
- Tenant API requests set `search_path` via session deps + a `ContextVar` (pool-safe across commits).
- Login resolves tenant users through `user_auth_index` (optional `organization_slug` when usernames collide).
- SQLite is used only for local unit tests; schema-per-tenant features require PostgreSQL.

Details and cutover steps: [`docs/postgres.md`](docs/postgres.md).

### Shared domain package

SQLAlchemy models and Pydantic schemas live in `backend/app/`.

## Prerequisites

- Python 3.11+
- [uv](https://docs.astral.sh/uv/)
- Node.js 18+ and [nub](https://www.npmjs.com/package/nub) (frontend)
- Docker and Docker Compose (production / optional local stack)
- PostgreSQL (local dev or `host.docker.internal` from containers)
- Android device/emulator, iOS simulator, or browser for the frontend

## Local development

### Backend

```bash
cd backend
cp .env.example .env
uv sync
uv run python migrate.py          # platform + tenant schemas on Postgres
uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Bootstrap the first **super admin** (once per environment):

```bash
cd backend
uv run python -m app.cli bootstrap-super-admin --username <admin> --password <password>
```

In production (`PRODUCTION=true`), public `POST /register` is disabled; use the CLI or super-admin APIs.

Default local database:

```env
DATABASE_URL=postgresql+asyncpg://postgres:root@localhost:5432/brolier_360
```

More backend detail: [`backend/README.md`](backend/README.md).

### Frontend

```bash
cd frontend
nub install
nub run start
```

Android dev client / printer testing:

```bash
cd frontend
nub exec expo run:android
nub run start:dev
```

Physical Android device with backend on the same machine:

```bash
adb reverse tcp:8000 tcp:8000
```

Set the API URL in `frontend/.env`:

```env
EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

More frontend detail: [`frontend/README.md`](frontend/README.md).

## Docker (local)

Active compose file: [`compose.yaml`](compose.yaml) — `backend` + `caddy`.

```bash
docker compose -f compose.yaml up -d --build --remove-orphans
docker compose -f compose.yaml logs -f
docker compose -f compose.yaml down
```

Compose defaults point the backend at host Postgres and RustFS:

```env
DATABASE_URL=postgresql+asyncpg://postgres:root@host.docker.internal:5432/brolier_360
RUSTFS_ENDPOINT_URL=http://host.docker.internal:9000
```

Inside a container, use `host.docker.internal` for host services — not `localhost`.

## Production deployment

Production runs on an **Ubuntu EC2 VM** via [`docker-compose.prod.yml`](docker-compose.prod.yml). Images are **built in GitHub Actions**, pushed to **Docker Hub**, and the VM **pulls pre-built images** (no app source on the server).

**Deploy branch:** `prod` (not `main`). Pushes under `backend/**`, `caddy/**`, compose, or `scripts/**` trigger [`.github/workflows/deploy-prod.yml`](.github/workflows/deploy-prod.yml).

### Runtime layout

```mermaid
flowchart TB
  subgraph internet [Internet]
    Mobile[Expo app]
    Clients[API clients]
  end

  subgraph ec2 [EC2 VM]
    Caddy[Caddy round_robin :443]
    BE1[backend-1 :8000]
    BE2[backend-2 :8000]
    PGB[pgBouncer :6432]
    Postgres[(Postgres :5432)]
    Redis[(Redis :6379)]
    RustFS[RustFS :9000]
    PGData["/home/ubuntu/pos-postgress/data"]
    RFData["/home/ubuntu/rustfs/data"]
  end

  Mobile -->|HTTPS| Caddy
  Clients -->|HTTPS| Caddy
  Caddy --> BE1
  Caddy --> BE2
  BE1 --> PGB
  BE2 --> PGB
  PGB --> Postgres
  BE1 --> RustFS
  BE2 --> RustFS
  BE1 --> Redis
  BE2 --> Redis
  Postgres --- PGData
  RustFS --- RFData
```

| Location | Contents |
|----------|----------|
| GitHub Secrets | Passwords, keys, hostnames, SSH key |
| VM `DEPLOY_PATH/.env` | Generated each deploy (never commit) |
| `/home/ubuntu/pos-postgress/data` | Postgres data |
| `/home/ubuntu/rustfs/data` | Object storage data |
| Docker Hub | `<user>/brolier360-pos-backend:latest`, `<user>/brolier360-pos-caddy:latest` |

All services attach to **`brolier360-pos-edge`** and **`brolier360-pos-internal`**.

### Multi-backend notes

Production runs **two backend replicas** behind Caddy (`round_robin` + active `/health` checks). Both connect to Postgres through **pgBouncer** (transaction pooling, port 6432). pgBouncer sets `max_prepared_statements = 0`; backends use SQLAlchemy `NullPool` + `prepared_statement_cache_size=0` so asyncpg does not fight the pooler.

**Redis is required** for correct login rate limiting across replicas. If Redis is down, each backend falls back to in-memory counters (limits are effectively doubled). Keep `REDIS_PASSWORD` set and Redis healthy before enabling dual-backend mode.

Database migrations run **once** via the `migrate` compose service (`scripts/deploy-prod.sh` → `compose run --rm migrate`) — not on backend startup.

### Deploy flow

1. CI builds and pushes images when `backend/**` or `caddy/**` changes on `prod`.
2. CI SCPs compose, pgBouncer config, scripts, and a generated `.env` to the VM.
3. [`scripts/deploy-prod.sh`](scripts/deploy-prod.sh) on the VM:
   - Ensures infra (Postgres, pgBouncer, Redis, RustFS) is healthy
   - Pulls new backend image tags
   - Runs **`migrate`** once on the new image
   - Rolling recreate: **backend-1** → wait healthy → **backend-2** → wait healthy
   - Recreates Caddy when needed; rolls back on health-check failure

### Services and ports

| Service | Image | Host ports | Internal |
|---------|-------|------------|----------|
| `postgres` | `postgres:17-alpine` | `5432` (localhost) | `postgres:5432` |
| `pgbouncer` | built from `pgbouncer/` | — | `pgbouncer:6432` |
| `redis` | `redis:7.4-alpine` | — | `redis:6379` |
| `rustfs` | `rustfs/rustfs` | — | `rustfs:9000` |
| `backend-1`, `backend-2` | `brolier360-pos-backend:latest` | — | `:8000` |
| `caddy` | `brolier360-pos-caddy:latest` | `80`, `443` | — |

External Postgres (restrict **5432** in the EC2 security group; use EC2 public IP or hostname — not the public API domain unless it resolves to the same VM):

```text
Host:     <EC2 public IP or EC2 public DNS>
Port:     5432
Database: brolier_360
User:     postgres
Password: <POSTGRES_PASSWORD>
```

Public HTTPS API (mobile app, curl): `https://<CADDY_PUBLIC_HOST>` only — see [API URLs](#api-urls).

### One-time VM setup

1. Create deploy directory (e.g. `/home/ubuntu/brolier360-pos`).
2. Configure [GitHub Secrets](#github-secrets) — CI writes `.env` on each deploy.
3. Push to `prod` or run **Deploy Production** manually.
4. Bootstrap super admin (once, after deploy + migrations):

   On the VM, use the **`migrate` service** so `DATABASE_URL` hits Postgres directly (not pgBouncer — avoids asyncpg prepared-statement errors):

   ```bash
   cd ~/brolier360-pos   # or your DEPLOY_PATH

   docker compose -f docker-compose.prod.yml --env-file .env --profile infra \
     run --rm migrate \
     python -m app.cli bootstrap-super-admin \
     --username <admin> \
     --password <password>
   ```

   Local dev (from repo):

   ```bash
   cd backend
   uv run python -m app.cli bootstrap-super-admin --username <admin> --password <password>
   ```

5. Open security group: **80**, **443**; **5432** only if needed (prefer IP allowlist).

### GitHub Secrets


| Secret | Purpose |
|--------|---------|
| `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` | Image push and VM pull |
| `DEPLOY_HOST`, `DEPLOY_SSH_PORT`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_PATH` | **SSH only** — CI deploy target (`DEPLOY_HOST` = EC2 IP/hostname; not the public API URL) |
| `CADDY_PUBLIC_HOST` | **Public API + HTTPS** via Let's Encrypt (`pos.durozen.in`) |
| `CADDY_ACME_EMAIL` | Let's Encrypt contact |
| `POSTGRES_PASSWORD` | DB password (must match existing data dir) |
| `POSTGRES_DB`, `POSTGRES_USER` | Optional (`brolier_360` / `postgres`) |
| `RUSTFS_ACCESS_KEY`, `RUSTFS_SECRET_KEY`, `RUSTFS_SERVER_DOMAINS` | Object storage |
| `BACKEND_SECRET_KEY` | JWT secret (32+ chars) |
| `BACKEND_RUSTFS_BUCKET_NAME` | Optional bucket override |

CI generates `BACKEND_ALLOWED_HOSTS` from `CADDY_PUBLIC_HOST` plus internal Docker hostnames (`backend-1`, `backend-2`). `DEPLOY_HOST` is never exposed on Caddy.

### Updating production

| Change | Action |
|--------|--------|
| Backend code / migrations | Push to `prod` with `backend/**` changes → CI migrates + redeploys |
| Caddy / TLS / hostname | Push `caddy/**` or update `CADDY_PUBLIC_HOST` secret |
| Compose / scripts / secrets only | Push deploy-path files — sync without rebuild |
| Mobile API URL | Set `EXPO_PUBLIC_API_BASE_URL=https://<CADDY_PUBLIC_HOST>` in `frontend/.env` (local build) |

Emergency on VM:

```bash
cd /home/ubuntu/brolier360-pos
COMPOSE_PROFILES=infra docker compose -f docker-compose.prod.yml \
  -f docker-compose.prod.override.yml --env-file .env up -d --no-deps backend-1
```

### Logs

| Command | Action |
|---------|--------|
| `~/pos-logs` | Follow all container logs |
| `~/pos-logs backend-1` | One backend replica |
| `~/pos-logs deploy` | Deploy log tail |

On VM: `bash scripts/deploy-prod.sh`, `bash scripts/pos-logs.sh`.

### API URLs

| Context | Health | Docs |
|---------|--------|------|
| Production (HTTPS) | `https://<CADDY_PUBLIC_HOST>/api/v1/health` | `https://<CADDY_PUBLIC_HOST>/docs` |
| LB readiness | `https://<CADDY_PUBLIC_HOST>/health` | — |
| Local dev | `http://127.0.0.1:8000/api/v1/health` | `http://127.0.0.1:8000/docs` |
| Docker internal | `http://backend-1:8000/api/v1/health` | — |

## Database migrations

[`backend/migrate.py`](backend/migrate.py) runs, in order:

1. Legacy item image byte migration to RustFS (if needed)
2. Platform Alembic `upgrade head`
3. Idempotent startup tasks ([`app/db/startup.py`](backend/app/db/startup.py))
4. **All registered tenant schemas** (PostgreSQL only)

| When | How |
|------|-----|
| Production deploy | `deploy-prod.sh` → `migrate` service, then rolling backend-1/backend-2 |
| Container start | Gunicorn only (no auto-migrate) |
| Local dev | `cd backend && uv run python migrate.py` |

### Developer workflow (schema change)

1. Edit models in `backend/app/models/`.
2. `cd backend && uv run alembic revision -m "describe change"`.
3. Edit revision under `backend/migrations/versions/` (platform) or `backend/migrations/tenant/` (tenant DDL).
4. `uv run python migrate.py` locally; run tests.
5. Push to `prod` with `backend/**` changes; confirm deploy health shows `"database":"connected"`.

### Legacy shared-schema → tenant cutover

**Back up first** (`pg_dump`). Then from `backend/`:

```bash
uv run python migrate.py
uv run python -m app.cli migrate-tenant-data --all-legacy --dry-run
uv run python -m app.cli migrate-tenant-data --all-legacy --execute
# optional: --cleanup-public-backups
```

Per-org: `--slug default` or `--org-id <uuid>`. Full runbook: [`docs/postgres.md`](docs/postgres.md).

### Tenant tooling

```bash
cd backend
uv run python migrate.py --tenants-only              # tenants only
uv run python migrate.py --tenants-only --schema tenant_default
uv run python scripts/check_tenant_baseline.py     # CI table-name check
```

## Testing

**CI:** [`.github/workflows/backend-tests.yml`](.github/workflows/backend-tests.yml) — tenant baseline check + unit tests on PR/push to `main`/`prod`.

**Unit tests** (SQLite; no Postgres required):

```bash
cd backend
uv sync
cd .. && PYTHONPATH=backend:. uv run --directory backend \
  python -m unittest discover -s test/unit -p "test_*.py" -v
```

**Integration tests** (Postgres required):

```bash
export TEST_DATABASE_URL=postgresql+asyncpg://postgres:root@localhost:5432/brolier_360_test
cd .. && PYTHONPATH=backend:. uv run --directory backend \
  python -m unittest test.integration.test_schema_provisioning -v
```

**Pytest** (also configured in `pyproject.toml`):

```bash
cd backend
uv run pytest ../test/ -q
```

**Frontend typecheck:**

```bash
cd frontend && npx tsc --noEmit
```

## Direct POS printing

- Android Bluetooth/USB: `@haroldtran/react-native-thermal-printer`
- Expo Go cannot load the native printer module — use a dev or release build
- Web and iOS use print fallback behavior

## Documentation

| Doc | Topic |
|-----|-------|
| [backend/README.md](backend/README.md) | API, env, routes, migrations |
| [frontend/README.md](frontend/README.md) | Expo app, builds, printer setup |
| [docs/postgres.md](docs/postgres.md) | Postgres ops and tenant cutover |
| [docs/decisions/ADR-003-schema-per-tenant.md](docs/decisions/ADR-003-schema-per-tenant.md) | Tenancy architecture |
| [docs/decisions/ADR-002-multi-tenant-tenancy-and-rbac.md](docs/decisions/ADR-002-multi-tenant-tenancy-and-rbac.md) | RBAC and JWT |
| [.env.prod.example](.env.prod.example) | Production env template |

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Invalid host header` | Host not in `ALLOWED_HOSTS` | Set `CADDY_PUBLIC_HOST` secret; redeploy |
| JSON parse error for `allowed_hosts` | Docker stripped quotes in `.env` | Use single-quoted JSON in `.env` (CI does this) |
| `database: disconnected` | Postgres down or wrong password | `~/pos-logs postgres`; verify `POSTGRES_PASSWORD` |
| Login 409 “Organization required” | Username exists in multiple orgs | Pass `organization_slug` on login |
| Tenant 500 “schema not configured” | Org missing `schema_name` | Run data migration or create org via super-admin |
| `DuplicatePreparedStatementError` on bootstrap | CLI used `backend-1` via pgBouncer | Use `compose run --rm migrate python -m app.cli bootstrap-super-admin ...` |
| Cannot reach Postgres from PC | Security group | Allow TCP 5432 for your IP only |
| Caddy / TLS errors | Bad hostname, ACME, or DNS IP drift | `~/pos-logs caddy`; set `CADDY_PUBLIC_HOST` to `pos.durozen.in`; **DNS A record must match EC2 public IP**; use `https://pos.durozen.in/health` |
| Postgres WAL corruption | Unclean shutdown | `scripts/postgres-recover.sh` after stopping postgres |

---

Built by [Durozen Technologies](https://durozen.com).
