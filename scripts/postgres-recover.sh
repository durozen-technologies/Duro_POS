#!/usr/bin/env bash
# Emergency Postgres WAL recovery when the data directory has an invalid checkpoint.
# USE ONLY when Postgres will not start and you have no recent backup.
# Stop the postgres container before running this script.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-${DEPLOY_ROOT}/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-${DEPLOY_ROOT}/.env}"
export COMPOSE_PROFILES="${COMPOSE_PROFILES:-infra}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "${ENV_FILE}"
set +a

DATA_DIR="${POSTGRES_DATA_DIR:-/home/ubuntu/pos-postgress/data}"

echo "This will run pg_resetwal on: ${DATA_DIR}"
echo "Ensure the postgres container is STOPPED before continuing."
read -r -p "Type RESET to continue: " confirm
if [[ "${confirm}" != "RESET" ]]; then
  echo "Aborted."
  exit 1
fi

docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" stop postgres 2>/dev/null || true

docker run --rm \
  -u root \
  -v "${DATA_DIR}:/var/lib/postgresql/data" \
  postgres:17-alpine \
  pg_resetwal -f /var/lib/postgresql/data

echo "WAL reset complete. Start postgres with:"
echo "  COMPOSE_PROFILES=infra docker compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE} up -d postgres"
echo "Then verify logs: ~/pos-logs postgres"
