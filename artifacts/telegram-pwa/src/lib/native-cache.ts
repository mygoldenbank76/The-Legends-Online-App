/**
 * Native Capacitor Filesystem cache for the APK build.
 *
 * Why: on the APK (Capacitor WebView) the standard browser Cache
 * Storage and IndexedDB blob storage are subject to Android WebView's
 * quota policy, which can evict aggressively under disk pressure and
 * caps total storage at a fraction of free disk. The native filesystem
 * has none of those limits — Telegram's TDLib uses its own FileManager
 * for exactly this reason.
 *
 * On web/PWA this module is a no-op (Capacitor.isNativePlatform()
 * returns false), and the existing service-worker cache + in-memory
 * blob cache continue to handle persistence. The native layer only
 * activates when the bundle is actually running inside the Android
 * APK shell.
 *
 * Storage layout (under Filesystem Directory.Cache):
 *   telechat-media/avatars/<sha1>
 *   telechat-media/thumbs/<sha1>
 *   telechat-media/media/<sha1>
 *   telechat-media/docs/<sha1>
 *
 * LRU index lives in localStorage (small JSON, ~100 bytes per entry).
 * IndexedDB would be cleaner but the index is tiny enough that a
 * synchronous read on startup is fine and simpler.
 *
 * Trim policy: per-category byte quota, drop oldest by lastAccess
 * until we're back under quota. Trim is opportunistic (called from
 * put after a write) and never blocks reads.
 */

import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

// Quotas per category in bytes. Defaults loosely model Telegram's
// FileManager defaults (avatars are forever, thumbs survive, media is
// the bulk, docs are bounded). Easily tweaked from a future settings
// screen by writing to localStorage['native-cache:quota:<category>'].
const DEFAULT_QUOTA_BYTES: Record<Category, number> = {
  avatars: 10 * 1024 * 1024,        // 10 MB
  thumbs: 100 * 1024 * 1024,        // 100 MB
  media: 3 * 1024 * 1024 * 1024,    // 3 GB
  docs: 200 * 1024 * 1024,          // 200 MB
};

type Category = 'avatars' | 'thumbs' | 'media' | 'docs';

const CATEGORY_DIRS: Record<Category, string> = {
  avatars: 'telechat-media/avatars',
  thumbs: 'telechat-media/thumbs',
  media: 'telechat-media/media',
  docs: 'telechat-media/docs',
};

const ROOT_DIR = Directory.Cache;
const INDEX_KEY = 'native-cache:index:v1';

type IndexEntry = {
  url: string;
  category: Category;
  filename: string;        // sha1 of url
  size: number;
  mime: string;
  lastAccess: number;      // ms epoch
};

let memoryIndex: Map<string, IndexEntry> | null = null;
let indexLoaded = false;
let dirsEnsured = false;

export function isNativeAvailable(): boolean {
  // Capacitor.isNativePlatform() is the canonical detection; falls
  // back to false in any non-Capacitor context (browser, SSR, jsdom).
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function loadIndex(): Map<string, IndexEntry> {
  if (memoryIndex) return memoryIndex;
  memoryIndex = new Map();
  if (!indexLoaded) {
    try {
      const raw = localStorage.getItem(INDEX_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as IndexEntry[];
        for (const entry of arr) memoryIndex.set(entry.url, entry);
      }
    } catch {
      // Corrupted index — start fresh, don't bring down the cache.
    }
    indexLoaded = true;
  }
  return memoryIndex;
}

let saveScheduled = false;
function scheduleSave(): void {
  if (saveScheduled) return;
  saveScheduled = true;
  // Batch index writes on the next microtask so a flurry of puts
  // doesn't thrash localStorage.
  Promise.resolve().then(() => {
    saveScheduled = false;
    try {
      const idx = loadIndex();
      const arr = Array.from(idx.values());
      localStorage.setItem(INDEX_KEY, JSON.stringify(arr));
    } catch {
      // Quota exceeded on localStorage — extremely unlikely with our
      // tiny index, but fail-soft rather than crash.
    }
  });
}

async function sha1(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-1', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function ensureDirs(): Promise<void> {
  if (dirsEnsured) return;
  for (const path of Object.values(CATEGORY_DIRS)) {
    try {
      await Filesystem.mkdir({ path, directory: ROOT_DIR, recursive: true });
    } catch {
      // Already exists — Capacitor throws on this case, ignore.
    }
  }
  dirsEnsured = true;
}

function categoryFor(url: string): Category {
  // Cheap heuristic — avatar URLs all contain `/avatars/` in our
  // pipeline; LQIPs are inline data: URLs (skipped before reaching
  // here); thumbs have `?thumb=` or are linkPreview images;
  // documents are uploaded with the 📎 prefix and stored under the
  // generic uploads prefix but reachable here only via imageUrl on a
  // doc-prefixed message — handled by the docs caller. Anything else
  // is full media (photo or video poster).
  if (/\/avatars?\//i.test(url)) return 'avatars';
  if (/\?thumb=|\/thumbs?\//i.test(url)) return 'thumbs';
  return 'media';
}

function quotaFor(cat: Category): number {
  try {
    const v = localStorage.getItem(`native-cache:quota:${cat}`);
    if (v) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return n;
    }
  } catch {
    // ignore
  }
  return DEFAULT_QUOTA_BYTES[cat];
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => {
      const dataUrl = String(r.result);
      // strip "data:<mime>;base64," prefix
      const i = dataUrl.indexOf(',');
      resolve(i >= 0 ? dataUrl.slice(i + 1) : dataUrl);
    };
    r.readAsDataURL(blob);
  });
}

