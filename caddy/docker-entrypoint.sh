#!/bin/sh
set -eu

if [ -z "${CADDY_PUBLIC_HOST:-}" ]; then
  echo "CADDY_PUBLIC_HOST is required" >&2
  exit 1
fi

{
  sed '/# __CADDY_PUBLIC_HOST_BLOCK__/d; /# __CADDY_DUCKDNS_HOST_BLOCK__/d' /etc/caddy/Caddyfile.template
  printf '%s {\n\ttls\n\timport pos_api\n}\n\n' "${CADDY_PUBLIC_HOST}"
  if [ -n "${CADDY_DUCKDNS_HOST:-}" ]; then
    printf '%s {\n\ttls {\n\t\tdns duckdns {$DUCKDNS_API_TOKEN}\n\t\tresolvers 1.1.1.1 8.8.8.8\n\t}\n\timport pos_api\n}\n' "${CADDY_DUCKDNS_HOST}"
  fi
} > /etc/caddy/Caddyfile

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
