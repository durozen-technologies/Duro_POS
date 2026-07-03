#!/bin/sh
set -eu

echo "Running database migrations before starting the API..."
python migrate.py --tenants

exec "$@"
w