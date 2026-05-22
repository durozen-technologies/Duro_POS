#!/bin/sh
set -eu

mkdir -p /data
chown -R 10001:10001 /data

if [ "$#" -eq 0 ] || [ "$1" = "/data" ]; then
  exec /entrypoint.sh rustfs "$@"
fi

exec "$@"
