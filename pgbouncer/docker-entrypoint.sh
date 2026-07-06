#!/bin/sh
set -eu

: "${POSTGRES_USER:?Set POSTGRES_USER}"
: "${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD}"

USERLIST="/etc/pgbouncer/userlist.txt"
printf '"%s" "%s"\n' "${POSTGRES_USER}" "${POSTGRES_PASSWORD}" > "${USERLIST}"
chmod 600 "${USERLIST}"

exec pgbouncer /etc/pgbouncer/pgbouncer.ini
