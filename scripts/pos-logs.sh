#!/usr/bin/env bash
# View or export production logs from the VM home directory.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-${DEPLOY_ROOT}/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-${DEPLOY_ROOT}/.env}"
LOG_DIR="${DEPLOY_ROOT}/logs"
ARCHIVE_DIR="${LOG_DIR}/archive"
SERVICES=(postgres pgbouncer redis rustfs backend-1 backend-2 caddy)

export COMPOSE_PROFILES="${COMPOSE_PROFILES:-infra}"

compose() {
  docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" "$@"
}

usage() {
  cat <<EOF
Usage: pos-logs [command] [service]

Commands:
  (none)              Follow all service logs (live)
  <service>           Follow one service (postgres|pgbouncer|redis|rustfs|backend-1|backend-2|caddy)
  export              Export logs to ${LOG_DIR}/<service>.log
  export-archive      Export combined log to ${ARCHIVE_DIR}/pos-YYYYMMDD.log
  tail <service>      tail -f exported log file
  deploy              tail -f deploy.log
  ps                  Show compose service status

Examples:
  ~/pos-logs
  ~/pos-logs backend
  ~/pos-logs export
  ~/pos-logs tail backend
  ~/pos-logs deploy
EOF
}

cmd_export() {
  mkdir -p "${LOG_DIR}" "${ARCHIVE_DIR}"
  local svc
  for svc in "${SERVICES[@]}"; do
    if compose ps --services 2>/dev/null | grep -qx "${svc}"; then
      compose logs --no-color --tail=500 "${svc}" >"${LOG_DIR}/${svc}.log" 2>&1 || true
      echo "Wrote ${LOG_DIR}/${svc}.log"
    fi
  done
}

cmd_export_archive() {
  mkdir -p "${ARCHIVE_DIR}"
  local outfile="${ARCHIVE_DIR}/pos-$(date -u +'%Y%m%d').log"
  {
    echo "=== POS log archive $(date -u +'%Y-%m-%dT%H:%M:%SZ') ==="
    compose logs --no-color --tail=2000 2>&1 || true
  } >>"${outfile}"
  echo "Appended to ${outfile}"
}

cmd_tail() {
  local svc="${1:-}"
  if [[ -z "${svc}" ]]; then
    echo "Usage: pos-logs tail <service>" >&2
    exit 1
  fi
  local logfile="${LOG_DIR}/${svc}.log"
  if [[ ! -f "${logfile}" ]]; then
    echo "No ${logfile} — run: pos-logs export" >&2
    exit 1
  fi
  tail -f "${logfile}"
}

main() {
  local cmd="${1:-}"
  shift || true

  case "${cmd}" in
    ""|follow)
      compose logs -f --tail=200 "$@"
      ;;
    export)
      cmd_export
      ;;
    export-archive)
      cmd_export_archive
      ;;
    tail)
      cmd_tail "$@"
      ;;
    deploy)
      touch "${LOG_DIR}/deploy.log"
      tail -f "${LOG_DIR}/deploy.log"
      ;;
    ps|status)
      compose ps
      ;;
    help|-h|--help)
      usage
      ;;
    postgres|pgbouncer|redis|rustfs|backend-1|backend-2|caddy)
      compose logs -f --tail=200 "${cmd}"
      ;;
    *)
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
