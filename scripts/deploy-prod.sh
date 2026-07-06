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
INFRA_HEALTH_RETRIES="${INFRA_HEALTH_RETRIES:-72}"
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
  run_compose up -d --pull never --build --force-recreate rustfs

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
  _out=(--profile "${COMPOSE_PROFILES:-infra}" -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}")
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
  compose_quiet ps -q --status running "${service}" | head -n1
}

service_health() {
  local service="$1"
  local cid
  cid="$(service_container_id "${service}")"
  if [[ -z "${cid}" ]]; then
    cid="$(compose_quiet ps -q --status exited "${service}" | head -n1)"
    if [[ -n "${cid}" ]]; then
      echo "exited"
      return 0
    fi
    echo "missing"
    return 0
  fi
  docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${cid}" 2>/dev/null || echo "unknown"
}

log_infra_diagnostics() {
  log "Compose service status:"
  run_compose ps -a || true
  local svc
  for svc in postgres pgbouncer rustfs redis; do
    log "${svc}=$(service_health "${svc}")"
    log "Recent ${svc} logs:"
    run_compose logs --tail 50 "${svc}" || true
  done
}

wait_service_health() {
  local service="$1"
  local max_attempts="${2:-${HEALTH_RETRIES}}"
  local i status
  for ((i = 1; i <= max_attempts; i++)); do
    status="$(service_health "${service}")"
    if [[ "${status}" == "healthy" ]]; then
      log "${service} healthy"
      return 0
    fi
    if [[ "${status}" == "exited" || "${status}" == "dead" ]]; then
      log "${service} stopped (status=${status})"
      run_compose logs --tail 80 "${service}" || true
      return 1
    fi
    if (( i == 1 || i % 6 == 0 )); then
      log "${service} not ready yet: status=${status} (attempt ${i}/${max_attempts})"
    fi
    sleep "${HEALTH_INTERVAL}"
  done
  log "${service} health timeout (last status=${status})"
  run_compose logs --tail 80 "${service}" || true
  return 1
}

bootstrap_infra_service() {
  local service="$1"
  local build="${2:-false}"
  local status
  status="$(service_health "${service}")"

  if [[ "${status}" == "healthy" ]]; then
    return 0
  fi

  if [[ "${status}" == "starting" ]]; then
    log "${service} still starting — waiting for health"
    wait_service_health "${service}" "${INFRA_HEALTH_RETRIES}"
    return $?
  fi

  if [[ "${status}" == "missing" || "${status}" == "exited" || "${status}" == "dead" ]]; then
    log "Starting ${service} (status=${status})"
    if [[ "${build}" == "true" ]]; then
      run_compose up -d --build "${service}"
    else
      run_compose up -d "${service}"
    fi
  else
    log "${service} not healthy (status=${status}) — recreating"
    if [[ "${build}" == "true" ]]; then
      run_compose up -d --build --force-recreate "${service}"
    else
      run_compose up -d --force-recreate "${service}"
    fi
  fi

  wait_service_health "${service}" "${INFRA_HEALTH_RETRIES}"
}

RUSTFS_RUNTIME_UID=10001
RUSTFS_RUNTIME_GID=10001

rustfs_data_dir() {
  echo "${RUSTFS_DATA_DIR:-/home/ubuntu/rustfs/data}"
}

ensure_rustfs_data_dir() {
  local data_dir
  data_dir="$(rustfs_data_dir)"
  sudo mkdir -p "${data_dir}"
  sudo chown -R "${RUSTFS_RUNTIME_UID}:${RUSTFS_RUNTIME_GID}" "${data_dir}"
  sudo chmod 750 "${data_dir}"
}

