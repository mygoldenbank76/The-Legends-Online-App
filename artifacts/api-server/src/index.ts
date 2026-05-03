import { httpServer } from "./app";
import { logger } from "./lib/logger";
import { runSeed } from "./seed";
import { runMediaDimsBackfill } from "./lib/backfillMediaDims";
import { runMediaPreviewBackfill } from "./lib/backfillMediaPreview";
import { runVideoPreviewBackfill } from "./lib/backfillVideoPreview";
import { runStrippedThumbBackfill } from "./lib/backfillStrippedThumb";

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
    //   3) Video preview backfill — uses ffprobe + ffmpeg to fill
    //      legacy video bubbles with intrinsic dims and a tiny
    //      first-frame LQIP, so videos get the same "bubble already
    //      sized + blurred placeholder" treatment as photos. Bounded
    //      to source files ≤50 MB and a single-row pace so ffmpeg
    //      never starves request handling.
    try {
      await runVideoPreviewBackfill();
    } catch (e) {
      logger.warn({ err: e }, "Video preview backfill warning");
    }
    //   4) Stripped thumb backfill — fills the new column with a
    //      ~150-300 byte Telegram-format thumbnail for legacy single-
    //      image messages. Runs LAST so a fresh deploy first restores
    //      dims + LQIP (perceptible improvements on every photo) and
    //      only then chases the 600-byte-per-message wire savings.
    try {
      await runStrippedThumbBackfill();
    } catch (e) {
      logger.warn({ err: e }, "Stripped thumb backfill warning");
    }
  })();
});
