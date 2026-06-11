# syntax=docker/dockerfile:1.7

ARG PYTHON_VERSION=3.11
ARG UV_VERSION=0.11.3

FROM python:${PYTHON_VERSION}-slim-bookworm AS builder

ARG UV_VERSION

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /app

RUN python -m pip install --no-cache-dir "uv==${UV_VERSION}"

COPY pyproject.toml uv.lock README.md ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-install-project

COPY . .


FROM python:${PYTHON_VERSION}-slim-bookworm AS runtime

ARG APP_UID=10001
ARG APP_GID=10001

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000 \
    HOME=/home/app \
    VIRTUAL_ENV=/app/.venv \
    PATH="/app/.venv/bin:${PATH}"

WORKDIR /app

RUN addgroup --system --gid "${APP_GID}" app \
    && adduser --system --uid "${APP_UID}" --ingroup app --home "${HOME}" app \
    && mkdir -p "${HOME}" /app/assets \
    && chown app:app "${HOME}"

COPY --from=builder --chown=app:app /app/.venv /app/.venv
COPY --from=builder --chown=app:app /app/main.py /app/main.py
COPY --from=builder --chown=app:app /app/migrate.py /app/migrate.py
COPY --from=builder --chown=app:app /app/alembic.ini /app/alembic.ini
COPY --from=builder --chown=app:app /app/app /app/app
COPY --from=builder --chown=app:app /app/migrations /app/migrations
COPY --from=builder --chown=app:app /app/scripts /app/scripts
COPY --from=builder --chown=app:app /app/assets /app/assets
COPY --chown=app:app --chmod=0755 docker-entrypoint.sh /docker-entrypoint.sh

USER app:app

EXPOSE 8000
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=5).getcode()==200 else 1)"

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["sh", "-c", "exec gunicorn main:app --bind 0.0.0.0:${PORT:-8000} --worker-class uvicorn_worker.UvicornWorker --workers ${WEB_CONCURRENCY:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1)} --timeout ${GUNICORN_TIMEOUT:-60} --graceful-timeout ${GUNICORN_GRACEFUL_TIMEOUT:-30} --keep-alive ${GUNICORN_KEEPALIVE:-5} --access-logfile - --error-logfile - --log-level ${LOG_LEVEL:-info} --capture-output"]
