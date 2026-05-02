/**
 * Media-dimension probe.
 *
 * Reads the first ~64 KB of an uploaded image from object storage, runs it
 * through the `image-size` parser (header-only, pure JS), and returns the
 * intrinsic { width, height }. Used in two places:
 *
 *   1) POST /api/messages — safety net. The client always forwards dims at
 *      send time, but if a bug or odd upload path drops them, we probe the
 *      bytes once and persist the result so every recipient still gets a
 *      bubble that paints at the correct shape on the very first frame.
 *
 *   2) Startup backfill — every legacy single-image message that landed
 *      before the dimension columns shipped is missing dims, which is
 *      exactly what makes the chat "shift" when the user enters a
 *      conversation: bubbles paint at a 4:3 fallback then snap to the
 *      true ratio when the image decodes. One pass over those rows is
 *      enough to make every future open buttery-smooth.
 *
 * Videos are intentionally NOT handled here. `image-size` only knows
 * still-image containers, and decoding a video header server-side would
 * require ffprobe (heavy native dep). The client already caches the
 * captured first-frame aspect ratio in localStorage on first view, so
 * legacy videos heal themselves after a single playback.
 *
 * Reads are bounded by `PROBE_BYTE_LIMIT` so a 50 MB photo never streams
 * 50 MB just to read 24 bytes of EXIF/PNG/JPEG header.
 */

import { imageSize } from "image-size";
import { objectStorageClient } from "./objectStorage";
import { logger } from "./logger";

const BUCKET_ID = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
const UPLOAD_PREFIX = "telechat-uploads";
// 64 KB is plenty for every common still-image format (JPEG SOF markers
// fall well under 32 KB even with embedded thumbnails; PNG IHDR is in the
// first 24 bytes; WebP VP8 chunk is in the first ~30 bytes).
const PROBE_BYTE_LIMIT = 64 * 1024;
// Image extensions the probe knows how to parse. Keep in sync with
// `image-size`'s supported formats — anything outside this list is
// short-circuited so we don't waste a GCS read.
const PROBE_EXT = /\.(jpe?g|png|webp|gif|bmp|tiff?|avif|heic|heif)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|avi|mkv|m4v)$/i;

export type Dims = { width: number; height: number };

/**
 * Returns true when the URL points at a single still image we can probe.
 * Excludes videos (handled client-side) and audio/document uploads.
 */
export function isProbableImage(url: string | null | undefined): boolean {
  if (!url) return false;
  if (VIDEO_EXT.test(url)) return false;
  return PROBE_EXT.test(url);
}

/**
 * Extract the GCS object id from one of our internal upload URLs.
 * Returns null for anything else (external URLs, GIF passthrough, etc.).
 */
function extractObjectId(url: string): string | null {
  const m = url.match(/\/api\/uploads\/gcs\/([^/?#]+)/);
  return m ? (m[1] ?? null) : null;
}

/**
 * Sanity-check a parsed { width, height } pair before letting it touch the
 * database. Mirrors the validation already in POST /api/messages so the
 * backfill can never write a value the create endpoint would reject.
 */
function isSaneDim(n: unknown): n is number {
  return (
    typeof n === "number" &&
    Number.isSafeInteger(n) &&
    n > 0 &&
    n <= 100_000
  );
}

/**
 * Probe the intrinsic dimensions of an uploaded image URL.
 *
 * Returns null when:
 *  - the URL doesn't point at a probable image,
 *  - the URL doesn't reference our GCS bucket,
 *  - the bucket isn't configured in this environment,
 *  - the file doesn't exist or the read fails,
 *  - the parser can't make sense of the first 64 KB.
 *
 * Never throws — callers can `await probeImageDimensions(url)` directly.
 */
export async function probeImageDimensions(
  url: string,
): Promise<Dims | null> {
  if (!isProbableImage(url)) return null;
  if (!BUCKET_ID) return null;
  const objectId = extractObjectId(url);
  if (!objectId) return null;

  try {
    const bucket = objectStorageClient.bucket(BUCKET_ID);
    const file = bucket.file(`${UPLOAD_PREFIX}/${objectId}`);
    const [exists] = await file.exists();
    if (!exists) return null;

    // Range read: ask GCS for byte 0..PROBE_BYTE_LIMIT-1 so we don't
    // download the whole file just to read a 24-byte header.
    const stream = file.createReadStream({ start: 0, end: PROBE_BYTE_LIMIT - 1 });
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    const head = Buffer.concat(chunks);
    if (head.length === 0) return null;

    const out = imageSize(head);
    if (!out) return null;
    if (!isSaneDim(out.width) || !isSaneDim(out.height)) return null;
    return { width: out.width, height: out.height };
  } catch (err) {
    logger.debug({ err, url }, "probeImageDimensions failed");
    return null;
  }
}
