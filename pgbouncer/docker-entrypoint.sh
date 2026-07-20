#!/bin/sh
set -eu

: "${POSTGRES_USER:?Set POSTGRES_USER}"
: "${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD}"

PGBOUNCER_DEFAULT_POOL_SIZE="${PGBOUNCER_DEFAULT_POOL_SIZE:-40}"
PGBOUNCER_MAX_CLIENT_CONN="${PGBOUNCER_MAX_CLIENT_CONN:-400}"
PGBOUNCER_MAX_DB_CONNECTIONS="${PGBOUNCER_MAX_DB_CONNECTIONS:-80}"
PGBOUNCER_RESERVE_POOL_SIZE="${PGBOUNCER_RESERVE_POOL_SIZE:-10}"

INI="/etc/pgbouncer/pgbouncer.ini"

sed -i \
  -e "s/^default_pool_size = .*/default_pool_size = ${PGBOUNCER_DEFAULT_POOL_SIZE}/" \
  -e "s/^max_client_conn = .*/max_client_conn = ${PGBOUNCER_MAX_CLIENT_CONN}/" \
  -e "s/^max_db_connections = .*/max_db_connections = ${PGBOUNCER_MAX_DB_CONNECTIONS}/" \
  -e "s/^reserve_pool_size = .*/reserve_pool_size = ${PGBOUNCER_RESERVE_POOL_SIZE}/" \
  "${INI}"

USERLIST="/etc/pgbouncer/userlist.txt"
printf '"%s" "%s"\n' "${POSTGRES_USER}" "${POSTGRES_PASSWORD}" > "${USERLIST}"
chmod 600 "${USERLIST}"

exec pgbouncer "${INI}"