infra_healthy() {
  [[ "$(service_health postgres)" == "healthy" ]] \
    && [[ "$(service_health pgbouncer)" == "healthy" ]] \
    && [[ "$(service_health rustfs)" == "healthy" ]] \
    && [[ "$(service_health redis)" == "healthy" ]]
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

POSTGRES_RUNTIME_UID=70
POSTGRES_RUNTIME_GID=70

postgres_data_dir() {
  echo "${POSTGRES_DATA_DIR:-/home/ubuntu/pos-postgress/data}"
}

log_postgres_diagnostics() {
  log "Postgres logs (last 80 lines):"
  compose_quiet logs --tail 80 postgres || true
}

postgres_logs_text() {
  compose_quiet logs --tail 120 postgres 2>/dev/null || true
}

postgres_logs_indicate_wal_corruption() {
  local logs
  logs="$(postgres_logs_text)"
  grep -Eiq 'invalid checkpoint record|could not locate a valid checkpoint|could not open file .*pg_wal|PANIC:  database system is shut down|could not read block' <<< "${logs}"
}

ensure_postgres_data_dir() {
  local data_dir="$1"
  if [[ ! -d "${data_dir}" ]]; then
    log "Creating postgres data directory ${data_dir}"
    sudo mkdir -p "${data_dir}"
  fi
  repair_postgres_data_permissions "${data_dir}"
}

repair_postgres_data_permissions() {
  local data_dir="$1"
  log "Ensuring ${data_dir} is owned by ${POSTGRES_RUNTIME_UID}:${POSTGRES_RUNTIME_GID}"
  sudo mkdir -p "${data_dir}"
  sudo chown -R "${POSTGRES_RUNTIME_UID}:${POSTGRES_RUNTIME_GID}" "${data_dir}"
  sudo chmod 700 "${data_dir}"
}

wait_postgres_health() {
  local i status
  for ((i = 1; i <= HEALTH_RETRIES; i++)); do
    status="$(service_health postgres)"
    if [[ "${status}" == "healthy" ]]; then
      log "Postgres healthy"
      return 0
    fi
    if [[ "${status}" == "exited" || "${status}" == "dead" ]]; then
      log "Postgres container stopped (status=${status})"
      log_postgres_diagnostics
      return 1
    fi
    if (( i == 1 || i % 6 == 0 )); then
      log "Postgres not ready yet: status=${status} (attempt ${i}/${HEALTH_RETRIES})"
    fi
    sleep "${HEALTH_INTERVAL}"
  done
  log "Postgres health timeout (last status=${status})"
  log_postgres_diagnostics
  return 1
}

repair_unhealthy_postgres() {
  local data_dir
  data_dir="$(postgres_data_dir)"
  log "Postgres unhealthy — attempting safe repair"
  log_postgres_diagnostics

  if postgres_logs_indicate_wal_corruption; then
    log "Postgres data/WAL corruption detected — run scripts/postgres-recover.sh on the VM"
    return 1
  fi

  log "Recreating postgres after fixing data directory permissions"
  run_compose stop postgres 2>/dev/null || true
  repair_postgres_data_permissions "${data_dir}"
  run_compose up -d --force-recreate postgres
  wait_postgres_health
}

bootstrap_postgres() {
  local pg_cid pg_health data_dir
  data_dir="$(postgres_data_dir)"
  ensure_postgres_data_dir "${data_dir}"

  pg_cid="$(service_container_id postgres)"
  pg_health="$(service_health postgres)"

  if [[ -z "${pg_cid}" ]]; then
    log "Starting postgres for first-time bootstrap"
    run_compose up -d postgres
    wait_postgres_health
    return $?
  fi

  if [[ "${pg_health}" == "healthy" ]]; then
    return 0
  fi

  if [[ "${pg_health}" == "starting" ]]; then
    log "Postgres still starting — waiting for health"
    wait_postgres_health
    return $?
  fi

  repair_unhealthy_postgres
}

bootstrap_infra() {
  if infra_healthy; then
    log "Postgres, pgBouncer, RustFS, and Redis healthy — skipping infra restart"
    return 0
  fi

  if ! bootstrap_postgres; then
    log_infra_diagnostics
    exit 1
  fi

  ensure_rustfs_data_dir

  if ! bootstrap_infra_service pgbouncer true; then
    log_infra_diagnostics
    exit 1
  fi

  if ! bootstrap_infra_service rustfs true; then
    log_infra_diagnostics
    exit 1
  fi

  if ! bootstrap_infra_service redis false; then
    log_infra_diagnostics
    exit 1
  fi

  if infra_healthy; then
    log "Infra healthy"
    return 0
  fi

  log "Infra failed final health check (postgres=$(service_health postgres), pgbouncer=$(service_health pgbouncer), rustfs=$(service_health rustfs), redis=$(service_health redis))"
  log_infra_diagnostics
  exit 1
}

sync_compose_project() {
  log "Applying compose/network changes (infra only, no image pull)"
  if [[ "${COMPOSE_V2}" == "true" ]]; then
    run_compose up -d --no-recreate --pull never postgres pgbouncer redis rustfs
  else
    run_compose up -d --no-recreate postgres pgbouncer redis rustfs
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
  log "Running database migrations (image tag=${image_tag})"
  BACKEND_IMAGE_TAG="${image_tag}" run_compose run --rm migrate
}

backend_health_http_probe() {
  local service="${1:?backend service name required}"
  compose_quiet exec -T "${service}" \
    python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2).read().decode())" \
    2>/dev/null || true
}

log_backend_health_diagnostics() {
  local service="$1"
  local status="$2"
  local probe_out
  log "Backend diagnostics (${service}): container_status=${status}"
  probe_out="$(backend_health_http_probe "${service}")"
  if [[ -n "${probe_out}" ]]; then
    log "Backend health probe (${service}): ${probe_out}"
    debug_log "H3" "deploy-prod.sh:log_backend_health_diagnostics" "health probe" \
      "{\"service\":\"${service}\",\"container_status\":\"${status}\",\"probe\":${probe_out}}"
  fi
  log "Backend logs (${service}, last 60 lines):"
  compose_quiet logs --tail 60 "${service}" || true
}

