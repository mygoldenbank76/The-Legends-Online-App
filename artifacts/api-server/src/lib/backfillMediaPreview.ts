/**
 * One-shot backfill for legacy media-preview (LQIP) values.
 *
 * Every single-image message that landed BEFORE the
 * `messages.media_preview` column shipped is sitting in the database
 * with a non-null `image_url` and a null preview. On the client that
 * means there's nothing to paint behind the bubble while the
 * multi-megabyte original streams from object storage — the user sees
 * an empty (purple-tinted) placeholder for the entire download, which
 * is exactly the "le chargement quand on arrive dans une conversation
 * c'est toujours pas bon" complaint.
 *
 * This module finds those rows in the background, downloads each
 * image once, generates a tiny (~32 px max edge) blurred JPEG via
 * sharp, base64-encodes it as a data URL, and writes the result back.
 * After one pass every legacy photo bubble paints a recognisable
 * blurred preview on the very first frame and crossfades to the
 * sharp version once it loads.
 *
 * Design choices (mirror backfillMediaDims for consistency):
 *   • Async / non-blocking — kicked off after the HTTP listen()
 *     callback so the server never delays accepting traffic.
 *   • Small batches with a delay — sharp is CPU-intensive; we keep
 *     concurrency to a minimum so the backfill never starves request
 *     handling on a busy day.
 *   • Cursor-based & idempotent — we walk by descending id with a
 *     `WHERE id < cursor` cursor so failed rows can't trap the loop.
 *   • Best-effort — any individual probe/decode/resize failure is
 *     logged at debug level and the row is silently left as-is so a
 *     corrupt or oversized upload can never crash the backfill.
 *   • Hard size cap — files larger than 12 MB are skipped (memory
 *     safety; LQIP gen for a 30 MB raw photo isn't worth blowing the
 *     server's heap over).
 */

import { and, eq, isNull, isNotNull, lt, desc } from "drizzle-orm";
import { db, messagesTable } from "@workspace/db";
import sharp from "sharp";
import { logger } from "./logger";
import { isProbableImage } from "./mediaProbe";
import { objectStorageClient } from "./objectStorage";

const BUCKET_ID = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
const UPLOAD_PREFIX = "telechat-uploads";

const BATCH_SIZE = 10;
const INTER_BATCH_DELAY_MS = 400;
// Skip images bigger than this — generating a LQIP for a 30 MB raw
// photo would mean reading the whole thing into memory just to emit
// 1 KB. Not worth the heap pressure on a small server.
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
// Same constants as the client-side helper / server-side validator —
// keep all three in lockstep so a backfilled value passes the same
// shape check a fresh upload would.
const LQIP_MAX_DIM = 32;
const LQIP_QUALITY = 40;
const LQIP_MAX_BYTES = 4096;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function extractObjectId(url: string): string | null {
  const m = url.match(/\/api\/uploads\/gcs\/([^/?#]+)/);
  return m ? (m[1] ?? null) : null;
}

/**
 * Download (most of) an image from object storage and run it through
 * sharp to produce a tiny base64 LQIP. Returns null on any failure or
 * when the source image is suspiciously oversized.
 */
async function generateLqipForUrl(url: string): Promise<string | null> {
  if (!isProbableImage(url)) return null;
  if (!BUCKET_ID) return null;
  const objectId = extractObjectId(url);
  if (!objectId) return null;

  try {
    const bucket = objectStorageClient.bucket(BUCKET_ID);
    const file = bucket.file(`${UPLOAD_PREFIX}/${objectId}`);

    // Cheap existence + size check first so we can bail before
    // streaming a huge object. `getMetadata` is a single HEAD-style
    // call.
    const [meta] = await file.getMetadata();
    const size = typeof meta.size === "string" ? Number(meta.size) : meta.size;
    if (typeof size === "number" && size > MAX_SOURCE_BYTES) return null;

    const [buf] = await file.download();
    if (!buf || buf.length === 0) return null;
    if (buf.length > MAX_SOURCE_BYTES) return null;

    const out = await sharp(buf, {
      failOn: "none",
      // Defence against pixel-bomb inputs (a small file that decodes
      // to gigapixels). 100 MP is well above any phone camera output
      // and well below what a malicious crafted image could trigger.
      limitInputPixels: 100_000_000,
    })
      // Apply EXIF rotation BEFORE resize so the preview matches what
      // the browser actually paints for the original image. The
      // toBuffer() call below also strips remaining EXIF / ICC.
      .rotate()
      .resize({ width: LQIP_MAX_DIM, height: LQIP_MAX_DIM, fit: "inside" })
      .jpeg({ quality: LQIP_QUALITY, mozjpeg: true })
      .toBuffer();

    const dataUrl = `data:image/jpeg;base64,${out.toString("base64")}`;
    if (dataUrl.length > LQIP_MAX_BYTES) return null;
    return dataUrl;
  } catch (err) {
    logger.debug({ err, url }, "generateLqipForUrl failed");
    return null;
  }
}

async function processBatch(
  cursor: number,
): Promise<{ examined: number; nextCursor: number; updated: number }> {
  const rows = await db
    .select({
      id: messagesTable.id,
      imageUrl: messagesTable.imageUrl,
    })
    .from(messagesTable)
    .where(
      and(
        isNotNull(messagesTable.imageUrl),
        isNull(messagesTable.mediaPreview),
        lt(messagesTable.id, cursor),
      ),
    )
    .orderBy(desc(messagesTable.id))
    .limit(BATCH_SIZE);

  if (rows.length === 0) {
    return { examined: 0, nextCursor: cursor, updated: 0 };
  }

  let updated = 0;
  let nextCursor = cursor;
  for (const row of rows) {
    if (typeof row.id === "number" && row.id < nextCursor) {
      nextCursor = row.id;
    }
    if (!row.imageUrl) continue;
    const lqip = await generateLqipForUrl(row.imageUrl);
    if (!lqip) continue;
    try {
      await db
        .update(messagesTable)
        .set({ mediaPreview: lqip })
        .where(eq(messagesTable.id, row.id));
      updated += 1;
    } catch (err) {
      logger.debug({ err, id: row.id }, "media preview backfill row update failed");
    }
  }

  return { examined: rows.length, nextCursor, updated };
}

// PostgreSQL `serial` is int4-backed — same int4 ceiling as the dims
// backfill (Number.MAX_SAFE_INTEGER blows up the driver).
const INT4_MAX = 2_147_483_647;

export async function runMediaPreviewBackfill(): Promise<void> {
  if (!BUCKET_ID) {
    logger.debug("media preview backfill skipped — no bucket configured");
    return;
  }

  let cursor = INT4_MAX;
  let totalExamined = 0;
  let totalUpdated = 0;
  const startedAt = Date.now();

  for (;;) {
    let batch;
    try {
      batch = await processBatch(cursor);
    } catch (err) {
      logger.warn({ err }, "media preview backfill batch failed; aborting");
      return;
    }
    if (batch.examined === 0) break;
    if (batch.nextCursor >= cursor) {
      logger.warn({ cursor }, "media preview backfill cursor stalled; aborting");
      break;
    }
    cursor = batch.nextCursor;
    totalExamined += batch.examined;
    totalUpdated += batch.updated;
    await sleep(INTER_BATCH_DELAY_MS);
  }

  if (totalExamined > 0) {
    logger.info(
      { examined: totalExamined, updated: totalUpdated, ms: Date.now() - startedAt },
      "media preview backfill done",
    );
  }
}
