/**
 * In-memory media cache using object URLs.
 * Once a media file has been fetched once, subsequent renders are truly instant
 * (no network, no SW lookup, no re-decode) because the blob is kept alive in RAM.
 *
 * Eviction is true LRU (move-to-front on every read). The previous FIFO
 * scheme dropped frequently-revisited photos (the user's own avatar,
 * the 3 most-recent images they keep scrolling back to) the moment
 * they fell off the front of insertion order, even though they were
 * still being touched on every conversation open.
 *
 * Capacity bumped from 300 → 1500: covers ~4–5 conversations of
 * heavy chat history without eviction churn (a typical messenger
 * user opens the same handful of conversations dozens of times per
 * day), at a memory cost of a few MB of object-URL bookkeeping
 * (the actual blob bytes live in the browser's blob store, not the
 * JS heap).
 */

import { isNativeAvailable, nativeCacheGet, nativeCachePut } from './native-cache';

const MAX_ENTRIES = 1500;

/**
 * Strip signed-URL query params (`?e=…&s=…`) from
 * `/api/uploads/gcs/…` URLs so the cache key is stable across token
 * rotations. Without this, every API response mints a fresh signature
 * → different full URL → cache miss → re-download → visible flash.
 *
 * Non-GCS URLs and blob:/data: URLs pass through unchanged.
 */
const GCS_PREFIX = '/api/uploads/gcs/';
function cacheKey(src: string): string {
  if (!src.startsWith(GCS_PREFIX)) return src;
  const qIdx = src.indexOf('?');
  return qIdx >= 0 ? src.slice(0, qIdx) : src;
}

// src URL → blob objectURL. Map insertion order doubles as our LRU
// recency order: every access moves the entry to the back via a
// delete+set pair, so the FRONT of the iterator is the LRU end.
const cache = new Map<string, string>();

// URLs currently being fetched (prevent duplicate requests)
const pending = new Set<string>();

// Listeners notified when a src is cached (src → Set of callbacks)
const listeners = new Map<string, Set<(objectUrl: string) => void>>();

// GIF URLs are deliberately NOT pulled into the in-memory blob cache.
// Animated GIFs served via blob: URLs can lose their animation on
// certain Android WebView builds (Capacitor APK), and the SW already
// gives us cache-first persistence for them, so the second-paint cost
// is identical to a RAM hit. Bypassing the blob layer guarantees
// native browser rendering with full animation on every platform.
const GIF_RE = /\.gif(\?|$)|tenor\.com|giphy\.com/i;

function notify(src: string, objectUrl: string) {
  const key = cacheKey(src);
  listeners.get(key)?.forEach(fn => fn(objectUrl));
  listeners.delete(key);
}

function evictIfNeeded() {
  if (cache.size < MAX_ENTRIES) return;
  // True LRU: drop oldest 20% from the front of the Map (least
  // recently moved-to-back via touch()).
  const toDelete = Math.ceil(MAX_ENTRIES * 0.2);
  let count = 0;
  for (const [key, val] of cache) {
    URL.revokeObjectURL(val);
    cache.delete(key);
    if (++count >= toDelete) break;
  }
}

/**
 * Move an entry to the back of the Map (most-recently-used position).
 * No-op if the key is not in the cache. Cheap: one delete + one set.
 */
function touch(src: string): void {
  const key = cacheKey(src);
  const v = cache.get(key);
  if (v === undefined) return;
  cache.delete(key);
  cache.set(key, v);
}

/** Returns the cached objectURL if available, otherwise the original src */
export function getCachedSrc(src: string): string {
  const key = cacheKey(src);
  const v = cache.get(key);
  if (v !== undefined) {
    touch(src);
    return v;
  }
  return src;
}

/** Returns true if the src is already cached */
export function isCached(src: string): boolean {
  return cache.has(cacheKey(src));
}

/**
 * Preload a media URL into memory.
 * Safe to call multiple times — deduplicates in-flight requests.
 */
