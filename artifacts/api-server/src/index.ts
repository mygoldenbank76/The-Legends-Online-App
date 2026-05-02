import { httpServer } from "./app";
import { logger } from "./lib/logger";
import { runSeed } from "./seed";
import { runMediaDimsBackfill } from "./lib/backfillMediaDims";

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

  // Backfill missing media dimensions for legacy single-image messages so
  // every conversation paints its bubbles at the correct shape on the
  // very first frame. Idempotent (WHERE media_width IS NULL) and paced
  // (small batches with a delay) so re-running on every restart is safe.
  // Fully fire-and-forget — never blocks the listener and never crashes
  // the process if a probe fails.
  runMediaDimsBackfill().catch((e) =>
    logger.warn({ err: e }, "Media dims backfill warning"),
  );
});
