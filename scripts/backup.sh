#!/usr/bin/env bash
# DuroPOS production backup: PostgreSQL + RustFS -> tar.gz -> Google Drive
set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/duropos/backup.env}"
DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-/home/ubuntu/brolier360-pos/.env}"
LOG_FILE="${LOG_FILE:-/var/log/duropos-backup.log}"
RETRIES="${RETRIES:-3}"
TIMESTAMP="$(date +%Y-%m-%d-%H-%M)"
WORK_DIR="/tmp/duropos-backup-${TIMESTAMP}"
ARCHIVE_NAME="duropos-backup-${TIMESTAMP}.tar.gz"
ARCHIVE_PATH="/tmp/${ARCHIVE_NAME}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
PG_DOCKER_CONTAINER="${PG_DOCKER_CONTAINER:-}"

log() {
  echo "[$(date -Iseconds)] $*" | tee -a "$LOG_FILE"
}

warn() {
  log "WARN: $*"
}

healthcheck_ping() {
  local url="$1"
  curl -m 10 --retry 5 -fsS -o /dev/null "$url" || warn "Healthchecks ping failed: ${url}"
}

notify_failure() {
  if [[ -n "${HEALTHCHECK_PING_URL:-}" ]]; then
    healthcheck_ping "${HEALTHCHECK_PING_URL}/fail"
  fi
}

fail() {
  echo "[$(date -Iseconds)] ERROR: $*" | tee -a "$LOG_FILE" >&2
  notify_failure
  exit 1
}

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  fail "env file not found at $ENV_FILE"
fi

# ponytail: fallback when backup.env was generated with empty PGPASSWORD (local-shell expansion bug).
if [[ -z "${PGPASSWORD:-}" && -f "$DEPLOY_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$DEPLOY_ENV_FILE"
  set +a
  PGPASSWORD="${PGPASSWORD:-${POSTGRES_PASSWORD:-}}"
  PGUSER="${PGUSER:-${POSTGRES_USER:-}}"
  PGDATABASE="${PGDATABASE:-${POSTGRES_DB:-}}"
  RUSTFS_DIR="${RUSTFS_DIR:-${RUSTFS_DATA_DIR:-}}"
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

run_pg_dump() {
  local output_file="$1"
  if [[ -n "$PG_DOCKER_CONTAINER" ]]; then
    docker exec -e PGPASSWORD="$PGPASSWORD" "$PG_DOCKER_CONTAINER" \
      pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -Ft "$PGDATABASE" >"$output_file"
  else
    pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -Ft -f "$output_file" "$PGDATABASE"
  fi
}

log "Dumping PostgreSQL (${PGDATABASE})..."
dump_ok=false
for i in $(seq 1 "$RETRIES"); do
  if run_pg_dump "${WORK_DIR}/postgres.tar"; then
    dump_ok=true
    break
  fi
  warn "pg_dump attempt ${i}/${RETRIES} failed; retrying in 5s..."
  sleep 5
done
[[ "$dump_ok" == true ]] || fail "PostgreSQL dump failed after ${RETRIES} attempts."

log "Archiving RustFS (${RUSTFS_DIR})..."
[[ -d "$RUSTFS_DIR" ]] || fail "RustFS directory not found: ${RUSTFS_DIR}"
tar -cf "${WORK_DIR}/rustfs.tar" -C "$RUSTFS_DIR" . || fail "RustFS tar failed."

cat >"${WORK_DIR}/manifest.txt" <<MANIFEST
timestamp=${TIMESTAMP}
pgdatabase=${PGDATABASE}
pghost=${PGHOST}
rustfs_dir=${RUSTFS_DIR}
postgres_tar_bytes=$(stat -c%s "${WORK_DIR}/postgres.tar")
rustfs_tar_bytes=$(stat -c%s "${WORK_DIR}/rustfs.tar")
hostname=$(hostname)
MANIFEST

log "Compressing archive..."
tar -czf "$ARCHIVE_PATH" -C "${WORK_DIR}" postgres.tar rustfs.tar manifest.txt \
  || fail "Compression failed."

archive_bytes=$(stat -c%s "$ARCHIVE_PATH")
log "Archive size: ${archive_bytes} bytes"

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

log "Verifying upload..."
rclone check "$(dirname "$ARCHIVE_PATH")" "$GDRIVE_DESTINATION" --include "$ARCHIVE_NAME" \
  || fail "Upload verification failed."

log "Deleting backups older than ${RETENTION_DAYS}d..."
rclone delete "$GDRIVE_DESTINATION" --min-age "${RETENTION_DAYS}d" || warn "Retention cleanup failed."

log "--- Backup success: ${TIMESTAMP} (${ARCHIVE_NAME}) ---"
if [[ -n "${HEALTHCHECK_PING_URL:-}" ]]; then
  log "Pinging Healthchecks..."
  healthcheck_ping "$HEALTHCHECK_PING_URL"
fi
