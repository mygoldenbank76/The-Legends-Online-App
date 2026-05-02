import { httpServer } from "./app";
import { logger } from "./lib/logger";
import { runSeed } from "./seed";
import { runMediaDimsBackfill } from "./lib/backfillMediaDims";
import { runMediaPreviewBackfill } from "./lib/backfillMediaPreview";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

httpServer.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Run seed on startup (idempotent — creates users/groups if not present)
  runSeed().catch((e) => logger.warn({ err: e }, "Seed warning"));

  // Run the two media backfills sequentially (not in parallel) so they
  // never compete for the same GCS bytes / DB connections / CPU time.
  // Both are fire-and-forget at the listen() boundary — they never
  // delay accepting traffic and never crash the process on individual
  // row failures. Both are also idempotent (WHERE … IS NULL) and
  // cursor-paced, so re-running on every restart is safe.
  //
  //   1) Dims backfill — fills legacy media_width/media_height so
  //      bubbles paint at the correct shape on the very first frame.
  //   2) LQIP preview backfill — fills legacy media_preview so every
  //      photo bubble paints a recognisable blurred preview instantly
  //      instead of an empty placeholder while the multi-MB original
  //      streams from GCS. Bounded to source files ≤12 MB to keep
  //      heap pressure low under sharp decode.
  void (async () => {
    try {
      await runMediaDimsBackfill();
    } catch (e) {
      logger.warn({ err: e }, "Media dims backfill warning");
    }
    try {
      await runMediaPreviewBackfill();
    } catch (e) {
      logger.warn({ err: e }, "Media preview backfill warning");
    }
  })();
});
