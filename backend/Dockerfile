# syntax=docker/dockerfile:1.7

ARG PYTHON_VERSION=3.11.11
ARG UV_VERSION=0.11.3
ARG APP_UID=10001
ARG APP_GID=10001

FROM python:${PYTHON_VERSION}-slim-bookworm AS deps

ARG UV_VERSION

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /app

RUN python -m pip install --no-cache-dir "uv==${UV_VERSION}"

COPY pyproject.toml uv.lock README.md ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-install-project


FROM deps AS builder

COPY main.py migrate.py alembic.ini ./
COPY app ./app
COPY migrations ./migrations
COPY assets ./assets

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev


FROM python:${PYTHON_VERSION}-slim-bookworm AS runtime

ARG APP_UID
ARG APP_GID
ARG BUILD_VERSION=dev
ARG BUILD_REVISION=unknown

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8000 \
    HOME=/home/app \
    TMPDIR=/tmp/app \
    VIRTUAL_ENV=/app/.venv \
    PATH="/app/.venv/bin:${PATH}"

LABEL org.opencontainers.image.title="Brolier 360 API" \
      org.opencontainers.image.description="FastAPI backend for DuroPOS / Brolier 360" \
      org.opencontainers.image.vendor="Durozen" \
      org.opencontainers.image.version="${BUILD_VERSION}" \
      org.opencontainers.image.revision="${BUILD_REVISION}" \
      org.opencontainers.image.source="https://github.com/durozen/DuroPOS" \
      org.opencontainers.image.licenses="Proprietary"

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && addgroup --system --gid "${APP_GID}" app \
    && adduser --system --uid "${APP_UID}" --ingroup app --home "${HOME}" --no-create-home --disabled-password app \
    && mkdir -p "${HOME}" /app/assets "${TMPDIR}" \
    && chown -R app:app "${HOME}" /app/assets "${TMPDIR}"

COPY --from=builder --chown=app:app /app/.venv /app/.venv
COPY --from=builder --chown=app:app /app/main.py /app/migrate.py /app/alembic.ini ./
COPY --from=builder --chown=app:app /app/app /app/app
COPY --from=builder --chown=app:app /app/migrations /app/migrations
COPY --from=builder --chown=app:app /app/assets /app/assets
COPY --chown=app:app --chmod=0755 docker-entrypoint.sh /docker-entrypoint.sh
COPY --chown=app:app --chmod=0755 docker-gunicorn.sh /app/docker-gunicorn.sh

USER app:app

EXPOSE 8000
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/health || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["/app/docker-gunicorn.sh"]
