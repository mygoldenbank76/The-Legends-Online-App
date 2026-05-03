// ── Per-URL image aspect-ratio cache ──────────────────────────────────
//
// Mirror of the cache that lives inside `video-thumbnail.tsx` but for
// regular still images (photos, gifs, link-preview thumbnails). The
// chat-area renders received message images with an `aspectRatio` style
// computed from `msg.mediaWidth / msg.mediaHeight`. For LEGACY messages
// uploaded before the server started persisting intrinsic dimensions,
// those fields are null and the bubble falls back to `4 / 3`. When the
// real photo is portrait, the bubble then JUMPS taller the moment the
// <img> decodes — which is exactly the "ça bouge" the user reports
// when entering a conversation.
//
// This cache lets the chat-area
//   1) render the first paint with whatever ratio we already know
//      (from a prior visit, persisted in localStorage), and
//   2) probe + remember dimensions the first time we see an unknown
//      image so the SECOND open of the same conversation is jump-free.
//
// Same shape and persistence model as `video-thumbnail`'s cache so the
// behaviour is consistent across media types.

const aspectMem = new Map<string, number>();
const LS_PREFIX = 'tc:ira:';
// Hard cap on the in-memory map so a long-running session that scrolls
// through thousands of historical photos cannot grow the cache without
// bound. localStorage is itself bounded by the browser quota, but we
// also actively evict OUR oldest entries when we cross the cap so the
// localStorage view stays roughly in sync with what's hot in memory.
const MAX_ENTRIES = 1000;

/**
 * Reject URLs we never want to put inside a localStorage key:
 *   - data: / blob: URLs (the whole base64 / blob URL becomes the key,
 *     blowing past sensible key length and the 5 MB origin quota in a
 *     few entries).
 *   - empty / huge strings (defensive).
 * Server URLs and absolute https URLs are always cacheable.
 */
function isCacheableUrl(url: string): boolean {
  if (!url) return false;
  if (url.length > 1024) return false;
  if (url.startsWith('data:') || url.startsWith('blob:')) return false;
  return true;
}

export function getCachedImageAspect(url: string): number | null {
  if (!isCacheableUrl(url)) return null;
  const m = aspectMem.get(url);
  if (m && isFinite(m) && m > 0) return m;
  try {
    const s = localStorage.getItem(LS_PREFIX + url);
    if (s) {
      const n = parseFloat(s);
      if (isFinite(n) && n > 0) {
        aspectMem.set(url, n);
        return n;
      }
    }
  } catch { /* localStorage unavailable */ }
  return null;
}

export function setCachedImageAspect(url: string, ratio: number): void {
  if (!isCacheableUrl(url) || !isFinite(ratio) || ratio <= 0) return;
  // Simple FIFO eviction once we hit the cap — Map preserves insertion
  // order so the first key is by definition the oldest entry. Drop it
  // from both layers so the on-disk store doesn't grow forever either.
  if (aspectMem.size >= MAX_ENTRIES && !aspectMem.has(url)) {
    const oldest = aspectMem.keys().next().value;
    if (oldest) {
      aspectMem.delete(oldest);
      try { localStorage.removeItem(LS_PREFIX + oldest); } catch { /* ignore */ }
    }
  }
  aspectMem.set(url, ratio);
  try { localStorage.setItem(LS_PREFIX + url, String(ratio)); } catch { /* quota */ }
}

// In-flight probe registry so we never start two probes for the same
// URL simultaneously (e.g. when both the chat list and the open
// conversation render the same photo).
const inFlight = new Map<string, Promise<number | null>>();

/**
 * Resolve the natural aspect ratio of an image URL, populating the
 * cache for next time. Returns the cached value synchronously when
 * available; otherwise kicks off a probe and resolves when the image
 * has been decoded enough to expose its `naturalWidth`/`naturalHeight`.
 *
 * Errors (network failure, decode failure) resolve to `null` rather
 * than reject so the caller can use a sensible default.
 */
export function probeImageAspect(url: string): Promise<number | null> {
  if (!isCacheableUrl(url)) return Promise.resolve(null);
  const cached = getCachedImageAspect(url);
  if (cached !== null) return Promise.resolve(cached);
  const existing = inFlight.get(url);
  if (existing) return existing;
  const p = new Promise<number | null>((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      if (w > 0 && h > 0) {
        const r = w / h;
        setCachedImageAspect(url, r);
        resolve(r);
      } else {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  }).finally(() => { inFlight.delete(url); });
  inFlight.set(url, p);
  return p;
}
