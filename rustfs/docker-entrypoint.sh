#!/bin/sh
set -eu

: "${RUSTFS_DATA_UID:=10001}"
: "${RUSTFS_DATA_GID:=10001}"

if [ ! -d /data ]; then
  echo "RustFS data directory /data does not exist." >&2
  exit 1
fi

if [ ! -w /data ]; then
  echo "RustFS data directory /data is not writable by UID:GID ${RUSTFS_DATA_UID}:${RUSTFS_DATA_GID}." >&2
  echo "Set ownership on the mounted data directory before starting the container." >&2
  exit 1
fi

mkdir -p /logs 2>/dev/null || true
if [ ! -w /logs ]; then
  echo "RustFS log directory /logs is not writable by UID:GID ${RUSTFS_DATA_UID}:${RUSTFS_DATA_GID}." >&2
  exit 1
fi

if [ "$#" -eq 0 ]; then
  exec /entrypoint.sh rustfs /data
fi

if [ "$1" = "/data" ] || [ "${1#-}" != "$1" ]; then
  exec /entrypoint.sh rustfs "$@"
fi

exec "$@"
