FROM caddy:2-builder AS builder

RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    xcaddy build \
    --with github.com/mholt/caddy-ratelimit

FROM caddy:2-alpine

ENV CADDY_SITE_ADDRESSES="localhost, 127.0.0.1" \
    CADDY_UPSTREAM="backend:8000" \
    CADDY_RATE_LIMIT_EVENTS="120" \
    CADDY_RATE_LIMIT_WINDOW="1m"

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 80 443 443/udp