wait_backend_health() {
  local service="${1:?backend service name required}"
  local i status restart_count
  log "Waiting for ${service} health (up to $((HEALTH_RETRIES * HEALTH_INTERVAL))s)"
  for ((i = 1; i <= HEALTH_RETRIES; i++)); do
    status="$(service_health "${service}")"
    if [[ "${status}" == "healthy" ]]; then
      log "${service} healthy"
      debug_log "H2" "deploy-prod.sh:wait_backend_health" "backend healthy" \
        "{\"service\":\"${service}\",\"attempt\":${i},\"status\":\"${status}\"}"
      return 0
    fi
    if [[ "${status}" == "exited" || "${status}" == "dead" ]]; then
      log "${service} container is not running (status=${status})"
      log_backend_health_diagnostics "${service}" "${status}"
      return 1
    fi
    if [[ "${status}" == "unhealthy" ]]; then
      restart_count="$(docker inspect --format='{{.RestartCount}}' "$(service_container_id "${service}")" 2>/dev/null || echo 0)"
      if [[ "${restart_count}" -ge 3 ]]; then
        log "${service} crash-looping (status=${status}, restarts=${restart_count})"
        log_backend_health_diagnostics "${service}" "${status}"
        return 1
      fi
    fi
    if (( i == 1 || i % 6 == 0 )); then
      log "${service} not ready yet: status=${status} (attempt ${i}/${HEALTH_RETRIES})"
      debug_log "H2" "deploy-prod.sh:wait_backend_health" "still waiting" \
        "{\"service\":\"${service}\",\"attempt\":${i},\"status\":\"${status}\"}"
    fi
    sleep "${HEALTH_INTERVAL}"
  done
  status="$(service_health "${service}")"
  log_backend_health_diagnostics "${service}" "${status}"
  return 1
}

deploy_backend_instance() {
  local service="$1"
  local image_tag="$2"
  log "Pulling ${service} image (tag=${image_tag})"
  BACKEND_IMAGE_TAG="${image_tag}" run_compose pull "${service}"
  log "Deploying ${service}"
  BACKEND_IMAGE_TAG="${image_tag}" run_compose up -d --no-deps "${service}"
  wait_backend_health "${service}"
}

deploy_backend_rolling() {
  local image_tag="$1"
  local previous_tag="$2"

  if ! deploy_backend_instance "backend-1" "${image_tag}"; then
    log "backend-1 failed to become healthy"
    if [[ -n "${previous_tag}" && "${previous_tag}" != "${image_tag}" ]]; then
      log "Rolling back backend-1 to ${previous_tag}"
      deploy_backend_instance "backend-1" "${previous_tag}" || true
    fi
    return 1
  fi

  if ! deploy_backend_instance "backend-2" "${image_tag}"; then
    log "backend-2 failed to become healthy — backend-1 is on ${image_tag}"
    if [[ -n "${previous_tag}" && "${previous_tag}" != "${image_tag}" ]]; then
      log "Rolling back backend-2 to ${previous_tag}"
      deploy_backend_instance "backend-2" "${previous_tag}" || true
    fi
    return 1
  fi

  return 0
}

backend_allowed_hosts_mismatch() {
  local service="$1"
  local cid current expected
  cid="$(service_container_id "${service}")"
  [[ -z "${cid}" ]] && return 1
  current="$(compose_quiet exec -T "${service}" printenv ALLOWED_HOSTS || true)"
  expected="${BACKEND_ALLOWED_HOSTS:-}"
  [[ "${current}" != "${expected}" ]]
}

refresh_backend_env_if_needed() {
  local service mismatched=false
  for service in backend-1 backend-2; do
    if backend_allowed_hosts_mismatch "${service}"; then
      mismatched=true
      log "${service} ALLOWED_HOSTS out of sync with .env — recreating"
      run_compose up -d --no-deps "${service}"
      if ! wait_backend_health "${service}"; then
        log "${service} failed after env sync"
        return 1
      fi
    fi
  done
  if [[ "${mismatched}" == "false" ]]; then
    return 0
  fi
  return 0
}

rollback() {
  local backend_tag="${1:-}"
  local caddy_tag="${2:-}"
  local rollback_backend="${3:-false}"
  local rollback_caddy="${4:-false}"

  if [[ "${rollback_backend}" == "true" && -n "${backend_tag}" ]]; then
    log "Rolling back backends to ${backend_tag}"
    BACKEND_IMAGE_TAG="${backend_tag}" run_compose pull backend-1 backend-2 || true
    BACKEND_IMAGE_TAG="${backend_tag}" run_compose up -d --no-deps backend-1 backend-2
    wait_backend_health backend-1 || true
    wait_backend_health backend-2 || true
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
    BACKEND_IMAGE_TAG="${new_backend_tag}" run_compose pull backend-1 backend-2

    if ! run_migrations "${new_backend_tag}"; then
      log "Database migration failed"
      exit 1
    fi

    log "Rolling deploy: backend-1 then backend-2"
    if ! deploy_backend_rolling "${new_backend_tag}" "${BACKEND_TAG_PREVIOUS}"; then
      log "Rolling backend deploy failed"
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
