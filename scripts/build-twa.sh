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

echo "▶ Diagnostic: ANDROID_HOME structure"
echo "  ANDROID_HOME=$ANDROID_HOME"
ls -la "$ANDROID_HOME" || true
echo "  cmdline-tools:"
ls -la "$ANDROID_HOME/cmdline-tools" 2>/dev/null || echo "  (none)"
echo "  build-tools:"
ls -la "$ANDROID_HOME/build-tools" 2>/dev/null || echo "  (none)"
echo "  platforms:"
ls -la "$ANDROID_HOME/platforms" 2>/dev/null || echo "  (none)"
echo "  platform-tools:"
ls -la "$ANDROID_HOME/platform-tools" 2>/dev/null || echo "  (none)"

echo ""
echo "▶ Bubblewrap validates: \$ANDROID_HOME/tools OR \$ANDROID_HOME/bin must exist"
echo "  (it expects the legacy SDK layout). The runner uses cmdline-tools/,"
echo "  so we symlink tools -> the real cmdline-tools install dir that has bin/sdkmanager."
if [ ! -e "$ANDROID_HOME/tools" ] && [ ! -e "$ANDROID_HOME/bin" ]; then
  # Find a cmdline-tools subdir that actually contains bin/sdkmanager.
  CT_REAL=""
  for d in "$ANDROID_HOME/cmdline-tools/"*/; do
    if [ -x "$d/bin/sdkmanager" ]; then
      CT_REAL="$d"
      break
    fi
  done
  if [ -z "$CT_REAL" ]; then
    echo "::error::No cmdline-tools subdir with bin/sdkmanager found under $ANDROID_HOME/cmdline-tools/"
    ls -la "$ANDROID_HOME/cmdline-tools/" || true
    exit 1
  fi
  ln -sfn "${CT_REAL%/}" "$ANDROID_HOME/tools"
  echo "  ✓ Symlinked $ANDROID_HOME/tools -> $CT_REAL"
fi
ls -la "$ANDROID_HOME/tools/bin/" 2>/dev/null | head -3 || true

echo ""
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
