#!/bin/sh
set -eu

if [ -z "${CADDY_PUBLIC_HOST:-}" ]; then
  echo "CADDY_PUBLIC_HOST is required" >&2
  exit 1
fi

{
  cat /etc/caddy/Caddyfile.template
  printf '\n%s {\n\timport pos_api\n}\n' "${CADDY_PUBLIC_HOST}"
} > /etc/caddy/Caddyfile

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
