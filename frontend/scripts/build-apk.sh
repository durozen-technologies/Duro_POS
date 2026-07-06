#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export CI=1

if [[ -z "${EXPO_PUBLIC_API_BASE_URL:-}" && -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ -z "${EXPO_PUBLIC_API_BASE_URL:-}" ]]; then
  echo "EXPO_PUBLIC_API_BASE_URL is required (set in frontend/.env)" >&2
  exit 1
fi

bun run icons:android
bunx expo prebuild --platform android --clean

cd android
chmod +x gradlew
./gradlew :app:assembleRelease --no-daemon
