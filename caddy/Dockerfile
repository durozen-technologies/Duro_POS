FROM caddy:2-builder AS builder

RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    xcaddy build \
    --with github.com/mholt/caddy-ratelimit \
    --with github.com/caddy-dns/duckdns

FROM caddy:2-alpine

ENV CADDY_UPSTREAM="backend:8000" \
    CADDY_RATE_LIMIT_EVENTS="120" \
    CADDY_RATE_LIMIT_WINDOW="1m"

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile.template /etc/caddy/Caddyfile.template
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 80 443 443/udp

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
