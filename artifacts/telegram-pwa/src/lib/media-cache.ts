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
type MessageLikeForMedia = {
  imageUrl?: string | null;
  audioUrl?: string | null;
  mediaAlbum?: string[] | null;
  content?: string | null;
  replyTo?: { imageUrl?: string | null; content?: string | null } | null;
  linkPreview?: { image?: string | null } | null;
};

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
      for (const url of m.mediaAlbum) {
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
