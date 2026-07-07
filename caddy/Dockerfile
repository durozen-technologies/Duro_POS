# syntax=docker/dockerfile:1.7

ARG CADDY_VERSION=2.9.1
ARG CADDY_UID=10001
ARG CADDY_GID=10001
ARG BUILD_VERSION=dev
ARG BUILD_REVISION=unknown

FROM caddy:${CADDY_VERSION}-builder AS builder

RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    xcaddy build \
    --with github.com/mholt/caddy-ratelimit@v0.1.0


FROM caddy:${CADDY_VERSION}-alpine AS runtime

ARG CADDY_UID
ARG CADDY_GID
ARG BUILD_VERSION
ARG BUILD_REVISION

LABEL org.opencontainers.image.title="Brolier 360 Caddy" \
      org.opencontainers.image.description="TLS reverse proxy for DuroPOS / Brolier 360" \
      org.opencontainers.image.vendor="Durozen" \
      org.opencontainers.image.version="${BUILD_VERSION}" \
      org.opencontainers.image.revision="${BUILD_REVISION}"

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
# ponytail: template lives outside /etc/caddy — compose tmpfs mounts that dir empty at runtime
COPY Caddyfile.template /usr/share/caddy/Caddyfile.template
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN set -eux; \
    addgroup -S -g "${CADDY_GID}" caddyapp; \
    adduser -S -D -H -u "${CADDY_UID}" -G caddyapp -s /sbin/nologin caddyapp; \
    mkdir -p /config /data /etc/caddy /usr/share/caddy; \
    chown -R caddyapp:caddyapp /config /data /etc/caddy /usr/share/caddy; \
    chmod 0755 /usr/local/bin/docker-entrypoint.sh

USER caddyapp:caddyapp

EXPOSE 80 443 443/udp
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
    CMD caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && pidof caddy >/dev/null

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
