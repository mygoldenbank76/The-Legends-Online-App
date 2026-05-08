#!/usr/bin/env node
// Programmatic Bubblewrap TWA build — bypasses the interactive CLI.
//
// Why: the bubblewrap CLI uses inquirer.js which requires a TTY and
// refuses piped stdin. In CI we can't fake a TTY reliably across init,
// build, and password prompts. Using @bubblewrap/core directly skips
// all prompts and gives us deterministic, scriptable behaviour.
//
// Required env (set by build-twa.sh):
//   TWA_PROJECT_DIR, JAVA_HOME, ANDROID_HOME,
//   APP_VERSION_CODE, APP_VERSION_NAME, SHA256_FINGERPRINT,
//   ANDROID_KEYSTORE_FILE, ANDROID_KEYSTORE_PASSWORD,
//   ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD

import {
  Config, JdkHelper, AndroidSdkTools, GradleWrapper,
  TwaGenerator, TwaManifest, ConsoleLog,
} from '@bubblewrap/core';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const log = new ConsoleLog('twa');
const PROJECT_DIR = process.env.TWA_PROJECT_DIR;
const MANIFEST_URL = 'https://thelegendsonline.social/manifest.json';
const PACKAGE_ID = 'social.thelegendsonline.twa';

if (!PROJECT_DIR) {
  console.error('TWA_PROJECT_DIR is required');
  process.exit(1);
}

console.log(`▶ Project dir: ${PROJECT_DIR}`);
fs.mkdirSync(PROJECT_DIR, { recursive: true });

// ── 1. Tooling configuration ────────────────────────────────────────
console.log('▶ Step 1: Configure JDK + Android SDK');
const config = new Config(process.env.JAVA_HOME, process.env.ANDROID_HOME);
const jdkHelper = new JdkHelper(process, config);
const androidSdkTools = await AndroidSdkTools.create(process, config, jdkHelper, log);

// ── 2. Fetch live PWA manifest ──────────────────────────────────────
console.log(`▶ Step 2: Fetch web manifest from ${MANIFEST_URL}`);
const res = await fetch(MANIFEST_URL);
if (!res.ok) throw new Error(`HTTP ${res.status} fetching manifest`);
const webManifest = await res.json();
console.log('  Web manifest fetched:', JSON.stringify(webManifest).slice(0, 300));

// ── 3. Synthesize TWA manifest from web manifest ────────────────────
console.log('▶ Step 3: Synthesize TWA manifest');
const baseManifest = await TwaManifest.fromWebManifestJson(
  new URL(MANIFEST_URL),
  webManifest,
);

// ── 4. Override what the web manifest can't provide ────────────────
const j = baseManifest.toJson();
j.packageId = PACKAGE_ID;
j.name = 'The Legends Online';
j.launcherName = 'Legends Online';
j.host = 'thelegendsonline.social';
j.startUrl = '/';
j.themeColor = '#0c1019';
j.backgroundColor = '#0c1019';
j.navigationColor = '#0c1019';
j.navigationColorDark = '#0c1019';
j.appVersionCode = parseInt(process.env.APP_VERSION_CODE, 10);
j.appVersionName = process.env.APP_VERSION_NAME;
j.signingKey = {
  path: process.env.ANDROID_KEYSTORE_FILE,
  alias: process.env.ANDROID_KEY_ALIAS,
};
j.fingerprints = [{ name: 'release', value: process.env.SHA256_FINGERPRINT }];
j.enableNotifications = true;
j.fallbackType = j.fallbackType ?? 'customtabs';

const manifestPath = path.join(PROJECT_DIR, 'twa-manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify(j, null, 2));
console.log(`▶ Wrote ${manifestPath}`);
console.log(JSON.stringify(j, null, 2));

// ── 5. Reload from disk so Color/etc. are typed correctly ──────────
const finalManifest = await TwaManifest.fromFile(manifestPath);

// ── 6. Generate Android project files ──────────────────────────────
console.log('▶ Step 6: Generate Android project files');
const gen = new TwaGenerator();
await gen.createTwaProject(PROJECT_DIR, finalManifest, log);

// ── 7. Build release APK via Gradle ────────────────────────────────
console.log('▶ Step 7: Build release APK with Gradle (this takes 3-6 min)');
const gradle = new GradleWrapper(process, androidSdkTools, PROJECT_DIR);
await gradle.assembleRelease();

// ── 8. Sign APK with apksigner ─────────────────────────────────────
console.log('▶ Step 8: Sign APK with apksigner');
const unsignedApk = path.join(PROJECT_DIR, 'app/build/outputs/apk/release/app-release-unsigned.apk');
const signedApk = path.join(PROJECT_DIR, 'app-release-signed.apk');

if (!fs.existsSync(unsignedApk)) {
  console.error('::error::Unsigned APK not found at', unsignedApk);
  const out = path.join(PROJECT_DIR, 'app/build/outputs');
  if (fs.existsSync(out)) {
    const list = fs.readdirSync(out, { recursive: true });
    console.error('Contents of app/build/outputs:', list);
  }
  process.exit(1);
}

const buildToolsRoot = path.join(process.env.ANDROID_HOME, 'build-tools');
const btVersions = fs.readdirSync(buildToolsRoot).sort();
const apksigner = path.join(buildToolsRoot, btVersions[btVersions.length - 1], 'apksigner');

const signResult = spawnSync(apksigner, [
  'sign',
  '--ks', process.env.ANDROID_KEYSTORE_FILE,
  '--ks-pass', 'pass:' + process.env.ANDROID_KEYSTORE_PASSWORD,
  '--ks-key-alias', process.env.ANDROID_KEY_ALIAS,
  '--key-pass', 'pass:' + process.env.ANDROID_KEY_PASSWORD,
  '--out', signedApk,
  unsignedApk,
], { stdio: 'inherit' });

if (signResult.status !== 0) {
  console.error('::error::apksigner exited with', signResult.status);
  process.exit(1);
}

console.log(`✓ Signed APK ready at: ${signedApk}`);
