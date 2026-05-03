/**
 * Client-side decoder for the Telegram-style "stripped thumbnail" payload
 * shipped in `Message.mediaStrippedThumb` (and reply previews).
 *
 * Wire format (matches `api-server/src/lib/strippedThumb.ts`):
 *
 *   base64( [0x01, width_byte, height_byte, ...entropy data from SOS through EOI] )
 *
 * To rebuild a viewable JPEG we prepend a CANONICAL 591-byte JPEG header
 * (quantization + Huffman + SOF0 tables) with the dimension bytes patched
 * in, then concatenate the stored entropy data.
 *
 * The canonical prefix below was extracted from a sharp encode using the
 * EXACT options the server pins (see `strippedThumb.ts` "Determinism
 * contract" block). If those options ever change, regenerate the prefix
 * via `tmp/extract-prefix.mjs` or the encode/decode pair will silently
 * produce garbage.
 *
 * Decoded blob URLs are cached in a Map keyed by the raw base64 string
 * so re-renders of the same message don't redecode + re-allocate. The
 * cache is module-scoped — its lifetime is the page — so an LRU eviction
 * isn't strictly needed; we cap it at 200 entries as a defence against
 * unbounded chats with thousands of media bubbles.
 */

const CANONICAL_PREFIX_B64 =
  "/9j/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAAAAADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6";

// Decode the prefix once at module load. `atob` is universally available
// in browser + Capacitor WebView; no buffer/Node dep needed.
const CANONICAL_PREFIX = (() => {
  const bin = atob(CANONICAL_PREFIX_B64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
})();

// Offsets within the prefix where the SOF0 marker writes the dimensions.
// Big-endian uint16; for our ≤ 255 thumbnails the high byte is always 0.
const HEIGHT_HI_OFF = 145;
const HEIGHT_LO_OFF = 146;
const WIDTH_HI_OFF = 147;
const WIDTH_LO_OFF = 148;

// Module-scoped decode cache. Key = raw base64 wire payload, value =
// blob URL ready to drop into an <img src=…>. Capped to bound memory
// in chats with thousands of media bubbles.
const CACHE_MAX = 200;
const cache = new Map<string, string>();

function rememberBlob(key: string, url: string): string {
  if (cache.size >= CACHE_MAX) {
    // Drop the oldest entry (Map preserves insertion order). Revoke its
    // URL so the underlying Blob can be GC'd.
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      const oldUrl = cache.get(oldestKey);
      if (oldUrl) {
        try { URL.revokeObjectURL(oldUrl); } catch { /* ignore */ }
      }
      cache.delete(oldestKey);
    }
  }
  cache.set(key, url);
  return url;
}

/**
 * Turn a stripped-thumb base64 payload into a blob URL ready for
 * <img src=…>. Returns null when the payload is missing, malformed, or
 * shorter than the 3-byte header.
 *
 * Cheap to call from render: subsequent calls with the same `wire`
 * string return the cached URL without rebuilding the JPEG.
 */
export function decodeStrippedThumb(wire: string | null | undefined): string | null {
  if (!wire || typeof wire !== "string" || wire.length < 4) return null;
  const cached = cache.get(wire);
  if (cached) return cached;

  let raw: Uint8Array;
  try {
    const bin = atob(wire);
    raw = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
  } catch {
    return null;
  }

  if (raw.length < 4 || raw[0] !== 0x01) return null;
  const w = raw[1];
  const h = raw[2];
  if (!w || !h) return null;

  // Build full JPEG = patched prefix + entropy data. We slice() the
  // prefix so we don't mutate the shared canonical buffer.
  const prefix = CANONICAL_PREFIX.slice();
  prefix[HEIGHT_HI_OFF] = 0;
  prefix[HEIGHT_LO_OFF] = h;
  prefix[WIDTH_HI_OFF] = 0;
  prefix[WIDTH_LO_OFF] = w;

  const jpeg = new Uint8Array(prefix.length + (raw.length - 3));
  jpeg.set(prefix, 0);
  jpeg.set(raw.subarray(3), prefix.length);

  let url: string;
  try {
    const blob = new Blob([jpeg], { type: "image/jpeg" });
    url = URL.createObjectURL(blob);
  } catch {
    return null;
  }
  return rememberBlob(wire, url);
}

/**
 * Convenience helper for components that expect a `string | undefined`
 * placeholder (e.g. <InstantImg placeholder=…>). Returns the existing
 * `mediaPreview` data URL when no stripped thumb is available so callers
 * get the best-quality placeholder they can without per-call branching.
 */
export function preferStrippedThumb(
  stripped: string | null | undefined,
  legacyDataUrl: string | null | undefined,
): string | undefined {
  const decoded = decodeStrippedThumb(stripped);
  if (decoded) return decoded;
  if (legacyDataUrl) return legacyDataUrl;
  return undefined;
}
