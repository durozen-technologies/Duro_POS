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
COMPOSE_BIN=()
COMPOSE_V2=false
DEBUG_LOG="${DEBUG_LOG:-${DEPLOY_ROOT}/.cursor/debug-7ecdab.log}"

mkdir -p "${STATE_DIR}" "${LOG_DIR}"
touch "${DEPLOY_LOG}"

exec > >(tee -a "${DEPLOY_LOG}") 2>&1

log() {
  printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

expand_rustfs_server_domains() {
  local raw="${RUSTFS_SERVER_DOMAINS:-}"
  if [[ -z "${raw}" ]]; then
    return 0
  fi

  local -A seen=()
  local -a out=()
  local d host item expanded=""

  add_domain() {
    local value="${1// /}"
    [[ -z "${value}" ]] && return 0
    [[ -n "${seen[$value]+x}" ]] && return 0
    seen["$value"]=1
    out+=("${value}")
  }

  IFS=',' read -ra parts <<< "${raw}"
  for d in "${parts[@]}"; do
    add_domain "${d}"
    d="${d// /}"
    if [[ "${d}" == *:9001 ]]; then
      host="${d%:9001}"
      add_domain "${host}:9000"
    fi
  done

  add_domain "rustfs:9000"

  for item in "${out[@]}"; do
    if [[ -n "${expanded}" ]]; then
      expanded+=","
    fi
    expanded+="${item}"
  done

  export RUSTFS_SERVER_DOMAINS="${expanded}"
  log "Expanded RUSTFS_SERVER_DOMAINS=${RUSTFS_SERVER_DOMAINS}"
}

apply_rustfs_config() {
  log "Applying RustFS server-domain configuration"
  run_compose up -d --pull never --force-recreate rustfs

  local i status
  for ((i = 1; i <= HEALTH_RETRIES; i++)); do
    status="$(service_health rustfs)"
    if [[ "${status}" == "healthy" ]]; then
      log "RustFS healthy after config apply"
      return 0
    fi
    sleep "${HEALTH_INTERVAL}"
  done

  log "RustFS failed to become healthy after config apply (status=${status})"
  return 1
}

#region agent log
debug_log() {
  local hypothesis="$1" location="$2" message="$3" data="${4:-{}}"
  local ts
  ts=$(($(date +%s) * 1000))
  mkdir -p "$(dirname "${DEBUG_LOG}")" 2>/dev/null || true
  printf '{"sessionId":"7ecdab","hypothesisId":"%s","location":"%s","message":"%s","data":%s,"timestamp":%s}\n' \
    "$hypothesis" "$location" "$message" "$data" "$ts" >> "${DEBUG_LOG}" 2>/dev/null || true
  log "DEBUG hypothesis=${hypothesis} ${message} data=${data}"
}
#endregion

compose_file_args() {
  local -n _out=$1
  _out=(-f "${COMPOSE_FILE}" --env-file "${ENV_FILE}")
  if [[ -f "${DEPLOY_ROOT}/docker-compose.prod.override.yml" ]]; then
    _out+=(-f "${DEPLOY_ROOT}/docker-compose.prod.override.yml")
  fi
}

resolve_compose_cmd() {
  local docker_version plugin_err dc_path dc_version
  docker_version="$(docker --version 2>&1 || echo unknown)"
  if docker compose version &>/dev/null; then
    COMPOSE_BIN=(docker compose)
    COMPOSE_V2=true
    plugin_err="$(docker compose version 2>&1 | head -n1)"
    debug_log "H1" "deploy-prod.sh:resolve_compose_cmd" "using docker compose plugin" \
      "{\"docker_version\":\"${docker_version}\",\"compose_version\":\"${plugin_err}\"}"
    log "Compose CLI: docker compose (${plugin_err})"
    return 0
  fi
  plugin_err="$(docker compose version 2>&1 | head -n1 || true)"
  dc_path="$(command -v docker-compose 2>/dev/null || true)"
  if [[ -n "${dc_path}" ]]; then
    COMPOSE_BIN=(docker-compose)
    COMPOSE_V2=false
    dc_version="$(docker-compose version 2>&1 | head -n1 || true)"
    debug_log "H1" "deploy-prod.sh:resolve_compose_cmd" "fallback to docker-compose binary" \
      "{\"docker_version\":\"${docker_version}\",\"plugin_error\":\"${plugin_err}\",\"docker_compose_path\":\"${dc_path}\",\"docker_compose_version\":\"${dc_version}\"}"
    log "Compose CLI: docker-compose (${dc_version})"
    return 0
  fi
  debug_log "H1" "deploy-prod.sh:resolve_compose_cmd" "no compose CLI found" \
    "{\"docker_version\":\"${docker_version}\",\"plugin_error\":\"${plugin_err}\"}"
  log "Need 'docker compose' (v2 plugin) or 'docker-compose' on PATH"
  exit 1
}

# Run compose without logging failures (health probes, status checks).
compose_quiet() {
  local args=()
  compose_file_args args
  "${COMPOSE_BIN[@]}" "${args[@]}" "$@" 2>/dev/null
}

# Run compose; log only real operational failures (pull, up, migrate).
run_compose() {
  local args=()
  compose_file_args args
  if ! "${COMPOSE_BIN[@]}" "${args[@]}" "$@"; then
    log "compose failed: ${COMPOSE_BIN[*]} ${args[*]} $*"
    return 1
  fi
}

validate_compose_config() {
  log "Validating compose configuration"
  if ! run_compose config >/dev/null; then
    log "Compose config invalid — check .env and required secrets"
    exit 1
  fi
  debug_log "H4" "deploy-prod.sh:validate_compose_config" "compose config ok" "{}"
}

service_container_id() {
  local service="$1"
  compose_quiet ps -q "${service}" | head -n1
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
    run_compose up -d postgres
  fi

  if [[ -z "${rf_cid}" ]]; then
    log "Starting rustfs for first-time bootstrap"
    run_compose up -d rustfs
  elif [[ "${rf_health}" != "healthy" ]]; then
    log "RustFS not healthy (status=${rf_health}) — recreating rustfs"
    run_compose up -d --force-recreate rustfs
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
  log "Applying compose/network changes (postgres only, no image pull)"
  if [[ "${COMPOSE_V2}" == "true" ]]; then
    run_compose up -d --no-recreate --pull never postgres
  else
    run_compose up -d --no-recreate postgres
  fi
}

resolve_image_tags() {
  local deploy_backend="${1}"
  local deploy_caddy="${2}"

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
  BACKEND_IMAGE_TAG="${image_tag}" run_compose run --rm --no-deps backend python migrate.py --tenants
}

backend_health_http_probe() {
  compose_quiet exec -T backend python -c \
    "import urllib.request,json,sys
try:
 r=urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health',timeout=5)
 body=r.read().decode()
 print(json.dumps({'code':r.getcode(),'body':body}))
 sys.exit(0 if r.getcode()==200 else 1)
except Exception as e:
 print(json.dumps({'code':0,'error':str(e)}))
 sys.exit(1)"
}

log_backend_health_diagnostics() {
  local status="$1"
  local probe_out
  log "Backend diagnostics: container_status=${status}"
  probe_out="$(backend_health_http_probe 2>/dev/null || true)"
  if [[ -n "${probe_out}" ]]; then
    log "Backend health probe: ${probe_out}"
    debug_log "H3" "deploy-prod.sh:log_backend_health_diagnostics" "health probe" \
      "{\"container_status\":\"${status}\",\"probe\":${probe_out}}"
  fi
  log "Backend logs (last 60 lines):"
  compose_quiet logs --tail 60 backend || true
}

wait_backend_health() {
  local i status restart_count
  log "Waiting for backend health (up to $((HEALTH_RETRIES * HEALTH_INTERVAL))s)"
  for ((i = 1; i <= HEALTH_RETRIES; i++)); do
    status="$(service_health backend)"
    if [[ "${status}" == "healthy" ]]; then
      log "Backend healthy"
      debug_log "H2" "deploy-prod.sh:wait_backend_health" "backend healthy" \
        "{\"attempt\":${i},\"status\":\"${status}\"}"
      return 0
    fi
    if [[ "${status}" == "exited" || "${status}" == "dead" ]]; then
      log "Backend container is not running (status=${status})"
      log_backend_health_diagnostics "${status}"
      return 1
    fi
    if [[ "${status}" == "unhealthy" ]]; then
      restart_count="$(docker inspect --format='{{.RestartCount}}' "$(service_container_id backend)" 2>/dev/null || echo 0)"
      if [[ "${restart_count}" -ge 3 ]]; then
        log "Backend crash-looping (status=${status}, restarts=${restart_count})"
        log_backend_health_diagnostics "${status}"
        return 1
      fi
    fi
    if (( i == 1 || i % 6 == 0 )); then
      log "Backend not ready yet: status=${status} (attempt ${i}/${HEALTH_RETRIES})"
      debug_log "H2" "deploy-prod.sh:wait_backend_health" "still waiting" \
        "{\"attempt\":${i},\"status\":\"${status}\"}"
    fi
    sleep "${HEALTH_INTERVAL}"
  done
  status="$(service_health backend)"
  log_backend_health_diagnostics "${status}"
  return 1
}

wait_caddy_health() {
  local i status
  log "Waiting for caddy health"
  for ((i = 1; i <= HEALTH_RETRIES; i++)); do
    status="$(service_health caddy)"
    if [[ "${status}" == "healthy" ]]; then
      log "Caddy healthy"
      return 0
    fi
    if (( i == 1 || i % 6 == 0 )); then
      log "Caddy not ready yet: status=${status} (attempt ${i}/${HEALTH_RETRIES})"
    fi
    sleep "${HEALTH_INTERVAL}"
  done
  log "Caddy health check failed (last status=${status})"
  compose_quiet logs --tail 60 caddy || true
  return 1
}

backend_allowed_hosts_mismatch() {
  local cid current expected
  cid="$(service_container_id backend)"
  [[ -z "${cid}" ]] && return 1
  current="$(compose_quiet exec -T backend printenv ALLOWED_HOSTS || true)"
  expected="${BACKEND_ALLOWED_HOSTS:-}"
  [[ "${current}" != "${expected}" ]]
}

refresh_backend_env_if_needed() {
  if ! backend_allowed_hosts_mismatch; then
    return 0
  fi

  log "Backend ALLOWED_HOSTS out of sync with .env — recreating backend"
  run_compose up -d --no-deps backend

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
    BACKEND_IMAGE_TAG="${backend_tag}" run_compose pull backend || true
    BACKEND_IMAGE_TAG="${backend_tag}" run_compose up -d --no-deps backend
    wait_backend_health || true
  fi

  if [[ "${rollback_caddy}" == "true" && -n "${caddy_tag}" ]]; then
    log "Rolling back caddy to ${caddy_tag}"
    CADDY_IMAGE_TAG="${caddy_tag}" run_compose pull caddy || true
    CADDY_IMAGE_TAG="${caddy_tag}" run_compose up -d --no-deps caddy
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

  if [[ "${deploy_backend}" == "true" || "${sync_compose}" == "true" ]]; then
    if ! apply_rustfs_config; then
      exit 1
    fi
  fi

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
    BACKEND_IMAGE_TAG="${new_backend_tag}" run_compose pull backend

    if ! run_migrations "${new_backend_tag}"; then
      log "Database migration failed"
      rollback "${BACKEND_TAG_PREVIOUS}" "${CADDY_TAG_PREVIOUS}" true false
      exit 1
    fi

    log "Deploying backend"
    BACKEND_IMAGE_TAG="${new_backend_tag}" run_compose up -d --no-deps backend

    if ! wait_backend_health; then
      log "Backend health check failed — verify POSTGRES_PASSWORD matches the data directory"
      rollback "${BACKEND_TAG_PREVIOUS}" "${CADDY_TAG_PREVIOUS}" true false
      exit 1
    fi
    final_backend_tag="${new_backend_tag}"
  else
    log "Skipping backend deploy"
  fi

  if [[ "${deploy_caddy}" == "true" ]]; then
    log "Pulling caddy image (tag=${new_caddy_tag})"
    CADDY_IMAGE_TAG="${new_caddy_tag}" run_compose pull caddy

    log "Deploying caddy"
    CADDY_IMAGE_TAG="${new_caddy_tag}" run_compose up -d --no-deps caddy

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

  expand_rustfs_server_domains
  setup_home_symlinks
  read_state
  resolve_compose_cmd
  docker_login
  validate_compose_config
  deploy_app
}

main "$@"
