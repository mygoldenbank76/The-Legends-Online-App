/**
 * In-memory media cache using object URLs.
 * Once a media file has been fetched once, subsequent renders are truly instant
 * (no network, no SW lookup, no re-decode) because the blob is kept alive in RAM.
 */

const MAX_ENTRIES = 300;

// src URL → blob objectURL
const cache = new Map<string, string>();

// URLs currently being fetched (prevent duplicate requests)
const pending = new Set<string>();

// Listeners notified when a src is cached (src → Set of callbacks)
const listeners = new Map<string, Set<(objectUrl: string) => void>>();

function notify(src: string, objectUrl: string) {
  listeners.get(src)?.forEach(fn => fn(objectUrl));
  listeners.delete(src);
}

function evictIfNeeded() {
  if (cache.size < MAX_ENTRIES) return;
  // FIFO: revoke and remove the oldest entries
  const toDelete = Math.ceil(MAX_ENTRIES * 0.2); // evict 20%
  let count = 0;
  for (const [key, val] of cache) {
    URL.revokeObjectURL(val);
    cache.delete(key);
    if (++count >= toDelete) break;
  }
}

/** Returns the cached objectURL if available, otherwise the original src */
export function getCachedSrc(src: string): string {
  return cache.get(src) ?? src;
}

/** Returns true if the src is already cached */
export function isCached(src: string): boolean {
  return cache.has(src);
}

/**
 * Preload a media URL into memory.
 * Safe to call multiple times — deduplicates in-flight requests.
 */
export function preloadMedia(src: string): void {
  if (!src || src.startsWith('blob:') || src.startsWith('data:')) return;
  if (cache.has(src) || pending.has(src)) return;

  pending.add(src);
  fetch(src)
    .then(r => {
      if (!r.ok) throw new Error('bad response');
      return r.blob();
    })
    .then(blob => {
      evictIfNeeded();
      const objectUrl = URL.createObjectURL(blob);
      cache.set(src, objectUrl);
      notify(src, objectUrl);
    })
    .catch(() => {
      // Fetch failed (CORS, network) — leave original src in use
      notify(src, src);
    })
    .finally(() => {
      pending.delete(src);
    });
}

/**
 * Register a Blob (or File) under a future server URL so the very next
 * render of `<CachedImg src={src}/>` paints from RAM with zero network
 * round-trip. Used by the upload pipeline: the moment a photo finishes
 * uploading we store its original File blob keyed by the freshly
 * returned server URL, so the swap from the optimistic upload bubble
 * to the real message is pixel-identical and gap-free.
 *
 * The cache mints its own object URL (independent of any blob URL the
 * caller may already hold), so callers remain free to revoke their own
 * URLs without breaking the cache entry.
 */
export function registerBlob(src: string, blob: Blob): void {
  if (!src || src.startsWith('blob:') || src.startsWith('data:')) return;
  if (cache.has(src)) return;
  evictIfNeeded();
  const objectUrl = URL.createObjectURL(blob);
  cache.set(src, objectUrl);
  notify(src, objectUrl);
}

/**
 * Subscribe to be notified when a src is cached.
 * Returns an unsubscribe function.
 */
export function onCached(src: string, cb: (objectUrl: string) => void): () => void {
  if (cache.has(src)) {
    cb(cache.get(src)!);
    return () => {};
  }
  if (!listeners.has(src)) listeners.set(src, new Set());
  listeners.get(src)!.add(cb);
  preloadMedia(src);
  return () => listeners.get(src)?.delete(cb);
}
