#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEVICE_NAME="${1:-}"

cd "$ROOT_DIR"

if [[ -n "$DEVICE_NAME" ]]; then
  npx expo run:android --device "$DEVICE_NAME"
else
  npx expo run:android --device
fi
