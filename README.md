# Billing System

Mobile-first meat billing system with:

- a FastAPI backend for auth, shops, pricing, billing, receipts, audit logs, and item images
- an Expo React Native frontend for admin and shop operators
- Android Bluetooth and USB ESC/POS receipt printing
- a Caddy reverse proxy with automatic HTTPS

## Apps

- `backend/` - FastAPI API, database access, RustFS integration
- `frontend/` - Expo React Native app
- `caddy/` - reverse proxy, rate limiting, DuckDNS DNS-challenge TLS
- `rustfs/` - optional object storage container helpers
- `duckdns/` - local DuckDNS update script used for cron-based IP refresh

## Product Flow

1. Admin signs in.
2. Admin creates shop users.
3. Each shop sets daily prices.
4. Counter staff add items and checkout.
5. Backend accepts a sale only when payment totals match the bill.
6. Receipt printing runs through saved Bluetooth or USB printers on Android, with fallback printing on web and iOS.
7. Receipt data and audit logs are stored immediately.

## Tech Stack

- Backend: FastAPI, SQLAlchemy async, PostgreSQL, JWT auth, `uv`
- Frontend: Expo 54, React Native, TypeScript, Zustand, React Navigation, NativeWind
- Proxy: Caddy 2 with `caddy-ratelimit` and `caddy-dns/duckdns`
- Storage: RustFS / S3-compatible object storage

## Repository Layout

```text
.
├── backend/
├── frontend/
├── caddy/
├── rustfs/
├── duckdns/
├── compose.yaml
├── docker-compose.prod.yml
├── Makefile
└── README.md
```

## Prerequisites

- Python `3.11+`
- `uv`
- Node.js `18+`
- npm
- Docker and Docker Compose
- PostgreSQL if running backend outside Docker
- Android emulator, device, iOS simulator, or browser for the frontend

## Local Backend

