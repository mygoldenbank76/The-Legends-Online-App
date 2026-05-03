/**
 * One-shot backfill for the new `messages.media_stripped_thumb` column.
 *
 * Mirrors `backfillMediaPreview.ts` line-for-line in shape — same batch
 * size, same delay, same cursor walk, same heap-safety caps. The only
 * differences are the column we write and the encoder we call.
 *
 * Why a separate backfill instead of folding into the LQIP one: stripped
 * thumbs can land for messages that ALREADY have a mediaPreview — the
 * two columns coexist (client prefers stripped, falls back to LQIP), so
 * we can't gate on `mediaPreview IS NULL`. We gate on `mediaStrippedThumb
 * IS NULL AND imageUrl IS NOT NULL` instead.
 *
 * Like the other backfills this is fire-and-forget at the listen()
 * boundary, idempotent, cursor-paced, and silently skips any row that
 * fails (oversized, missing object, non-image, etc.).
 */

import { and, eq, isNull, isNotNull, lt, desc } from "drizzle-orm";
import { db, messagesTable } from "@workspace/db";
import { logger } from "./logger";
import { isProbableImage } from "./mediaProbe";
import { objectStorageClient } from "./objectStorage";
import { generateStrippedThumb } from "./strippedThumb";

const BUCKET_ID = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
const UPLOAD_PREFIX = "telechat-uploads";

const BATCH_SIZE = 10;
const INTER_BATCH_DELAY_MS = 400;
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function extractObjectId(url: string): string | null {
  const m = url.match(/\/api\/uploads\/gcs\/([^/?#]+)/);
  return m ? (m[1] ?? null) : null;
}

async function generateForUrl(url: string): Promise<string | null> {
  if (!isProbableImage(url)) return null;
  if (!BUCKET_ID) return null;
  const objectId = extractObjectId(url);
  if (!objectId) return null;

  try {
    const bucket = objectStorageClient.bucket(BUCKET_ID);
    const file = bucket.file(`${UPLOAD_PREFIX}/${objectId}`);

    const [meta] = await file.getMetadata();
    const size = typeof meta.size === "string" ? Number(meta.size) : meta.size;
    if (typeof size === "number" && size > MAX_SOURCE_BYTES) return null;

    const [buf] = await file.download();
    if (!buf || buf.length === 0) return null;
    if (buf.length > MAX_SOURCE_BYTES) return null;

    return await generateStrippedThumb(buf);
  } catch (err) {
    logger.debug({ err, url }, "stripped thumb backfill row failed");
    return null;
  }
}

async function processBatch(
  cursor: number,
): Promise<{ examined: number; nextCursor: number; updated: number }> {
  const rows = await db
    .select({ id: messagesTable.id, imageUrl: messagesTable.imageUrl })
    .from(messagesTable)
    .where(
      and(
        isNotNull(messagesTable.imageUrl),
        isNull(messagesTable.mediaStrippedThumb),
        lt(messagesTable.id, cursor),
      ),
    )
    .orderBy(desc(messagesTable.id))
    .limit(BATCH_SIZE);

  if (rows.length === 0) return { examined: 0, nextCursor: cursor, updated: 0 };

  let updated = 0;
  let nextCursor = cursor;
  for (const row of rows) {
    if (typeof row.id === "number" && row.id < nextCursor) nextCursor = row.id;
    if (!row.imageUrl) continue;
    const stripped = await generateForUrl(row.imageUrl);
    if (!stripped) continue;
    try {
      await db
        .update(messagesTable)
        .set({ mediaStrippedThumb: stripped })
        .where(eq(messagesTable.id, row.id));
      updated += 1;
    } catch (err) {
      logger.debug({ err, id: row.id }, "stripped thumb backfill row update failed");
    }
  }

  return { examined: rows.length, nextCursor, updated };
}

const INT4_MAX = 2_147_483_647;

export async function runStrippedThumbBackfill(): Promise<void> {
  if (!BUCKET_ID) {
    logger.debug("stripped thumb backfill skipped — no bucket configured");
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
      logger.warn({ err }, "stripped thumb backfill batch failed; aborting");
      return;
    }
    if (batch.examined === 0) break;
    if (batch.nextCursor >= cursor) {
      logger.warn({ cursor }, "stripped thumb backfill cursor stalled; aborting");
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
      "stripped thumb backfill done",
    );
  }
}
