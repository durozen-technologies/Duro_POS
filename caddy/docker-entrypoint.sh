#!/bin/sh
set -eu

validate_host() {
  host="$1"
  case "$host" in
    *[!a-zA-Z0-9.:\[\]_-]*)
      echo "Invalid hostname: ${host}" >&2
      return 1
      ;;
  esac
  return 0
}

# ponytail: LE cannot cert amazonaws.com or bare IPs — serve those on HTTP only
is_http_only_host() {
  host="$1"
  case "$host" in
    *.amazonaws.com) return 0 ;;
    \[*\]) return 0 ;;
  esac
  if printf '%s' "$host" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
    return 0
  fi
  return 1
}

emit_site() {
  host="$1"
  if is_http_only_host "$host"; then
    case "$host" in
      \[*\]) addr="$host" ;;
      *) addr="$host" ;;
    esac
    printf 'http://%s {\n\timport pos_api\n}\n' "$addr"
  else
    printf '%s {\n\timport pos_api\n}\n' "$host"
  fi
}

if [ -z "${CADDY_PUBLIC_HOST:-}" ]; then
  echo "CADDY_PUBLIC_HOST is required" >&2
  exit 1
fi

validate_host "${CADDY_PUBLIC_HOST}"

{
  cat /usr/share/caddy/Caddyfile.template
  emit_site "${CADDY_PUBLIC_HOST}"
  if [ -n "${CADDY_EXTRA_HOSTS:-}" ]; then
    OLDIFS="$IFS"
    IFS=','
    for host in ${CADDY_EXTRA_HOSTS}; do
      host=$(printf '%s' "$host" | tr -d ' ')
      [ -z "$host" ] && continue
      [ "$host" = "${CADDY_PUBLIC_HOST}" ] && continue
      validate_host "$host" || continue
      emit_site "$host"
    done
    IFS="$OLDIFS"
  fi
} > /etc/caddy/Caddyfile

echo "Caddy sites: ${CADDY_PUBLIC_HOST} (HTTPS when allowed)${CADDY_EXTRA_HOSTS:+, extras=${CADDY_EXTRA_HOSTS}}"

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
