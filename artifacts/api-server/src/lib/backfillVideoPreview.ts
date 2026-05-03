/**
 * One-shot backfill for legacy video LQIPs and dimensions.
 *
 * Mirror of `backfillMediaPreview` but for video messages. Walks the
 * messages table from newest to oldest, finds rows whose `imageUrl`
 * is a video file (mp4/webm/mov/…) and either has no `mediaPreview`
 * or no `mediaWidth`/`mediaHeight`, runs them through ffprobe +
 * ffmpeg, and persists the result.
 *
 * After one pass every legacy video bubble paints a recognisable
 * blurred frame on the very first frame and is sized at the correct
 * aspect ratio — no black box, no reflow when the video metadata
 * loads, no per-recipient on-the-fly capture.
 *
 * Pacing mirrors the image LQIP backfill so the two never compete:
 * small batches with a delay, single-row at a time inside each batch
 * (ffmpeg is more CPU-intensive than sharp so we're conservative).
 */

import { and, eq, isNull, isNotNull, lt, desc, or } from "drizzle-orm";
import { db, messagesTable } from "@workspace/db";
import { logger } from "./logger";
import { isProbableVideo, probeVideo } from "./videoProbe";

const BATCH_SIZE = 4;
const INTER_BATCH_DELAY_MS = 800;

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
      mediaPreview: messagesTable.mediaPreview,
      mediaWidth: messagesTable.mediaWidth,
      mediaHeight: messagesTable.mediaHeight,
    })
    .from(messagesTable)
    .where(
      and(
        isNotNull(messagesTable.imageUrl),
        // Either preview OR dims missing — either gap is a visible
        // hit at conversation-open time so we patch both in one pass.
        or(
          isNull(messagesTable.mediaPreview),
          isNull(messagesTable.mediaWidth),
          isNull(messagesTable.mediaHeight),
        ),
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
    // Skip non-video URLs immediately — image LQIP backfill handles them.
    if (!isProbableVideo(row.imageUrl)) continue;

    const probed = await probeVideo(row.imageUrl);
    if (!probed) continue;

    const update: Partial<{
      mediaPreview: string;
      mediaWidth: number;
      mediaHeight: number;
    }> = {};
    if (!row.mediaPreview && probed.lqip) update.mediaPreview = probed.lqip;
    if (!row.mediaWidth && probed.width > 0) update.mediaWidth = probed.width;
    if (!row.mediaHeight && probed.height > 0) update.mediaHeight = probed.height;
    if (Object.keys(update).length === 0) continue;

    try {
      await db
        .update(messagesTable)
        .set(update)
        .where(eq(messagesTable.id, row.id));
      updated += 1;
    } catch (err) {
      logger.debug({ err, id: row.id }, "video preview backfill row update failed");
    }
  }

  return { examined: rows.length, nextCursor, updated };
}

const INT4_MAX = 2_147_483_647;

export async function runVideoPreviewBackfill(): Promise<void> {
  let cursor = INT4_MAX;
  let totalExamined = 0;
  let totalUpdated = 0;
  const startedAt = Date.now();

  for (;;) {
    let batch;
    try {
      batch = await processBatch(cursor);
    } catch (err) {
      logger.warn({ err }, "video preview backfill batch failed; aborting");
      return;
    }
    if (batch.examined === 0) break;
    if (batch.nextCursor >= cursor) {
      logger.warn({ cursor }, "video preview backfill cursor stalled; aborting");
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
      "video preview backfill done",
    );
  }
}