export function preloadMedia(src: string): void {
  if (!src || src.startsWith('blob:') || src.startsWith('data:')) return;
  // GIFs bypass the in-memory blob layer — see GIF_RE comment above.
  // The SW still serves them cache-first, so the network cost is the
  // same on second view; the only thing skipped is the blob wrapping
  // that can break animation in some Android WebView builds.
  if (GIF_RE.test(src)) return;
  const key = cacheKey(src);
  if (cache.has(key) || pending.has(key)) return;

  pending.add(key);

  // On the APK, consult the native filesystem cache FIRST. This
  // bypasses both the WebView quota AND any SW eviction that may have
  // happened between sessions, giving Telegram-grade "everything is
  // already there" persistence. On web/PWA isNativeAvailable() is
  // false and this resolves to null instantly — the fetch below runs
  // unchanged and the SW handles disk caching as before.
  const tryNative = isNativeAvailable() ? nativeCacheGet(key) : Promise.resolve(null);

  tryNative
    .then(nativeBlob => {
      if (nativeBlob) return nativeBlob;
      // Fetch with the FULL signed URL (including ?e=&s=) — the
      // server requires it. Cache under the bare key so future
      // requests with a rotated signature still hit RAM.
      return fetch(src).then(r => {
        if (!r.ok) throw new Error('bad response');
        return r.blob().then(blob => {
          if (isNativeAvailable()) void nativeCachePut(key, blob);
          return blob;
        });
      });
    })
    .then(blob => {
      evictIfNeeded();
      const objectUrl = URL.createObjectURL(blob);
      cache.set(key, objectUrl);
      notify(src, objectUrl);
    })
    .catch(() => {
      // Fetch failed (CORS, network) — leave original src in use
      notify(src, src);
    })
    .finally(() => {
      pending.delete(key);
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
  const key = cacheKey(src);
  if (cache.has(key)) return;
  evictIfNeeded();
  const objectUrl = URL.createObjectURL(blob);
  cache.set(key, objectUrl);
  notify(src, objectUrl);
}

/**
 * Subscribe to be notified when a src is cached.
 * Returns an unsubscribe function.
 */
export function onCached(src: string, cb: (objectUrl: string) => void): () => void {
  const key = cacheKey(src);
  if (cache.has(key)) {
    cb(cache.get(key)!);
    return () => {};
  }
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)!.add(cb);
  preloadMedia(src);
  return () => listeners.get(key)?.delete(cb);
}

// Video extensions: skipped because <video> streams progressively and
// caching the full file in RAM would explode memory budget.
const VIDEO_EXT_RE = /\.(mp4|webm|mov|avi|mkv|m4v)(\?|$)/i;

/**
 * Loose shape of a chat message — only fields we read for media URLs.
 * Permissive on purpose so this helper works against the Msg type from
 * chat-area.tsx, the API client's generated Message type, and the
 * lastMessage summary on the conversation list, without an exhaustive
 * type union.
 */
type AlbumItemLoose =
  | string
  | { url?: string | null; lqip?: string | null; thumbnailUrl?: string | null };

type MessageLikeForMedia = {
  imageUrl?: string | null;
  audioUrl?: string | null;
  mediaAlbum?: AlbumItemLoose[] | null;
  content?: string | null;
  replyTo?: { imageUrl?: string | null; content?: string | null } | null;
  linkPreview?: { image?: string | null } | null;
};

function albumItemUrl(item: AlbumItemLoose): string {
  return typeof item === 'string' ? item : (item?.url ?? '');
}

// Documents (PDFs, .docx…) sent through the file picker land in
// `imageUrl` but render as a tap-to-download card, not as an image.
// Their content is prefixed with "📎 " by the upload pipeline. We
// detect it without importing from chat/file-card to keep this helper
// dependency-free and reusable from any module.
function looksLikeDocumentMessage(m: MessageLikeForMedia): boolean {
  return typeof m.content === 'string' && m.content.startsWith('📎 ');
}

/**
 * Pre-warm the in-memory blob cache for every photo, voice note, album
 * tile, reply preview and link-preview thumbnail in a list of messages.
 *
 * Called from the conversation-list code paths that already prefetch
 * the messages JSON (top-5 background prefetch + pointerDown predictive
 * prefetch). The result is that by the time the user actually enters
 * the conversation, every <CachedImg> finds its blob already in RAM
 * and paints with `opacity: 1` on the very first frame — no empty
 * coloured rectangles, no fade-in flash.
 *
 * Videos are deliberately skipped (handled lazily by the player) and
 * document attachments are skipped (rendered as cards, not images).
 */
export function prewarmMessageMedia(messages: readonly MessageLikeForMedia[]): void {
  for (const m of messages) {
    if (m.imageUrl && !VIDEO_EXT_RE.test(m.imageUrl) && !looksLikeDocumentMessage(m)) {
      preloadMedia(m.imageUrl);
    }
    if (m.audioUrl) {
      preloadMedia(m.audioUrl);
    }
    if (Array.isArray(m.mediaAlbum)) {
      for (const item of m.mediaAlbum) {
        const url = albumItemUrl(item);
        if (url && !VIDEO_EXT_RE.test(url)) preloadMedia(url);
      }
    }
    if (m.replyTo?.imageUrl
        && !VIDEO_EXT_RE.test(m.replyTo.imageUrl)
        && !looksLikeDocumentMessage(m.replyTo)) {
      preloadMedia(m.replyTo.imageUrl);
    }
    if (m.linkPreview?.image) {
      preloadMedia(m.linkPreview.image);
    }
  }
}
