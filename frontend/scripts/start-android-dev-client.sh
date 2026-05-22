#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AVD_NAME="${1:-MeatBillingPOS}"

cd "$ROOT_DIR"

bash ./scripts/start-android-emulator.sh "$AVD_NAME"
node ./scripts/cleanup-bundled-native-deps.js
npx expo start --dev-client --android
