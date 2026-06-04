# Caddy

Caddy is the active reverse proxy for the application.

## Responsibilities

- Terminate HTTPS
- Proxy API traffic to the backend
- Provide `/health` as a public health route mapped to `/api/v1/health`
- Optionally proxy RustFS reads under `/rustfs/*`
- Support DuckDNS DNS challenge TLS

## Key Files

```text
caddy/Dockerfile
caddy/Caddyfile
caddy/Caddyfile.template
caddy/docker-entrypoint.sh
caddy/data/
caddy/config/
```

`caddy/Caddyfile` is a placeholder. The runtime Caddyfile is generated from `caddy/Caddyfile.template` by `caddy/docker-entrypoint.sh`.

## Runtime Generation

The entrypoint requires:

```env
CADDY_PUBLIC_HOST=your-public-host.example.com
CADDY_ACME_EMAIL=admin@example.com
CADDY_UPSTREAM=backend:8000
```

Optional DuckDNS host:

```env
CADDY_DUCKDNS_HOST=your-subdomain.duckdns.org
DUCKDNS_API_TOKEN=...
```

## Routes

- `/health` proxies to `backend:8000/api/v1/health`
- `/rustfs/*` proxies to `rustfs:9000`
- all other routes proxy to `CADDY_UPSTREAM`, usually `backend:8000`

## Compose Usage

Local active stack:

```bash
docker compose -f compose.yaml up -d --build
```

Production stack:

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d caddy
```

Published ports:

```text
80:80
443:443
443:443/udp
```

## Healthcheck

The container healthcheck validates the Caddy config and checks the Caddy process:

```bash
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

## Notes

- Caddy is the current production proxy.
- Nginx config exists in the repo but is not the active production proxy.
- Caddy data and config are stored in Docker volumes in production compose.

