#!/bin/sh
# Production host from CADDY_PUBLIC_HOST (e.g. pos.durozen.in).
set -eu

if [ -z "${CADDY_PUBLIC_HOST:-}" ]; then
  echo "CADDY_PUBLIC_HOST is required" >&2
  exit 1
fi

case "${CADDY_PUBLIC_HOST}" in
  *[!a-zA-Z0-9.:_-]*)
    echo "CADDY_PUBLIC_HOST contains invalid characters" >&2
    exit 1
    ;;
  *)
    ;;
esac

{
  cat /usr/share/caddy/Caddyfile.template
  printf '%s {\n\timport pos_api\n}\n' "${CADDY_PUBLIC_HOST}"
} > /etc/caddy/Caddyfile

echo "Caddy site: ${CADDY_PUBLIC_HOST} (HTTPS)"

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
