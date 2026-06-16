# syntax=docker/dockerfile:1.7

ARG CADDY_VERSION=2

FROM caddy:${CADDY_VERSION}-builder AS builder

RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    xcaddy build \
    --with github.com/mholt/caddy-ratelimit

FROM caddy:${CADDY_VERSION}-alpine AS runtime

ARG CADDY_UID=10001
ARG CADDY_GID=10001

ENV CADDY_UPSTREAM="backend:8000"

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile.template /etc/caddy/Caddyfile.template
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN set -eux; \
    addgroup -S -g "${CADDY_GID}" caddyapp; \
    adduser -S -D -H -u "${CADDY_UID}" -G caddyapp -s /sbin/nologin caddyapp; \
    mkdir -p /config /data /etc/caddy; \
    chown -R caddyapp:caddyapp /config /data /etc/caddy; \
    chmod 0755 /usr/local/bin/docker-entrypoint.sh; \
    setcap cap_net_bind_service=+ep /usr/bin/caddy

USER caddyapp:caddyapp

EXPOSE 80 443 443/udp
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
    CMD caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && pidof caddy >/dev/null

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
