#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# Bubblewrap TWA build — orchestrator.
#
# All build logic lives in scripts/build-twa.mjs which calls the
# Bubblewrap API directly (no interactive prompts — see that file).
# We install @bubblewrap/core locally in the build directory because
# Node ESM ignores NODE_PATH and won't resolve global packages.
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

WORK="${RUNNER_TEMP:-/tmp}/twa-build"
export TWA_PROJECT_DIR="$WORK"
mkdir -p "$WORK"

echo "▶ Setting up local node_modules with @bubblewrap/core"
cd "$WORK"
cat > package.json <<EOF
{
  "name": "twa-build-runner",
  "version": "0.0.0",
  "private": true,
  "type": "module"
}
EOF
npm install --no-audit --no-fund @bubblewrap/core@latest

echo "▶ Copying build script into work dir (so ESM resolution sees the local node_modules)"
cp "$GITHUB_WORKSPACE/scripts/build-twa.mjs" "$WORK/build-twa.mjs"

echo "▶ Running build script"
cd "$WORK"
node build-twa.mjs

APK="$WORK/app-release-signed.apk"
if [ ! -f "$APK" ]; then
  echo "::error::Signed APK missing at $APK"
  find "$WORK" -maxdepth 6 -name "*.apk" -ls || true
  exit 1
fi

echo "▶ Verifying signature"
BT=$(ls "$ANDROID_HOME/build-tools/" | tail -1)
"$ANDROID_HOME/build-tools/$BT/apksigner" verify --print-certs "$APK"

mkdir -p "$GITHUB_WORKSPACE/_release"
cp "$APK" "$GITHUB_WORKSPACE/_release/The Legends Online (TWA).apk"
ls -la "$GITHUB_WORKSPACE/_release/"
echo "✓ Done — APK staged for upload"
