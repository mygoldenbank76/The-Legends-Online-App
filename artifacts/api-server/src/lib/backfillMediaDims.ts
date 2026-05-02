/**
 * One-shot backfill for legacy media-dimension columns.
 *
 * Every single-image message that landed BEFORE the
 * `messages.media_width` / `media_height` columns shipped is now sitting
 * in the database with a non-null `image_url` and a null dimension pair.
 * On the client that translates to a fallback aspect ratio (4:3 for
 * photos, 9:16 for videos) which then snaps to the real ratio the moment
 * the image decodes — the visible "tout bouge quand j'ouvre la
 * conversation" the user reported.
 *
 * This module finds those rows in the background, probes each image's
 * intrinsic dimensions via `image-size` (header-only, ~64 KB read), and
 * writes the result back. After one pass every recipient's bubbles paint
 * at the correct shape on the very first frame.
 *
 * Design choices:
 *   • Async / non-blocking — kicked off after the HTTP listen() callback
 *     so the server never delays accepting traffic.
 *   • Batched & paced — small batches with a small delay between them so
 *     a chat history with thousands of legacy photos doesn't saturate
 *     GCS or DB connection pools.
 *   • Cursor-based & idempotent — we walk by descending id with a
 *     `WHERE id < cursor` cursor so the loop always makes forward
 *     progress even when probes fail (failed rows still match the
 *     `IS NULL` filter, so a non-cursored loop would re-read them
 *     forever).
 *   • Best-effort — any individual probe failure (404, parse error,
 *     unsupported format) is logged at debug level and the row is
 *     silently left as-is so a corrupt upload can never crash the
 *     backfill loop.
 */

import { and, eq, isNull, isNotNull, lt, desc } from "drizzle-orm";
import { db, messagesTable } from "@workspace/db";
import { logger } from "./logger";
import { isProbableImage, probeImageDimensions } from "./mediaProbe";

const BATCH_SIZE = 25;
const INTER_BATCH_DELAY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
        isNull(messagesTable.mediaWidth),
        // Cursor anchor — guarantees forward progress even when probes
        // fail and the row remains matching the IS NULL filter.
        lt(messagesTable.id, cursor),
      ),
    )
    .orderBy(desc(messagesTable.id))
    .limit(BATCH_SIZE);

  if (rows.length === 0) {
    return { examined: 0, nextCursor: cursor, updated: 0 };
  }

  let updated = 0;
  // Newest-first scan: the smallest id in this batch becomes the cursor
  // for the next batch, so we keep walking backwards through history.
  let nextCursor = cursor;
  for (const row of rows) {
    if (typeof row.id === "number" && row.id < nextCursor) {
      nextCursor = row.id;
    }
    if (!row.imageUrl || !isProbableImage(row.imageUrl)) continue;
    const dims = await probeImageDimensions(row.imageUrl);
    if (!dims) continue;
    try {
      await db
        .update(messagesTable)
        .set({ mediaWidth: dims.width, mediaHeight: dims.height })
        .where(eq(messagesTable.id, row.id));
      updated += 1;
    } catch (err) {
      logger.debug({ err, id: row.id }, "backfill row update failed");
    }
  }

  return { examined: rows.length, nextCursor, updated };
}

/**
 * Public entry point. Fire-and-forget from index.ts.
 */
// PostgreSQL `serial` is int4-backed, so the cursor parameter has to fit
// in a 32-bit signed integer. `Number.MAX_SAFE_INTEGER` blew up the
// driver with "value out of range for type integer" on the very first
// batch — use the int4 ceiling instead.
const INT4_MAX = 2_147_483_647;

export async function runMediaDimsBackfill(): Promise<void> {
  let cursor = INT4_MAX;
  let totalExamined = 0;
  let totalUpdated = 0;
  const startedAt = Date.now();

  for (;;) {
    let batch;
    try {
      batch = await processBatch(cursor);
    } catch (err) {
      logger.warn({ err }, "media dims backfill batch failed; aborting");
      return;
    }
    if (batch.examined === 0) break;
    if (batch.nextCursor >= cursor) {
      // Defensive: cursor didn't advance. Should never happen with `lt`,
      // but guard against an infinite loop just in case.
      logger.warn({ cursor }, "media dims backfill cursor stalled; aborting");
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
      "media dims backfill done",
    );
  }
}
