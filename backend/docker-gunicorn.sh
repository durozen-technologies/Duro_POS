#!/bin/sh
set -eu

workers="${WEB_CONCURRENCY:-1}"
if [ "${workers}" = "auto" ]; then
  workers="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1)"
fi

exec gunicorn main:app \
  --bind "0.0.0.0:${PORT:-8000}" \
  --worker-class uvicorn_worker.UvicornWorker \
  --workers "${workers}" \
  --timeout "${GUNICORN_TIMEOUT:-60}" \
  --graceful-timeout "${GUNICORN_GRACEFUL_TIMEOUT:-30}" \
  --keep-alive "${GUNICORN_KEEPALIVE:-5}" \
  --access-logfile - \
  --error-logfile - \
  --log-level "${LOG_LEVEL:-info}" \
  --capture-output
