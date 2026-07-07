# Caddy

Caddy is the active reverse proxy for the application.

## Responsibilities

- Terminate HTTPS for the public API hostname
- Proxy API traffic to backend replicas (`backend-1`, `backend-2`)
- Provide `/health` as a public readiness route
- Optionally proxy RustFS reads under `/rustfs/*`

## Key Files

```text
caddy/Dockerfile
caddy/Caddyfile
caddy/Caddyfile.template
caddy/docker-entrypoint.sh
```

`caddy/Caddyfile` is a placeholder. The runtime Caddyfile is generated at container start from `caddy/Caddyfile.template` plus `CADDY_PUBLIC_HOST`.

The template lives at `/usr/share/caddy/Caddyfile.template` in the image (not under `/etc/caddy`, which is a tmpfs mount in production).

## Production hostnames

| Secret / env | Purpose |
|--------------|---------|
| `CADDY_PUBLIC_HOST` | **Only** public API hostname — HTTPS via Let's Encrypt (e.g. DuckDNS domain) |
| `DEPLOY_HOST` | **SSH only** — CI deploy target; not served by Caddy |

Do not use `*.compute.amazonaws.com` as the public API URL. Let's Encrypt cannot issue certificates for AWS-owned hostnames.

## Runtime generation

The entrypoint requires:

```env
CADDY_PUBLIC_HOST=api-broiler360.duckdns.org
CADDY_ACME_EMAIL=admin@example.com
```

Generated site block (HTTPS, automatic certificates):

```caddyfile
api-broiler360.duckdns.org {
	import pos_api
}
```

## Routes

- `/health` → backend readiness probe
- `/rustfs/*` → `rustfs:9000` (internal clients only)
- all other routes → `backend-1:8000` and `backend-2:8000` (round robin)

## Compose usage

Local:

```bash
docker compose -f compose.yaml up -d --build
```

Production:

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d caddy
```

Published ports: `80`, `443`, `443/udp`.

## Healthcheck

Container healthcheck validates config and Caddy process:

```bash
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

Active upstream health checks use `/health` with `Host: backend-1` / `backend-2`; those names must appear in backend `ALLOWED_HOSTS` (CI adds them automatically).

## Public API URLs

| Endpoint | URL |
|----------|-----|
| Readiness | `https://<CADDY_PUBLIC_HOST>/health` |
| Full health | `https://<CADDY_PUBLIC_HOST>/api/v1/health` |

Production disables `/docs` and OpenAPI.

## Notes

- Caddy is the current production proxy (not nginx).
- TLS cert storage uses Docker volumes `caddy-data` and `caddy-config`.
- DuckDNS (or any DNS) **A record must point to the EC2 public IP** or HTTPS will fail.
