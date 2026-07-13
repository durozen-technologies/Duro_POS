# DuroPOS Automated Backup — Implementation Plan

Production backup for **PostgreSQL 17** (schema-per-tenant) + **RustFS** object storage, uploaded to **Google Drive** via `rclone`. Runs on the Ubuntu EC2 VM alongside the Docker Compose stack.

---

## Table of Contents

1. [Goals & Scope](#1-goals--scope)
2. [What Gets Backed Up](#2-what-gets-backed-up)
3. [Architecture](#3-architecture)
4. [Production Paths & Env Mapping](#4-production-paths--env-mapping)
5. [Phase 0 — Prerequisites & Decisions](#5-phase-0--prerequisites--decisions)
6. [Phase 1 — Server Dependencies](#6-phase-1--server-dependencies)
7. [Phase 2 — Google Drive (`rclone`)](#7-phase-2--google-drive-rclone)
8. [Phase 3 — Backup Environment File](#8-phase-3--backup-environment-file)
9. [Phase 4 — Backup Script](#9-phase-4--backup-script)
10. [Phase 5 — Restore Script & Runbook](#10-phase-5--restore-script--runbook)
11. [Phase 6 — Cron & Log Rotation](#11-phase-6--cron--log-rotation)
12. [Phase 7 — CI/CD Integration](#12-phase-7--cicd-integration)
13. [Phase 8 — Verification & DR Drill](#13-phase-8--verification--dr-drill)
14. [Phase 9 — Monitoring & Alerting](#14-phase-9--monitoring--alerting)
15. [Operational Runbook](#15-operational-runbook)
16. [Failure Modes & Mitigations](#16-failure-modes--mitigations)
17. [Security Checklist](#17-security-checklist)
18. [Implementation Checklist (Master)](#18-implementation-checklist-master)

---

## 1. Goals & Scope

| Goal | Target |
|------|--------|
| **RPO** (max data loss) | 12 hours (twice-daily backups at 00:00 and 12:00 IST) |
| **RTO** (time to restore) | < 2 hours for full DB + RustFS restore on same VM |
| **Retention** | 7 days on Google Drive (rolling delete) |
| **Coverage** | All tenant schemas + `public` + all RustFS blobs |

### In scope

- PostgreSQL logical dump (`pg_dump -Ft`) of database `brolier_360`
- RustFS bind-mount archive (`/home/ubuntu/rustfs/data`)
- Compressed bundle upload to Google Drive
- Automated schedule, logging, retention cleanup
- Healthchecks.io success/fail pings for monitoring
- Documented restore procedure + one successful DR drill

### Out of scope (v1)

- Redis (no persistence configured — cache rebuilds on restart)
- Point-in-time recovery / WAL archiving
- Cross-region replica
- Mobile device local upload drafts

### Critical coupling

Postgres stores **object key metadata** (`image_object_key`, etc.). RustFS stores **image bytes**. Restore both together or images break even when DB rows exist.

---

## 2. What Gets Backed Up

### Tier 1 — Must backup (business data)

| Asset | Host path | Container | Why |
|-------|-----------|-----------|-----|
| PostgreSQL | `/home/ubuntu/pos-postgress/data` | `postgres:17-alpine` | All orgs, users, bills, inventory, tenant schemas |
| RustFS | `/home/ubuntu/rustfs/data` | `rustfs` | Item/inventory/expense images (full + thumbnails) |

**PostgreSQL contents (schema-per-tenant, ADR-003):**

- `public` — `organizations`, `user_auth_index`, platform users, migrations
- `tenant_<slug>` — per-org operational data (shops, items, bills, etc.)

`pg_dump` against the running DB dumps **all schemas** by default. No extra `--schema` flags needed for v1.

### Tier 2 — Nice to have (operational)

| Asset | Path / location | Notes |
|-------|-----------------|-------|
| VM `.env` | `${DEPLOY_PATH}/.env` (e.g. `/home/ubuntu/brolier360-pos/.env`) | Secrets; back up separately, encrypted |
| Caddy TLS volume | Docker volume `caddy-data` | Faster cert recovery; Caddy can re-issue |
| Deploy logs | `${DEPLOY_PATH}/logs/` | Operational only |

### Tier 3 — Skip

- Redis (`--save ""`, `--appendonly no`)
- SQLite (tests/dev only)
- Docker images (pulled from registry)

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Ubuntu EC2 VM (production)                                     │
│                                                                 │
│  ┌──────────────┐    pg_dump -Ft     ┌─────────────────────┐   │
│  │ postgres     │ ─────────────────► │ /tmp/backup-TS/     │   │
│  │ :5432        │   (localhost)      │   postgres.tar      │   │
│  └──────────────┘                    └──────────┬──────────┘   │
│                                                  │              │
│  ┌──────────────┐    tar -cf                    │              │
│  │ rustfs data  │ ──────────────────────────────►│ rustfs.tar  │
│  │ bind mount   │                                └──────┬──────┘ │
│  └──────────────┘                                       │       │
│                                                         ▼       │
│                                              backup-TS.tar.gz     │
│                                                         │       │
│                                              rclone copy        │
└─────────────────────────────────────────────────────────┼───────┘
                                                          ▼
                                              Google Drive: Backups/
```

**Schedule:** cron as root, `0 0,12 * * *` (midnight + noon server local time — set VM timezone explicitly).

**Auth chain:** root crontab → `/usr/local/bin/backup.sh` → reads `/etc/duropos/backup.env` → `pg_dump` + `tar` + `rclone` → Healthchecks.io ping.

---

## 4. Production Paths & Env Mapping

Align backup config with CI-generated `.env` from `.github/workflows/deploy-prod.yml`:

| Production `.env` key | Backup env key | Production value |
|----------------------|----------------|------------------|
| `POSTGRES_USER` | `PGUSER` | `postgres` |
| `POSTGRES_PASSWORD` | `PGPASSWORD` | (GitHub secret) |
| `POSTGRES_DB` | `PGDATABASE` | `brolier_360` |
| `POSTGRES_PUBLISH_PORT` | `PGPORT` | `5432` |
| — | `PGHOST` | `127.0.0.1` (localhost bind only) |
| `RUSTFS_DATA_DIR` | `RUSTFS_DIR` | `/home/ubuntu/rustfs/data` |
| — | `GDRIVE_DESTINATION` | `gdrive:DuroPOS-Backups` (pick one name) |
| — | `HEALTHCHECK_PING_URL` | `https://hc-ping.com/00ecbf0e-effd-4d45-8d8b-81ae24b19f48` |
| `DEPLOY_PATH` | `ENV_FILE` source | `/home/ubuntu/brolier360-pos/.env` |

**Do not** put backup secrets in the deploy `.env` shipped by CI. Use a dedicated root-owned file:

```text
/etc/duropos/backup.env   # chmod 600, root:root
```

Optionally symlink or source `PGPASSWORD` from deploy `.env` at install time (see Phase 3).

---

## 5. Phase 0 — Prerequisites & Decisions

Complete before touching the production VM.

### 5.1 Decisions (record answers)

| # | Decision | Recommended | Owner |
|---|----------|-------------|-------|
| D1 | GDrive folder name | `DuroPOS-Backups` | Ops |
| D2 | Backup schedule timezone | `Asia/Kolkata` on VM; cron `0 0,12 * * *` | Ops |
| D3 | Retention | 7 days (`rclone delete --min-age 7d`) | Ops |
| D4 | GDrive account | Dedicated service Google account (not personal) | Ops |
| D5 | Alert on failure | [Healthchecks.io](https://healthchecks.io) — ping on success, `/fail` on error | Ops |
| D6 | Separate backup env file | Yes — `/etc/duropos/backup.env` | Ops |

### 5.2 Access required

- [ ] SSH to production VM as `ubuntu` (sudo)
- [ ] Google account with Drive storage (estimate: DB dump + RustFS size × 2 × 14 backups/week)
- [ ] Confirm Postgres port reachable on localhost: `ss -tlnp | grep 5432`

### 5.3 Size estimate (run once on VM)

```bash
# Postgres logical size
docker exec brolier360-pos-postgres-1 psql -U postgres -d brolier_360 -c \
  "SELECT pg_size_pretty(pg_database_size('brolier_360'));"

# RustFS disk usage
du -sh /home/ubuntu/rustfs/data

# Dry-run dump size (optional, during off-peak)
pg_dump -Ft -f /tmp/test-dump.tar -h 127.0.0.1 -U postgres brolier_360
ls -lh /tmp/test-dump.tar && rm /tmp/test-dump.tar
```

Plan GDrive quota: **(postgres_dump + rustfs_raw) × 1.3 compression × 14 retained copies**.

---

## 6. Phase 1 — Server Dependencies

**Where:** production VM  
**When:** one-time  
**Downtime:** none

```bash
sudo apt-get update
sudo apt-get install -y postgresql-client rclone tar cron logrotate
```

Verify:

```bash
pg_dump --version    # must be compatible with PG 17 (client 17.x ideal)
rclone version
```

`postgresql-client` on Ubuntu 24.04 ships PG 16 client — works with PG 17 server for `pg_dump`. If version mismatch warnings appear, install `postgresql-client-17` from PGDG apt repo.

---

## 7. Phase 2 — Google Drive (`rclone`)

**Where:** production VM  
**When:** one-time interactive  
**Downtime:** none

### 7.1 Configure remote

```bash
sudo rclone config
```

Steps:

1. `n` — new remote
2. Name: `gdrive`
3. Storage: `drive` (Google Drive)
4. Client ID / Secret: blank (defaults)
5. Scope: `1` (full access)
6. Service account: blank
7. Advanced: `n`
8. Auto config: `y` — authorize in browser (use SSH port-forward if headless)
9. Team drive: `n`
10. Confirm

Config lands at `/root/.config/rclone/rclone.conf` when run with `sudo`.

### 7.2 Create destination folder & test

```bash
sudo rclone mkdir gdrive:DuroPOS-Backups
echo "test" | sudo rclone rcat gdrive:DuroPOS-Backups/connection-test.txt
sudo rclone ls gdrive:DuroPOS-Backups
sudo rclone delete gdrive:DuroPOS-Backups/connection-test.txt
```

### 7.3 Headless auth (if no browser on VM)

From your laptop:

```bash
ssh -L 53682:127.0.0.1:53682 ubuntu@<VM_IP>
sudo rclone config   # choose auto config; open http://127.0.0.1:53682/ locally
```

---

## 8. Phase 3 — Backup Environment File

**Where:** `/etc/duropos/backup.env`  
**Permissions:** `root:root`, `chmod 600`

```bash
sudo mkdir -p /etc/duropos
sudo tee /etc/duropos/backup.env > /dev/null <<'EOF'
# PostgreSQL (localhost — published by docker-compose prod)
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=postgres
PGPASSWORD=REPLACE_WITH_POSTGRES_PASSWORD
PGDATABASE=brolier_360

# RustFS bind mount
RUSTFS_DIR=/home/ubuntu/rustfs/data

# Google Drive destination (must match rclone remote name)
GDRIVE_DESTINATION=gdrive:DuroPOS-Backups

# Retention
BACKUP_RETENTION_DAYS=7

# Healthchecks.io — success ping; script appends /fail on error
HEALTHCHECK_PING_URL=https://hc-ping.com/00ecbf0e-effd-4d45-8d8b-81ae24b19f48
EOF

sudo chmod 600 /etc/duropos/backup.env
sudo chown root:root /etc/duropos/backup.env
```

Populate `PGPASSWORD` from production deploy `.env`:

```bash
grep '^POSTGRES_PASSWORD=' /home/ubuntu/brolier360-pos/.env
# paste into backup.env — never commit this file
```

Verify DB connectivity:

```bash
set -a; source /etc/duropos/backup.env; set +a
PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -c 'SELECT 1'
```

---

## 9. Phase 4 — Backup Script

### 9.1 Repo file (version-controlled)

Create `scripts/backup.sh` in the repo (deployed via CI). Install to `/usr/local/bin/backup.sh` on VM.

```bash
#!/usr/bin/env bash
# DuroPOS production backup: PostgreSQL + RustFS → tar.gz → Google Drive
set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/duropos/backup.env}"
LOG_FILE="${LOG_FILE:-/var/log/duropos-backup.log}"
RETRIES="${RETRIES:-3}"
TIMESTAMP="$(date +%Y-%m-%d-%H-%M)"
WORK_DIR="/tmp/duropos-backup-${TIMESTAMP}"
ARCHIVE_NAME="duropos-backup-${TIMESTAMP}.tar.gz"
ARCHIVE_PATH="/tmp/${ARCHIVE_NAME}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"

log()  { echo "[$(date -Iseconds)] $*" | tee -a "$LOG_FILE"; }
warn() { log "WARN: $*"; }
fail() { log "ERROR: $*"; notify_failure "$*"; exit 1; }

healthcheck_ping() {
  local url="$1"
  curl -m 10 --retry 5 -fsS -o /dev/null "$url" || warn "Healthchecks ping failed: ${url}"
}

notify_failure() {
  local msg="$1"
  if [[ -n "${HEALTHCHECK_PING_URL:-}" ]]; then
    healthcheck_ping "${HEALTHCHECK_PING_URL}/fail"
  fi
}

if [[ -f "$ENV_FILE" ]]; then
  set -a; # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  fail ".env not found at $ENV_FILE"
fi

: "${PGHOST:?}" "${PGPORT:?}" "${PGUSER:?}" "${PGPASSWORD:?}" "${PGDATABASE:?}"
: "${RUSTFS_DIR:?}" "${GDRIVE_DESTINATION:?}"

export PGPASSWORD

cleanup() {
  rm -rf "${WORK_DIR}" "${ARCHIVE_PATH}"
  log "Temp files deleted."
}
trap cleanup EXIT

log "--- Backup start: ${TIMESTAMP} ---"
mkdir -p "${WORK_DIR}"

# 1. PostgreSQL dump (tar format — supports parallel pg_restore)
log "Dumping PostgreSQL (${PGDATABASE})..."
dump_ok=false
for i in $(seq 1 "$RETRIES"); do
  if pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -Ft -f "${WORK_DIR}/postgres.tar" "$PGDATABASE"; then
    dump_ok=true
    break
  fi
  warn "pg_dump attempt ${i}/${RETRIES} failed; retrying in 5s..."
  sleep 5
done
[[ "$dump_ok" == true ]] || fail "PostgreSQL dump failed after ${RETRIES} attempts."

# 2. RustFS archive
log "Archiving RustFS (${RUSTFS_DIR})..."
[[ -d "$RUSTFS_DIR" ]] || fail "RustFS directory not found: ${RUSTFS_DIR}"
tar -cf "${WORK_DIR}/rustfs.tar" -C "$RUSTFS_DIR" . || fail "RustFS tar failed."

# 3. Write manifest (aids restore verification)
cat > "${WORK_DIR}/manifest.txt" <<MANIFEST
timestamp=${TIMESTAMP}
pgdatabase=${PGDATABASE}
pghost=${PGHOST}
rustfs_dir=${RUSTFS_DIR}
postgres_tar_bytes=$(stat -c%s "${WORK_DIR}/postgres.tar")
rustfs_tar_bytes=$(stat -c%s "${WORK_DIR}/rustfs.tar")
hostname=$(hostname)
MANIFEST

# 4. Compress bundle
log "Compressing archive..."
tar -czf "$ARCHIVE_PATH" -C "${WORK_DIR}" postgres.tar rustfs.tar manifest.txt \
  || fail "Compression failed."

archive_bytes=$(stat -c%s "$ARCHIVE_PATH")
log "Archive size: ${archive_bytes} bytes"

# 5. Upload to Google Drive
log "Uploading to ${GDRIVE_DESTINATION}..."
upload_ok=false
for i in $(seq 1 "$RETRIES"); do
  if rclone copy "$ARCHIVE_PATH" "$GDRIVE_DESTINATION" --contimeout 60s --timeout 0; then
    upload_ok=true
    break
  fi
  warn "Upload attempt ${i}/${RETRIES} failed; retrying in 10s..."
  sleep 10
done
[[ "$upload_ok" == true ]] || fail "Upload failed after ${RETRIES} attempts."

# 6. Verify remote copy
log "Verifying upload..."
rclone check "$ARCHIVE_PATH" "${GDRIVE_DESTINATION}/${ARCHIVE_NAME}" \
  || fail "Upload verification failed."

# 7. Retention cleanup
log "Deleting backups older than ${RETENTION_DAYS}d..."
rclone delete "$GDRIVE_DESTINATION" --min-age "${RETENTION_DAYS}d" || warn "Retention cleanup failed."

log "--- Backup success: ${TIMESTAMP} (${ARCHIVE_NAME}) ---"

# 8. Healthchecks.io success ping
if [[ -n "${HEALTHCHECK_PING_URL:-}" ]]; then
  log "Pinging Healthchecks..."
  healthcheck_ping "$HEALTHCHECK_PING_URL"
fi
```

### 9.2 Install on VM

```bash
sudo cp /home/ubuntu/brolier360-pos/scripts/backup.sh /usr/local/bin/backup.sh
sudo chmod 750 /usr/local/bin/backup.sh
sudo chown root:root /usr/local/bin/backup.sh
```

### 9.3 Manual test run

```bash
sudo /usr/local/bin/backup.sh
sudo tail -50 /var/log/duropos-backup.log
sudo rclone ls gdrive:DuroPOS-Backups | tail -5
```

**Success criteria:**

- [ ] Exit code 0
- [ ] `duropos-backup-*.tar.gz` appears on GDrive
- [ ] `rclone check` passes
- [ ] Log shows postgres + rustfs sizes
- [ ] Temp files removed from `/tmp`
- [ ] Healthchecks.io shows successful ping

### 9.4 Healthchecks.io setup

Create check at [healthchecks.io](https://healthchecks.io) (or use existing):

| Setting | Value |
|---------|-------|
| Name | `DuroPOS Backup` |
| Schedule | every 12 hours |
| Grace time | 1 hour (covers cron drift + long uploads) |

Ping URL (already assigned):

```text
https://hc-ping.com/00ecbf0e-effd-4d45-8d8b-81ae24b19f48
```

Test manually from VM:

```bash
# success
curl -m 10 --retry 5 https://hc-ping.com/00ecbf0e-effd-4d45-8d8b-81ae24b19f48

# failure (optional — triggers alert in Healthchecks dashboard)
curl -m 10 --retry 5 https://hc-ping.com/00ecbf0e-effd-4d45-8d8b-81ae24b19f48/fail
```

Script behavior:

- **Success** — `curl -m 10 --retry 5` to base URL after upload verify + retention
- **Failure** — `fail()` posts to `{HEALTHCHECK_PING_URL}/fail` before exit
- Ping errors logged as WARN only — backup result not affected

Configure Healthchecks notifications (email/Slack/Telegram) in dashboard — no extra webhook in backup script needed.

### 9.5 Improvements over original draft

| Item | Change | Reason |
|------|--------|--------|
| Env path | `/etc/duropos/backup.env` not deploy `.env` | Secrets isolation; deploy `.env` owned by ubuntu |
| Archive prefix | `duropos-backup-*` | Clear identification |
| Manifest | `manifest.txt` inside archive | Restore verification |
| `rclone check` | Compare specific remote file | Original checked directory, not file |
| `PGPASSWORD` export | Explicit | `pg_dump` needs it |
| Healthchecks.io | `HEALTHCHECK_PING_URL` — success ping + `/fail` | Phase 9 alerting via dashboard |
| Log path | `/var/log/duropos-backup.log` | Namespaced |

---

## 10. Phase 5 — Restore Script & Runbook

### 10.1 When to restore

- Data corruption, accidental deletion, failed migration
- VM rebuild after disaster
- **Not** for `postgres-recover.sh` scenarios (WAL corruption) — that script is last resort without backup

### 10.2 Pre-restore checklist

- [ ] Identify backup timestamp: `rclone ls gdrive:DuroPOS-Backups`
- [ ] Schedule maintenance window (app down 15–60 min depending on size)
- [ ] Notify users
- [ ] Stop app tier first (keep infra up or down depending on restore type)

```bash
cd /home/ubuntu/brolier360-pos
docker compose -f docker-compose.prod.yml --env-file .env stop backend-1 backend-2 caddy
# For full RustFS replace, also stop rustfs:
# docker compose -f docker-compose.prod.yml --env-file .env stop rustfs
```

### 10.3 Download & extract

```bash
BACKUP=duropos-backup-YYYY-MM-DD-HH-MM.tar.gz   # pick from rclone ls

sudo rclone copy "gdrive:DuroPOS-Backups/${BACKUP}" /tmp/
cd /tmp
tar -xzf "${BACKUP}"
cat manifest.txt
```

### 10.4 Restore PostgreSQL

**Option A — Logical restore (recommended, from `pg_dump` tar)**

```bash
set -a; source /etc/duropos/backup.env; set +a
export PGPASSWORD

# Drop and recreate DB (destructive — maintenance window required)
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres <<SQL
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${PGDATABASE}' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS ${PGDATABASE};
CREATE DATABASE ${PGDATABASE};
SQL

pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
  --no-owner --no-acl -1 /tmp/postgres.tar
```

**Option B — Full data-dir replace (only if using filesystem backup — not v1)**

Not used in v1. Stick to `pg_restore`.

Verify:

```bash
psql -h 127.0.0.1 -U postgres -d brolier_360 -c "\dn"    # list tenant schemas
psql -h 127.0.0.1 -U postgres -d brolier_360 -c "SELECT count(*) FROM public.organizations;"
```

### 10.5 Restore RustFS

```bash
set -a; source /etc/duropos/backup.env; set +a

docker compose -f /home/ubuntu/brolier360-pos/docker-compose.prod.yml \
  --env-file /home/ubuntu/brolier360-pos/.env stop rustfs

# Preserve current data (optional safety)
sudo mv "$RUSTFS_DIR" "${RUSTFS_DIR}.bak.$(date +%s)"

sudo mkdir -p "$RUSTFS_DIR"
sudo tar -xf /tmp/rustfs.tar -C "$RUSTFS_DIR"
sudo chown -R 10001:10001 "$RUSTFS_DIR"   # rustfs container UID

docker compose -f /home/ubuntu/brolier360-pos/docker-compose.prod.yml \
  --env-file /home/ubuntu/brolier360-pos/.env start rustfs
```

### 10.6 Bring app back

```bash
cd /home/ubuntu/brolier360-pos
docker compose -f docker-compose.prod.yml --env-file .env up -d
# verify health endpoints, spot-check image load in UI
```

### 10.7 Restore script (repo: `scripts/restore-backup.sh`)

Ship a companion script that automates 10.3–10.6 with `--backup NAME` and `--pg-only` / `--rustfs-only` flags. Implement after first manual drill confirms steps.

---

## 11. Phase 6 — Cron & Log Rotation

### 11.1 Cron (root)

```bash
sudo crontab -e
```

```cron
# DuroPOS backup — midnight and noon (server local time)
0 0,12 * * * /usr/local/bin/backup.sh >> /var/log/duropos-backup-cron.log 2>&1
```

Confirm VM timezone:

```bash
timedatectl
# if needed: sudo timedatectl set-timezone Asia/Kolkata
```

### 11.2 Log rotation

Create `/etc/logrotate.d/duropos-backup`:

```text
/var/log/duropos-backup.log
/var/log/duropos-backup-cron.log {
    monthly
    rotate 6
    compress
    delaycompress
    missingok
    notifempty
    create 0640 root adm
}
```

Test:

```bash
sudo logrotate -d /etc/logrotate.d/duropos-backup
```

---

## 12. Phase 7 — CI/CD Integration

Today `deploy-prod.yml` ships:

- `scripts/deploy-prod.sh`
- `scripts/pos-logs.sh`
- `scripts/postgres-recover.sh`

**Add to deploy bundle:**

1. `scripts/backup.sh` — version-controlled backup logic
2. Optionally `scripts/restore-backup.sh`

### 12.1 Changes to `.github/workflows/deploy-prod.yml`

In the `tar`/`scp` file list (~line 452), add:

```text
scripts/backup.sh
```

In the remote `chmod` line (~line 490):

```bash
chmod +x scripts/deploy-prod.sh scripts/pos-logs.sh scripts/postgres-recover.sh scripts/backup.sh
```

### 12.2 Post-deploy hook on VM (one-time / documented)

CI deploys repo copy; root install path stays separate:

```bash
sudo cp "${DEPLOY_PATH}/scripts/backup.sh" /usr/local/bin/backup.sh
sudo chmod 750 /usr/local/bin/backup.sh
```

**Do not** overwrite `/etc/duropos/backup.env` on deploy — it is server-local secrets.

### 12.3 Document in `docs/postgres.md`

Add cross-link: "Production backups: `scripts/backup-system.md`"

---

## 13. Phase 8 — Verification & DR Drill

Run within 1 week of go-live.

### 13.1 Backup verification (non-destructive)

```bash
# Latest archive
LATEST=$(sudo rclone lsf gdrive:DuroPOS-Backups --files-only | sort | tail -1)
sudo rclone copy "gdrive:DuroPOS-Backups/${LATEST}" /tmp/dr-test/
cd /tmp/dr-test && tar -xzf "$LATEST"
pg_restore -l postgres.tar | head -20    # list contents without restoring
tar -tf rustfs.tar | head -20
```

### 13.2 Full DR drill (staging or maintenance window)

1. Provision temp VM or use maintenance window
2. Install Docker Compose stack
3. Restore latest backup
4. Verify:
   - [ ] Login works
   - [ ] Tenant data visible
   - [ ] Item images load (RustFS + DB keys match)
   - [ ] Bill PDF/receipt generation works
5. Record actual RTO
6. Document issues

### 13.3 Quarterly repeat

Calendar reminder to re-run DR drill and rotate GDrive service account credentials if needed.

---

## 14. Phase 9 — Monitoring & Alerting

### 14.1 Healthchecks.io (primary)

| Event | Action |
|-------|--------|
| Backup success | `curl -m 10 --retry 5 $HEALTHCHECK_PING_URL` |
| Backup failure | `curl -m 10 --retry 5 ${HEALTHCHECK_PING_URL}/fail` |
| Missed schedule | Healthchecks alerts if no success ping within grace window |

**Dashboard setup:**

1. Check schedule: **every 12 hours**, grace **1 hour**
2. Wire notifications: email / Slack / Telegram in Healthchecks project settings
3. Confirm ping after first manual backup run

**Verify:**

```bash
grep 'Pinging Healthchecks' /var/log/duropos-backup.log
# dashboard should show "Last ping: N minutes ago"
```

### 14.2 Secondary signals

| Signal | How |
|--------|-----|
| Backup ran | `grep 'Backup success' /var/log/duropos-backup.log` |
| Backup failed | Healthchecks `/fail` ping + non-zero exit in cron log |
| Local audit | `sudo tail -50 /var/log/duropos-backup.log` |

Healthchecks covers stale/missed backups — no separate stale-check cron needed for v1.

### 14.3 Future

- Prometheus node exporter + alert on cron exit code
- GDrive storage quota alert
- Backup duration trend (log parsing)

---

## 15. Operational Runbook

### Run backup manually

```bash
sudo /usr/local/bin/backup.sh
```

### List remote backups

```bash
sudo rclone ls gdrive:DuroPOS-Backups
```

### Download specific backup

```bash
sudo rclone copy gdrive:DuroPOS-Backups/duropos-backup-YYYY-MM-DD-HH-MM.tar.gz /tmp/
```

### Test Healthchecks ping

```bash
curl -m 10 --retry 5 https://hc-ping.com/00ecbf0e-effd-4d45-8d8b-81ae24b19f48
```

### Pause backups (maintenance)

```bash
sudo crontab -e   # comment out the backup line
```

### Change retention

Edit `/etc/duropos/backup.env` → `BACKUP_RETENTION_DAYS=N`, no redeploy needed.

---

## 16. Failure Modes & Mitigations

| Failure | Symptom | Mitigation |
|---------|---------|------------|
| `pg_dump` auth fail | ERROR in log, exit 1 | Check `PGPASSWORD` in backup.env; test `psql` |
| `pg_dump` lock timeout | Retry exhausted | Run during low traffic; check long transactions |
| RustFS dir missing | ERROR: directory not found | Verify `RUSTFS_DATA_DIR` bind mount |
| `rclone` token expired | Upload fail | Re-run `sudo rclone config reconnect gdrive:` |
| GDrive quota full | Upload fail | Free space; increase retention pruning |
| Disk full on `/tmp` | tar/gzip fail | Ensure `/tmp` has 2× (DB+RustFS) free space |
| Backup during deploy | Possible inconsistency | Avoid overlap; deploys are short — low risk for logical dump |
| Partial upload | `rclone check` fails | Script exits non-zero; `/fail` ping; old backups retained |
| Healthchecks ping fail | WARN in log | Backup still succeeds; check VM outbound HTTPS |
| Missed cron | No ping in 13h | Healthchecks alerts via dashboard notifications |

**Note:** Logical `pg_dump` on a live system is crash-consistent enough for this app tier. For stricter consistency, stop backend containers during dump (increases RTO impact — optional flag `BACKUP_QUIET_MODE=true` future work).

---

## 17. Security Checklist

- [ ] `/etc/duropos/backup.env` is `600`, owned by root
- [ ] `rclone.conf` is root-only (`/root/.config/rclone/`)
- [ ] GDrive uses dedicated account with minimum sharing
- [ ] Backup archives contain DB password hash data — GDrive folder not shared publicly
- [ ] Cron runs as root (needs postgres client + rclone config)
- [ ] No secrets in git — `backup.sh` reads env file only
- [ ] SSH access to VM restricted; backup files on GDrive encrypted at rest by Google
- [ ] Healthchecks ping URL treated as secret — only in `/etc/duropos/backup.env`, not git

---

## 18. Implementation Checklist (Master)

### One-time setup

- [ ] **Phase 0** — Decisions recorded (D1–D6)
- [ ] **Phase 0** — Size estimate completed
- [ ] **Phase 1** — `postgresql-client`, `rclone`, `cron`, `logrotate` installed
- [ ] **Phase 2** — `rclone` remote `gdrive` configured and tested
- [ ] **Phase 3** — `/etc/duropos/backup.env` created and `psql` test passes
- [ ] **Phase 4** — `scripts/backup.sh` added to repo
- [ ] **Phase 4** — Installed to `/usr/local/bin/backup.sh`
- [ ] **Phase 4** — Manual backup succeeds; file on GDrive
- [ ] **Phase 6** — Root crontab added
- [ ] **Phase 6** — Logrotate config created
- [ ] **Phase 7** — `backup.sh` added to CI deploy bundle
- [ ] **Phase 8** — DR drill completed; RTO recorded
- [ ] **Phase 9** — Healthchecks.io check created (12h schedule, 1h grace)
- [ ] **Phase 9** — Healthchecks notifications wired (email/Slack)
- [ ] **Phase 9** — Success ping verified after first manual backup

### Recurring

- [ ] Weekly: spot-check Healthchecks dashboard + `/var/log/duropos-backup.log`
- [ ] Monthly: verify GDrive quota and backup count
- [ ] Quarterly: full restore drill

### Repo deliverables

| File | Action |
|------|--------|
| `scripts/backup.sh` | **Create** — main backup script |
| `scripts/restore-backup.sh` | **Create** (optional v1.1) — guided restore |
| `scripts/backup-system.md` | **This document** — plan + runbook |
| `.github/workflows/deploy-prod.yml` | **Edit** — ship `backup.sh` |
| `docs/postgres.md` | **Edit** — link to backup docs |

---

## Appendix A — Quick Reference (original commands)

### Install deps

```bash
sudo apt-get update
sudo apt-get install -y postgresql-client rclone tar cron
```

### rclone config summary

Remote name: `gdrive` · Type: Google Drive · Scope: full access

### Legacy env example (do not use on prod — use `/etc/duropos/backup.env`)

```env
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=postgres
PGPASSWORD=...
PGDATABASE=brolier_360
RUSTFS_DIR=/home/ubuntu/rustfs/data
GDRIVE_DESTINATION=gdrive:DuroPOS-Backups
HEALTHCHECK_PING_URL=https://hc-ping.com/00ecbf0e-effd-4d45-8d8b-81ae24b19f48
```

### Cron

```cron
0 0,12 * * * /usr/local/bin/backup.sh >> /var/log/duropos-backup-cron.log 2>&1
```

### Restore (short)

```bash
rclone copy gdrive:DuroPOS-Backups/duropos-backup-YYYY-MM-DD-HH-MM.tar.gz /tmp/
cd /tmp && tar -xzf duropos-backup-YYYY-MM-DD-HH-MM.tar.gz
set -a; source /etc/duropos/backup.env; set +a
pg_restore -h 127.0.0.1 -U postgres -d brolier_360 --no-owner --no-acl -1 postgres.tar
sudo tar -xf rustfs.tar -C /home/ubuntu/rustfs/data
```
