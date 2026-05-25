#!/usr/bin/env bash
# Production deploy: selective backend/caddy updates, shared network, infra stays up.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-${DEPLOY_ROOT}/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-${DEPLOY_ROOT}/.env}"
STATE_DIR="${DEPLOY_ROOT}/.deploy"
STATE_FILE="${STATE_DIR}/state"
LOG_DIR="${DEPLOY_ROOT}/logs"
DEPLOY_LOG="${LOG_DIR}/deploy.log"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"
export COMPOSE_PROFILES="${COMPOSE_PROFILES:-infra}"

mkdir -p "${STATE_DIR}" "${LOG_DIR}"
touch "${DEPLOY_LOG}"

exec > >(tee -a "${DEPLOY_LOG}") 2>&1

log() {
  printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

compose() {
  local args=(-f "${COMPOSE_FILE}" --env-file "${ENV_FILE}")
  if [[ -f "${DEPLOY_ROOT}/docker-compose.prod.override.yml" ]]; then
    args+=(-f "${DEPLOY_ROOT}/docker-compose.prod.override.yml")
  fi
  docker compose "${args[@]}" "$@"
}

service_container_id() {
  local service="$1"
  compose ps -q "${service}" 2>/dev/null | head -n1
}

service_health() {
  local service="$1"
  local cid
  cid="$(service_container_id "${service}")"
  if [[ -z "${cid}" ]]; then
    echo "missing"
    return 0
  fi
  docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${cid}" 2>/dev/null || echo "unknown"
}

infra_healthy() {
  [[ "$(service_health postgres)" == "healthy" ]] \
    && [[ "$(service_health rustfs)" == "healthy" ]]
}

read_state() {
  BACKEND_TAG_PREVIOUS=""
  CADDY_TAG_PREVIOUS=""
  if [[ -f "${STATE_FILE}" ]]; then
    # shellcheck disable=SC1090
    source "${STATE_FILE}"
    BACKEND_TAG_PREVIOUS="${BACKEND_TAG:-}"
    CADDY_TAG_PREVIOUS="${CADDY_TAG:-}"
  fi
}

write_state() {
  local backend_tag="$1"
  local caddy_tag="$2"
  cat >"${STATE_FILE}" <<EOF
BACKEND_TAG=${backend_tag}
CADDY_TAG=${caddy_tag}
DEPLOYED_AT=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
EOF
}

setup_home_symlinks() {
  local home_dir
  home_dir="$(getent passwd "$(whoami)" | cut -d: -f6)"
  ln -sfn "${SCRIPT_DIR}/pos-logs.sh" "${home_dir}/pos-logs"
  ln -sfn "${LOG_DIR}" "${home_dir}/pos-logs-dir"
  chmod +x "${SCRIPT_DIR}/pos-logs.sh" "${SCRIPT_DIR}/deploy-prod.sh" 2>/dev/null || true
}

docker_login() {
  if [[ -n "${DOCKERHUB_TOKEN:-}" ]]; then
    log "Logging in to Docker Hub"
    echo "${DOCKERHUB_TOKEN}" | docker login -u "${DOCKERHUB_USERNAME}" --password-stdin
  fi
}

bootstrap_infra() {
  if infra_healthy; then
    log "Postgres and RustFS healthy — skipping infra (no restart, no pull)"
    return 0
  fi

  local pg_cid rf_cid pg_health rf_health
  pg_cid="$(service_container_id postgres)"
  rf_cid="$(service_container_id rustfs)"
  pg_health="$(service_health postgres)"
  rf_health="$(service_health rustfs)"

  if [[ -n "${pg_cid}" && "${pg_health}" != "healthy" ]]; then
    log "Postgres container exists but is not healthy (status=${pg_health})"
    log "Not restarting Postgres automatically — fix data/WAL or run scripts/postgres-recover.sh"
    exit 1
  fi

  if [[ -z "${pg_cid}" ]]; then
    log "Starting postgres for first-time bootstrap"
    compose up -d postgres
  fi

  if [[ -z "${rf_cid}" ]]; then
    log "Starting rustfs for first-time bootstrap"
    compose up -d rustfs
  elif [[ "${rf_health}" != "healthy" ]]; then
    log "RustFS not healthy (status=${rf_health}) — recreating rustfs"
    compose up -d --force-recreate rustfs
  fi

  log "Waiting for infra health"
  local i
  for ((i = 1; i <= HEALTH_RETRIES; i++)); do
    if infra_healthy; then
      log "Infra healthy"
      return 0
    fi
    sleep "${HEALTH_INTERVAL}"
  done

  log "Infra failed to become healthy (postgres=${pg_health}, rustfs=${rf_health})"
  exit 1
}

sync_compose_project() {
  log "Applying compose/network changes without recreating containers"
  compose up -d --no-recreate --pull never
}

resolve_image_tags() {
  local deploy_backend="${1}"
  local deploy_caddy="${2}"

  # Deploy always pulls :latest from Docker Hub (also tagged with git sha on push for history).
  if [[ "${deploy_backend}" == "true" ]]; then
    export BACKEND_IMAGE_TAG="latest"
  else
    export BACKEND_IMAGE_TAG="${BACKEND_TAG_PREVIOUS:-latest}"
  fi

  if [[ "${deploy_caddy}" == "true" ]]; then
    export CADDY_IMAGE_TAG="latest"
  else
    export CADDY_IMAGE_TAG="${CADDY_TAG_PREVIOUS:-latest}"
  fi

  log "Image tags: backend=${BACKEND_IMAGE_TAG} (deploy=${deploy_backend}), caddy=${CADDY_IMAGE_TAG} (deploy=${deploy_caddy})"
}

run_migrations() {
  local image_tag="${1:-${BACKEND_IMAGE_TAG:-latest}}"
  log "Running backend database migrations (image tag=${image_tag})"
  BACKEND_IMAGE_TAG="${image_tag}" compose run --rm --no-deps backend python migrate.py
}

wait_backend_health() {
  local i
  log "Waiting for backend health"
  for ((i = 1; i <= HEALTH_RETRIES; i++)); do
    if compose exec -T backend python -c \
      "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=5).getcode()==200 else 1)" \
      2>/dev/null; then
      log "Backend healthy"
      return 0
    fi
    sleep "${HEALTH_INTERVAL}"
  done
  return 1
}

wait_caddy_health() {
  local i
  log "Waiting for caddy health"
  for ((i = 1; i <= HEALTH_RETRIES; i++)); do
    if compose exec -T caddy sh -c \
      'caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && pidof caddy >/dev/null' \
      2>/dev/null; then
      log "Caddy healthy"
      return 0
    fi
    sleep "${HEALTH_INTERVAL}"
  done
  return 1
}

backend_allowed_hosts_mismatch() {
  local cid current expected
  cid="$(service_container_id backend)"
  [[ -z "${cid}" ]] && return 1
  current="$(compose exec -T backend printenv ALLOWED_HOSTS 2>/dev/null || true)"
  expected="${BACKEND_ALLOWED_HOSTS:-}"
  [[ "${current}" != "${expected}" ]]
}

refresh_backend_env_if_needed() {
  if ! backend_allowed_hosts_mismatch; then
    return 0
  fi

  log "Backend ALLOWED_HOSTS out of sync with .env — recreating backend"
  compose up -d --no-deps backend

  if ! wait_backend_health; then
    log "Backend failed after env sync"
    return 1
  fi
}

rollback() {
  local backend_tag="${1:-}"
  local caddy_tag="${2:-}"
  local rollback_backend="${3:-false}"
  local rollback_caddy="${4:-false}"

  if [[ "${rollback_backend}" == "true" && -n "${backend_tag}" ]]; then
    log "Rolling back backend to ${backend_tag}"
    BACKEND_IMAGE_TAG="${backend_tag}" compose pull backend || true
    BACKEND_IMAGE_TAG="${backend_tag}" compose up -d --no-deps backend
    wait_backend_health || true
  fi

  if [[ "${rollback_caddy}" == "true" && -n "${caddy_tag}" ]]; then
    log "Rolling back caddy to ${caddy_tag}"
    CADDY_IMAGE_TAG="${caddy_tag}" compose pull caddy || true
    CADDY_IMAGE_TAG="${caddy_tag}" compose up -d --no-deps caddy
    wait_caddy_health || true
  fi

  write_state \
    "$( [[ "${rollback_backend}" == "true" && -n "${backend_tag}" ]] && echo "${backend_tag}" || echo "${BACKEND_TAG_PREVIOUS}" )" \
    "$( [[ "${rollback_caddy}" == "true" && -n "${caddy_tag}" ]] && echo "${caddy_tag}" || echo "${CADDY_TAG_PREVIOUS}" )"
}

deploy_app() {
  local deploy_backend="${DEPLOY_BACKEND:-true}"
  local deploy_caddy="${DEPLOY_CADDY:-true}"
  local sync_compose="${SYNC_COMPOSE:-false}"

  resolve_image_tags "${deploy_backend}" "${deploy_caddy}"

  local new_backend_tag="${BACKEND_IMAGE_TAG}"
  local new_caddy_tag="${CADDY_IMAGE_TAG}"
  local final_backend_tag="${BACKEND_TAG_PREVIOUS}"
  local final_caddy_tag="${CADDY_TAG_PREVIOUS}"

  bootstrap_infra

  if [[ "${sync_compose}" == "true" && "${deploy_backend}" != "true" && "${deploy_caddy}" != "true" ]]; then
    sync_compose_project
    if ! refresh_backend_env_if_needed; then
      exit 1
    fi
    log "Compose sync complete (no image updates)"
    return 0
  fi

  if [[ "${deploy_backend}" != "true" && "${deploy_caddy}" != "true" ]]; then
    if ! refresh_backend_env_if_needed; then
      exit 1
    fi
    log "Nothing to deploy (DEPLOY_BACKEND=false, DEPLOY_CADDY=false)"
    return 0
  fi

  sync_compose_project

  if [[ "${deploy_backend}" == "true" ]]; then
    log "Pulling backend image (tag=${new_backend_tag})"
    BACKEND_IMAGE_TAG="${new_backend_tag}" compose pull backend

    if ! run_migrations "${new_backend_tag}"; then
      log "Database migration failed"
      rollback "${BACKEND_TAG_PREVIOUS}" "${CADDY_TAG_PREVIOUS}" true false
      exit 1
    fi

    log "Deploying backend"
    BACKEND_IMAGE_TAG="${new_backend_tag}" compose up -d --no-deps backend

    if ! wait_backend_health; then
      log "Backend health check failed"
      rollback "${BACKEND_TAG_PREVIOUS}" "${CADDY_TAG_PREVIOUS}" true false
      exit 1
    fi
    final_backend_tag="${new_backend_tag}"
  else
    log "Skipping backend deploy"
  fi

  if [[ "${deploy_caddy}" == "true" ]]; then
    log "Pulling caddy image (tag=${new_caddy_tag})"
    CADDY_IMAGE_TAG="${new_caddy_tag}" compose pull caddy

    log "Deploying caddy"
    CADDY_IMAGE_TAG="${new_caddy_tag}" compose up -d --no-deps caddy

    if ! wait_caddy_health; then
      log "Caddy health check failed"
      rollback "${BACKEND_TAG_PREVIOUS}" "${CADDY_TAG_PREVIOUS}" false true
      exit 1
    fi
    final_caddy_tag="${new_caddy_tag}"
  else
    log "Skipping caddy deploy"
  fi

  if ! refresh_backend_env_if_needed; then
    rollback "${BACKEND_TAG_PREVIOUS}" "${CADDY_TAG_PREVIOUS}" true false
    exit 1
  fi

  write_state \
    "${final_backend_tag:-${new_backend_tag}}" \
    "${final_caddy_tag:-${new_caddy_tag}}"
  log "Deploy succeeded (backend=${final_backend_tag}, caddy=${final_caddy_tag})"
}

main() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    log "Missing ${ENV_FILE}"
    exit 1
  fi
  if [[ ! -f "${COMPOSE_FILE}" ]]; then
    log "Missing ${COMPOSE_FILE}"
    exit 1
  fi

  # shellcheck disable=SC1090
  set -a
  source "${ENV_FILE}"
  set +a

  setup_home_symlinks
  read_state
  docker_login
  deploy_app
}

main "$@"
