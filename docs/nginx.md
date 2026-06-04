# Nginx

Nginx is present as an alternate proxy configuration in `nginx/`. The active stack currently uses Caddy.

## Responsibilities

When used, Nginx:

- listens on port `8080` inside the container
- proxies requests to `backend:8000`
- maps `/health` to `/api/v1/health`
- exposes `/nginx-health`
- forwards `X-Forwarded-*` headers
- supports WebSocket upgrade headers

## Key Files

```text
nginx/Dockerfile
nginx/default.conf
nginx/nginx.conf
compose.yaml
```

`compose.yaml` still contains a commented older Nginx service. The active service in `compose.yaml` is Caddy.

## Internal Routes

```text
/nginx-health  local Nginx health response
/health        proxies backend /api/v1/health
/*             proxies to backend:8000
```

## Configuration Notes

The config uses Docker DNS:

```nginx
resolver 127.0.0.11 ipv6=off valid=30s;
set $backend_upstream http://backend:8000;
```

This means Nginx expects to run inside the same Docker network as `backend`.

## When To Use

Use Nginx only if you intentionally switch from Caddy or need a local HTTP-only reverse proxy for testing. For current production HTTPS, use Caddy.

## Validation

Inside the Nginx container:

```bash
nginx -t
```

