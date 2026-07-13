#!/usr/bin/env bash
# One-time VM helper: build /etc/duropos/backup.env from deploy .env
set -euo pipefail

DEPLOY_ENV="${1:-/home/ubuntu/brolier360-pos/.env}"
BACKUP_ENV="${2:-/etc/duropos/backup.env}"

[[ -f "$DEPLOY_ENV" ]] || {
  echo "deploy env not found: $DEPLOY_ENV" >&2
  exit 1
}

set -a
# shellcheck disable=SC1090
source "$DEPLOY_ENV"
set +a

umask 077
cat >"$BACKUP_ENV" <<EOF
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=${POSTGRES_USER:-postgres}
PGPASSWORD=${POSTGRES_PASSWORD:?POSTGRES_PASSWORD missing in deploy env}
PGDATABASE=${POSTGRES_DB:-brolier_360}
RUSTFS_DIR=${RUSTFS_DATA_DIR:-/home/ubuntu/rustfs/data}
GDRIVE_DESTINATION=gdrive:DuroPOS-Backups
BACKUP_RETENTION_DAYS=7
HEALTHCHECK_PING_URL=https://hc-ping.com/00ecbf0e-effd-4d45-8d8b-81ae24b19f48
PG_DOCKER_CONTAINER=brolier360-pos-postgres-1
EOF

chmod 600 "$BACKUP_ENV"
chown root:root "$BACKUP_ENV"
echo "wrote $BACKUP_ENV"