function base64ToBlob(b64: string, mime: string): Blob {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'application/octet-stream' });
}

/**
 * Try to read a previously cached blob for `url` from the native
 * filesystem. Returns null on miss, on web, or on any I/O error.
 * Bumps the LRU lastAccess timestamp on hit.
 */
export async function nativeCacheGet(url: string): Promise<Blob | null> {
  if (!isNativeAvailable()) return null;
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) return null;
  const idx = loadIndex();
  const entry = idx.get(url);
  if (!entry) return null;
  try {
    await ensureDirs();
    const path = `${CATEGORY_DIRS[entry.category]}/${entry.filename}`;
    const res = await Filesystem.readFile({ path, directory: ROOT_DIR });
    const data = typeof res.data === 'string' ? res.data : await blobToBase64(res.data as Blob);
    const blob = base64ToBlob(data, entry.mime);
    entry.lastAccess = Date.now();
    scheduleSave();
    return blob;
  } catch {
    // File missing on disk but still in index — clean up the orphan.
    idx.delete(url);
    scheduleSave();
    return null;
  }
}

/**
 * Persist a downloaded blob to the native filesystem so it survives
 * app restart and SW eviction. Triggers an opportunistic trim of the
 * affected category if the quota is exceeded.
 */
export async function nativeCachePut(
  url: string,
  blob: Blob,
  hint?: { category?: Category },
): Promise<void> {
  if (!isNativeAvailable()) return;
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) return;
  // Don't persist huge files. Capacitor Filesystem v8 takes binary
  // payloads as base64 strings, which inflates memory by ~33% during
  // the FileReader → write round-trip; a 50 MB blob therefore peaks
  // at ~67 MB of JS heap before flushing. Anything bigger is almost
  // certainly a long video the user only watched once — streaming
  // playback already worked, re-watching will re-fetch.
  if (blob.size > 50 * 1024 * 1024) return;
  const category = hint?.category ?? categoryFor(url);
  try {
    await ensureDirs();
    const filename = await sha1(url);
    const path = `${CATEGORY_DIRS[category]}/${filename}`;
    const data = await blobToBase64(blob);
    await Filesystem.writeFile({
      path,
      data,
      directory: ROOT_DIR,
      // Filesystem doesn't take Encoding for binary writes — omit so
      // the plugin treats `data` as raw base64 (its default for
      // binary payloads when Encoding is absent).
    });
    const idx = loadIndex();
    idx.set(url, {
      url,
      category,
      filename,
      size: blob.size,
      mime: blob.type || 'application/octet-stream',
      lastAccess: Date.now(),
    });
    scheduleSave();
    // Fire-and-forget trim if we're over quota.
    void trimCategory(category);
  } catch {
    // Disk full, permission denied, etc. — fail-soft, the in-memory
    // and SW caches still cover this session.
  }
}

// In-flight trim promises, keyed by category. prewarmMessageMedia
// can fire dozens of concurrent puts when a conversation opens; if
// each one spawned its own trim, multiple trims would race on the
// same memoryIndex/total computation and over-delete (or repeatedly
// try to delete the same already-gone files). Coalescing to one
// in-flight trim per category — and letting the last put trigger a
// fresh trim once the current one settles — is enough to converge
// to under-quota state without the herd.
const trimInFlight = new Map<Category, Promise<void>>();

async function trimCategory(category: Category): Promise<void> {
  const inflight = trimInFlight.get(category);
  if (inflight) return inflight;
  const p = doTrimCategory(category).finally(() => trimInFlight.delete(category));
  trimInFlight.set(category, p);
  return p;
}

async function doTrimCategory(category: Category): Promise<void> {
  const idx = loadIndex();
  const quota = quotaFor(category);
  let total = 0;
  const entries: IndexEntry[] = [];
  for (const e of idx.values()) {
    if (e.category === category) {
      total += e.size;
      entries.push(e);
    }
  }
  if (total <= quota) return;
  // Drop oldest first.
  entries.sort((a, b) => a.lastAccess - b.lastAccess);
  for (const e of entries) {
    if (total <= quota) break;
    // Re-check the index in case a concurrent reader bumped this
    // entry's lastAccess between sort time and now.
    if (!idx.has(e.url)) continue;
    try {
      await Filesystem.deleteFile({
        path: `${CATEGORY_DIRS[category]}/${e.filename}`,
        directory: ROOT_DIR,
      });
    } catch {
      // already gone
    }
    idx.delete(e.url);
    total -= e.size;
  }
  scheduleSave();
}

/**
 * Manual trim across all categories — useful from a future "clear
 * cache" settings action. Currently exported for completeness; the
 * per-put trim is enough for normal operation.
 */
export async function nativeCacheTrim(): Promise<void> {
  if (!isNativeAvailable()) return;
  for (const cat of Object.keys(CATEGORY_DIRS) as Category[]) {
    await trimCategory(cat);
  }
}

// Suppress unused-import warning when Encoding ends up unused in
// some bundler tree-shake passes — kept around for a future text
// payload variant.
void Encoding;
