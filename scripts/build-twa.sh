#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# Bubblewrap TWA build — orchestrator.
#
# Installs @bubblewrap/core globally, then defers all build logic to
# scripts/build-twa.mjs which calls the Bubblewrap API directly (no
# interactive prompts — see that file for why).
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

WORK="${RUNNER_TEMP:-/tmp}/twa-build"
export TWA_PROJECT_DIR="$WORK"

echo "▶ Installing @bubblewrap/core (used programmatically, bypasses CLI prompts)"
npm install -g @bubblewrap/core@latest

echo "▶ Running scripts/build-twa.mjs"
NODE_PATH="$(npm root -g)" node "$GITHUB_WORKSPACE/scripts/build-twa.mjs"

APK="$TWA_PROJECT_DIR/app-release-signed.apk"
if [ ! -f "$APK" ]; then
  echo "::error::Signed APK missing at $APK"
  find "$TWA_PROJECT_DIR" -maxdepth 6 -name "*.apk" -ls || true
  exit 1
fi

echo "▶ Verifying signature"
BT=$(ls "$ANDROID_HOME/build-tools/" | tail -1)
"$ANDROID_HOME/build-tools/$BT/apksigner" verify --print-certs "$APK"

mkdir -p "$GITHUB_WORKSPACE/_release"
cp "$APK" "$GITHUB_WORKSPACE/_release/The Legends Online (TWA).apk"
ls -la "$GITHUB_WORKSPACE/_release/"
echo "✓ Done — APK staged for upload"
