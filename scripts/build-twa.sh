#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# Bubblewrap TWA build script — runs inside GitHub Actions runner.
#
# Workflow (.github/workflows/build-android-twa.yml) is a thin shell
# that calls this script. All the iteration-prone logic lives here so
# we don't need the rare `workflow` OAuth scope to push fixes.
#
# Required env (set by the workflow):
#   - ANDROID_KEYSTORE_FILE
#   - ANDROID_KEYSTORE_PASSWORD
#   - ANDROID_KEY_ALIAS
#   - ANDROID_KEY_PASSWORD
#   - SHA256_FINGERPRINT
#   - APP_VERSION_CODE  (github.run_number)
#   - APP_VERSION_NAME  (1.0.<run_number>)
#   - GITHUB_WORKSPACE  (repo root, set by Actions)
#   - RUNNER_TEMP       (scratch dir, set by Actions)
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

WORK="${RUNNER_TEMP:-/tmp}/twa-build"
mkdir -p "$WORK"
cd "$WORK"

echo "▶ Step 1: Bootstrap project from live Web Manifest"
echo "  (Bubblewrap reads the actual PWA manifest from production —"
echo "   this guarantees TWA assets match what users see in their browser.)"
# bubblewrap init asks ~17 interactive questions. Pipe 30 empty lines
# to accept ALL defaults — we will overwrite the values that matter
# (packageId, signing key, version) immediately after via jq.
# --skipPwaValidation skips the Lighthouse-style PWA quality audit
# (we don't need it; the PWA is already production-deployed).
printf '\n%.0s' $(seq 1 40) \
  | bubblewrap init \
      --manifest="https://thelegendsonline.social/manifest.json" \
      --skipPwaValidation \
  || {
    echo "::error::bubblewrap init failed. Is the live manifest URL reachable?"
    curl -sI https://thelegendsonline.social/manifest.json || true
    exit 1
  }

echo ""
echo "▶ Step 2: Verify init produced a twa-manifest.json"
if [ ! -f "$WORK/twa-manifest.json" ]; then
  echo "::error::bubblewrap init did not produce twa-manifest.json"
  ls -la "$WORK"
  exit 1
fi

echo ""
echo "▶ Step 3: Override generated manifest with our custom config"
echo "  (packageId, signing key path, build version — the things that"
echo "   the interactive defaults don't get right.)"
jq \
  --arg vc "$APP_VERSION_CODE" \
  --arg vn "$APP_VERSION_NAME" \
  --arg ksPath "$ANDROID_KEYSTORE_FILE" \
  --arg ksAlias "$ANDROID_KEY_ALIAS" \
  --arg sha "$SHA256_FINGERPRINT" \
  '.packageId = "social.thelegendsonline.twa"
   | .name = "The Legends Online"
   | .launcherName = "Legends Online"
   | .host = "thelegendsonline.social"
   | .startUrl = "/"
   | .themeColor = "#0c1019"
   | .backgroundColor = "#0c1019"
   | .navigationColor = "#0c1019"
   | .navigationColorDark = "#0c1019"
   | .display = "standalone"
   | .orientation = "portrait"
   | .enableNotifications = true
   | .appVersionCode = ($vc|tonumber)
   | .appVersionName = $vn
   | .signingKey = { path: $ksPath, alias: $ksAlias }
   | .fingerprints = [{ name: "release", value: $sha }]' \
  twa-manifest.json > twa-manifest.json.new
mv twa-manifest.json.new twa-manifest.json

echo "─── Final twa-manifest.json ───"
cat twa-manifest.json
echo "───────────────────────────────"

echo ""
echo "▶ Step 4: Regenerate Android project files to apply manifest overrides"
# `bubblewrap update` rewrites the gradle/android source files from the
# (now patched) twa-manifest.json so packageId etc. propagate everywhere.
# --skipVersionUpgrade keeps the project on the bubblewrap version that
# init bootstrapped, which avoids surprise gradle plugin bumps mid-build.
bubblewrap update --skipVersionUpgrade

echo ""
echo "▶ Step 5: Build signed APK"
# bubblewrap build prompts for keystore + key passwords on stdin.
printf '%s\n%s\n' "$ANDROID_KEYSTORE_PASSWORD" "$ANDROID_KEY_PASSWORD" \
  | bubblewrap build --skipPwaValidation

echo ""
echo "▶ Step 6: Locate and verify the produced APK"
APK=""
for candidate in \
    "$WORK/app-release-signed.apk" \
    "$WORK/app/build/outputs/apk/release/app-release.apk"; do
  if [ -f "$candidate" ]; then
    APK="$candidate"
    break
  fi
done
if [ -z "$APK" ]; then
  APK=$(find "$WORK" -maxdepth 4 -name "*.apk" | head -1)
fi
if [ -z "$APK" ] || [ ! -f "$APK" ]; then
  echo "::error::No APK found after build. Contents of $WORK:"
  find "$WORK" -maxdepth 4 -type f \( -name "*.apk" -o -name "*.aab" \) -ls
  exit 1
fi
echo "Found APK: $APK"

BUILD_TOOLS=$(ls "$ANDROID_HOME/build-tools/" | tail -1)
"$ANDROID_HOME/build-tools/$BUILD_TOOLS/apksigner" verify --print-certs "$APK"

mkdir -p "$GITHUB_WORKSPACE/_release"
cp "$APK" "$GITHUB_WORKSPACE/_release/The Legends Online (TWA).apk"
ls -la "$GITHUB_WORKSPACE/_release/"

echo ""
echo "▶ Step 7: Done. APK ready at _release/The Legends Online (TWA).apk"