```bash
cd backend
cp .env.example .env
uv sync
uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Useful backend commands:

```bash
cd backend
uv sync --group dev
uv run ruff check .
uv run ruff format .
uv run --with pytest pytest ../test/ -v
```

## Local Frontend

```bash
cd frontend
npm install
npx expo start
```

For the Android dev client and printer workflow:

```bash
cd frontend
npx expo run:android
npm run start:dev
```

If the backend runs on the same machine and the frontend is on a physical Android phone:

```bash
adb reverse tcp:8000 tcp:8000
```

## Docker Stack

The active Docker stack is [`compose.yaml`](compose.yaml).

Services:

- `backend`
- `caddy`

The current Caddy stack publishes:

- `80:80`
- `443:443`
- `443:443/udp`

Start it with:

```bash
docker compose -f compose.yaml up -d --build --remove-orphans
```

Or use the Makefile:

```bash
make docker-up
make docker-logs
make docker-down
```

The Makefile also supports selecting a different compose file:

```bash
make docker-up COMPOSE_FILE=docker-compose.prod.yml
```

## Production deployment (VM + Docker Hub + GitHub Actions)

Production uses [`docker-compose.prod.yml`](docker-compose.prod.yml) with **pre-built images** from Docker Hub (no source build on the VM).

| Service | Image | Restarts on routine deploy |
|---------|-------|----------------------------|
| `postgres` | `postgres:17-alpine` | No |
| `rustfs` | `rustfs/rustfs:latest` | No |
| `backend` | `DOCKERHUB_USERNAME/mahalakshmi-pos-backend:IMAGE_TAG` | Yes |
| `caddy` | `DOCKERHUB_USERNAME/mahalakshmi-pos-caddy:IMAGE_TAG` | Yes |

Data bind mounts (preserve existing VM data):

- Postgres: `/home/ubuntu/pos-postgress/data`
- RustFS: `/home/ubuntu/rustfs/data`

### One-time VM setup

1. Stop old standalone containers: `docker stop rustfs_container postgres_pos || true`
2. Create deploy directory (e.g. `/home/ubuntu/mahalakshmi-pos`)
3. Copy [`.env.prod.example`](.env.prod.example) to `.env` and fill values
4. Bootstrap infra once:

   ```bash
   COMPOSE_PROFILES=infra docker compose -f docker-compose.prod.yml --env-file .env up -d
   ```

### Routine deploy behavior

- **Postgres / RustFS**: not pulled, not restarted if already healthy
- **Backend / Caddy**: image pulled and recreated only
- **Migrations**: `python migrate.py` runs before the backend server starts (schema + column fixes)

### CI/CD

- [`.github/workflows/deploy-prod.yml`](.github/workflows/deploy-prod.yml)
- **Path triggers** on `main` only when these change:
  - `backend/**` → build + deploy **backend** only
  - `caddy/**` → build + deploy **caddy** only
  - `docker-compose.prod.yml`, `scripts/**`, workflow → deploy/sync only (no image rebuild)
- **Manual run**: choose `build_backend` / `build_caddy`, or **skip_build** to pull existing tags
- All services share Docker network **`mahalakshmi-pos-network`**

### Postgres WAL corruption

If Postgres logs show `invalid checkpoint record` / `could not locate a valid checkpoint record`, the data directory has WAL corruption (often from an unclean shutdown or copying data while Postgres was running).

1. Stop postgres: `docker compose -f docker-compose.prod.yml stop postgres`
2. On the VM, run: `bash scripts/postgres-recover.sh` (runs `pg_resetwal` after confirmation)
3. Start postgres: `COMPOSE_PROFILES=infra docker compose -f docker-compose.prod.yml --env-file .env up -d postgres`
4. Check: `~/pos-logs postgres`

If recovery fails or data is unimportant, move the old directory aside and init fresh:

```bash
mv /home/ubuntu/pos-postgress/data /home/ubuntu/pos-postgress/data.bak.$(date +%s)
mkdir -p /home/ubuntu/pos-postgress/data
COMPOSE_PROFILES=infra docker compose -f docker-compose.prod.yml --env-file .env up -d postgres
```

### GitHub Secrets

| Secret | Used for |
|--------|----------|
| `DOCKERHUB_USERNAME` | Image namespace |
| `DOCKERHUB_TOKEN` | Docker Hub login (build + VM pull) |
| `DEPLOY_HOST` | VM IP or hostname |
| `DEPLOY_USER` | SSH user (e.g. `ubuntu`) |
| `DEPLOY_SSH_KEY` | SSH private key (PEM) |
| `DEPLOY_PATH` | Deploy dir (e.g. `/home/ubuntu/mahalakshmi-pos`) |
| `POSTGRES_PASSWORD` | Database |
| `POSTGRES_DB`, `POSTGRES_USER` | Optional overrides |
| `RUSTFS_ACCESS_KEY`, `RUSTFS_SECRET_KEY` | Object storage |
| `RUSTFS_SERVER_DOMAINS` | RustFS console domain (e.g. `1.2.3.4:9001`) |
| `BACKEND_SECRET_KEY` | 32+ char JWT secret (`PRODUCTION=True`) |
| `CADDY_PUBLIC_HOST` | Primary API hostname (e.g. EC2 public DNS) — Caddy TLS + backend allowed host |
| `CADDY_DUCKDNS_HOST` | Optional second hostname (DuckDNS) |
| `BACKEND_ALLOWED_HOSTS` | Optional JSON override; CI auto-builds from `CADDY_PUBLIC_HOST` (+ DuckDNS if set) |
| `CADDY_ACME_EMAIL` | Let's Encrypt contact email |
| `DUCKDNS_API_TOKEN` | Required only when `CADDY_DUCKDNS_HOST` is set |
| `BACKEND_RUSTFS_BUCKET_NAME` | Optional |

### Logs from VM home directory

After deploy, symlinks are created in the deploy user's home:

| Command | Action |
|---------|--------|
| `~/pos-logs` | Follow all container logs |
| `~/pos-logs backend` | Follow one service |
| `~/pos-logs export` | Write logs to `~/mahalakshmi-pos/logs/*.log` |
| `~/pos-logs tail backend` | `tail -f` exported log file |
| `~/pos-logs deploy` | Tail `logs/deploy.log` (deploy history) |

```bash
make docker-prod-deploy   # run deploy script locally on VM
make docker-prod-logs
```

## HTTPS

Caddy config is generated at container start from [`caddy/Caddyfile.template`](caddy/Caddyfile.template) using `CADDY_PUBLIC_HOST` and optional `CADDY_DUCKDNS_HOST` (from GitHub Secrets → VM `.env`).

- Primary host: HTTP-01 / automatic TLS via Let's Encrypt
- Optional DuckDNS host: DNS-01 challenge when `CADDY_DUCKDNS_HOST` + `DUCKDNS_API_TOKEN` are set

Required GitHub Secrets:

```env
CADDY_PUBLIC_HOST=ec2-xx-xx-xx-xx.region.compute.amazonaws.com
CADDY_ACME_EMAIL=your-email@example.com
# Optional:
CADDY_DUCKDNS_HOST=pos-mlb.duckdns.org
DUCKDNS_API_TOKEN=your-duckdns-token
```

Bring Caddy up or rebuild it after config changes:

```bash
docker compose -f compose.yaml up -d --build caddy
```

## DuckDNS

The repository includes [`duckdns/duck.sh`](duckdns/duck.sh), which updates the `pos-mlb` DuckDNS record.

The installed host-side script path is:

```text
/home/sachinn-p/duckdns/duck.sh
```

Typical cron entry:

```cron
*/5 * * * * /home/sachinn-p/duckdns/duck.sh >/dev/null 2>&1
```

Check the updater log with:

```bash
cat /home/sachinn-p/duckdns/duck.log
```

Important:

- if you hard-code the IP in the script, keep it aligned with your real public IP
- if your network auto-detection returns a private `10.x.x.x` address, do not use blank `ip=` mode

## DNS Notes

Public DNS and local DNS may differ.

Useful checks:

```bash
dig +short pos-mlb.duckdns.org @1.1.1.1
dig +short pos-mlb.duckdns.org @8.8.8.8
resolvectl query pos-mlb.duckdns.org
```

If public DNS is correct but this laptop still resolves the hostname to a stale private address, add a local hosts override:

```bash
echo '127.0.0.1 pos-mlb.duckdns.org' | sudo tee -a /etc/hosts
sudo resolvectl flush-caches
```

## API URLs

Direct backend:

- `http://127.0.0.1:8000`
- `http://127.0.0.1:8000/api/v1/health`
- `http://127.0.0.1:8000/docs`

Through Caddy:

- `https://pos-mlb.duckdns.org`
- `https://pos-mlb.duckdns.org/docs`
- `https://pos-mlb.duckdns.org/api/v1/health`

Internal Docker upstream:

- `http://backend:8000`

## Direct POS Printing

- Bluetooth and USB ESC/POS printing use `@haroldtran/react-native-thermal-printer`
- Expo Go cannot load the printer module
- use an Android dev build or release build for live printer testing
- web and iOS use print fallback behavior

## Testing

Backend tests:

```bash
cd backend
uv run --with pytest pytest ../test/ -v
```

Coverage:

```bash
cd backend
uv run --with pytest --with pytest-cov pytest ../test/ --cov=app --cov-report=html
```

## Helpful Commands

```bash
make docker-config
make docker-up
make docker-logs
make docker-down
make frontend-typecheck
make backend-test
```

## App Documentation

- Backend notes: [backend/README.md](backend/README.md)
- Frontend notes: [frontend/README.md](frontend/README.md)
