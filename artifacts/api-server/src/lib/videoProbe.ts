/**
 * Video probe — intrinsic dimensions + tiny LQIP for video messages.
 *
 * Uses the system `ffprobe` and `ffmpeg` binaries (ships in the Replit
 * runtime image) to:
 *
 *   1) Read the video's first video-stream width/height — same role as
 *      `image-size` for stills, lets the receiver paint the bubble at
 *      the correct shape on the very first frame.
 *
 *   2) Decode a single key-frame at t=0 to a JPEG, then scale + re-
 *      encode through sharp into a ≤ 4 KB base64 data URL. That LQIP
 *      goes straight into `messages.media_preview`, so video bubbles
 *      get the same "blurred placeholder while the file streams"
 *      treatment as photo bubbles — no momentary black box.
 *
 * Design notes:
 *   • Never throws. Every failure path returns `null` and logs at
 *     debug level so the caller can fall through to the legacy
 *     "no preview" rendering.
 *   • Bounded by `MAX_SOURCE_BYTES`. Extracting a frame from a 100 MB
 *     video would still need to read its container index — we cap
 *     the source we'll touch so a malicious upload can't make the
 *     server burn time on a multi-GB stream.
 *   • Operates on a temp file. ffmpeg can read from stdin but not
 *     seek, and key-frame extraction needs seek for non-trivial
 *     containers. Writing to /tmp once and unlinking after is the
 *     safest path; the temp dir is RAM-backed in the Replit runtime
 *     so this is cheap.
 *   • Single ffmpeg invocation that pipes the JPEG to stdout — we
 *     avoid emitting a poster file to GCS here (the client already
 *     uploads a real poster when it captures one at send time).
 */

import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

import { logger } from "./logger";
import { objectStorageClient } from "./objectStorage";

const BUCKET_ID = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
const UPLOAD_PREFIX = "telechat-uploads";

// Same caps as the image LQIP path so the wire shape is uniform.
// Telegram-grade ultra-tiny placeholder. Kept in lockstep with the
// image-side LQIP constants in backfillMediaPreview.ts. 24x24 q30
// mozjpeg gives ~300-700 byte JPEGs, ~5x lighter than the previous
// 32x32 q40 baseline while remaining visually indistinguishable
// once the client's blur-md filter is applied.
const LQIP_MAX_DIM = 24;
const LQIP_QUALITY = 30;
const LQIP_MAX_BYTES = 1500;
// Hard cap on how big a video file we're willing to touch for
// preview/dim probing. Real phone videos are well under 50 MB; this
// stops a pathological 4K/HEVC/2-hour upload from monopolising the
// worker.
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
// ffmpeg/ffprobe must finish in this window or we kill them. A first
// key-frame extract on a sane MP4 is ~50–500 ms; 8 s leaves a huge
// margin while still guaranteeing the request handler can't hang.
const PROBE_TIMEOUT_MS = 8000;

const VIDEO_EXT = /\.(mp4|webm|mov|avi|mkv|m4v)(\?|$)/i;

// Concurrency guard. ffmpeg key-frame extraction is CPU-bound and
// `file.download()` pulls the full byte stream into memory (up to
// MAX_SOURCE_BYTES). Without a cap, a burst of concurrent video
// sends or a backfill running alongside live traffic could hold
// many tens of MB of RSS at once and starve the event loop. We
// serialise probes through a tiny FIFO queue so request latency
// degrades gracefully (one request waits) instead of catastrophically
// (OOM / event loop stalls). Two slots keeps the live POST path
// responsive when the backfill is also active.
const MAX_CONCURRENT_PROBES = 2;
const STORAGE_TIMEOUT_MS = 10_000;
let activeProbes = 0;
const probeQueue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (activeProbes < MAX_CONCURRENT_PROBES) {
    activeProbes += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    probeQueue.push(() => {
      activeProbes += 1;
      resolve();
    });
  });
}

function releaseSlot(): void {
  activeProbes -= 1;
  const next = probeQueue.shift();
  if (next) next();
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

export type VideoProbeResult = {
  width: number;
  height: number;
  /** ≤ 4 KB JPEG data URL — feeds straight into `messages.media_preview`. */
  lqip: string | null;
};

export function isProbableVideo(url: string | null | undefined): boolean {
  if (!url) return false;
  return VIDEO_EXT.test(url);
}

function extractObjectId(url: string): string | null {
  const m = url.match(/\/api\/uploads\/gcs\/([^/?#]+)/);
  return m ? (m[1] ?? null) : null;
}

/**
 * Run a child process to completion, capturing stdout, with a hard
 * timeout that SIGKILLs the process. Resolves with `{stdout, code}`
 * on exit, or rejects on spawn / timeout / non-zero exit.
 */
function runChild(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: Buffer }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    child.stdout.on("data", (b: Buffer) => chunks.push(b));
    child.stderr.on("data", () => { /* swallow — only stdout matters */ });
    child.on("error", (err) => {
      if (killed) return;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (killed) return;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`${cmd} exited with code ${code}`));
        return;
      }
      resolve({ stdout: Buffer.concat(chunks) });
    });
  });
}

/**
 * Probe a video URL hosted in our object storage: pulls the bytes
 * down once into a temp file, runs ffprobe (dims) + ffmpeg (first
 * frame → JPEG → sharp → LQIP) in parallel, then cleans up.
 *
 * Returns `null` for any failure path — never throws.
 */
export async function probeVideo(url: string): Promise<VideoProbeResult | null> {
  if (!isProbableVideo(url)) return null;
  if (!BUCKET_ID) return null;
  const objectId = extractObjectId(url);
  if (!objectId) return null;

  let tempDir: string | null = null;
  await acquireSlot();
  try {
    const bucket = objectStorageClient.bucket(BUCKET_ID);
    const file = bucket.file(`${UPLOAD_PREFIX}/${objectId}`);

    // Cheap HEAD-style check: skip oversize videos before touching them.
    // Both calls are wrapped in a hard timeout — the GCS SDK's own
    // retries can otherwise hang the request for tens of seconds on a
    // transient network blip, which would block the slot and cascade
    // back-pressure into the POST handler.
    const [meta] = await withTimeout(
      file.getMetadata(),
      STORAGE_TIMEOUT_MS,
      "GCS getMetadata",
    );
    const size = typeof meta.size === "string" ? Number(meta.size) : meta.size;
    if (typeof size === "number" && size > MAX_SOURCE_BYTES) return null;

    const [buf] = await withTimeout(
      file.download(),
      STORAGE_TIMEOUT_MS,
      "GCS download",
    );
    if (!buf || buf.length === 0) return null;
    if (buf.length > MAX_SOURCE_BYTES) return null;

    tempDir = await mkdtemp(join(tmpdir(), "videoprobe-"));
    const inputPath = join(tempDir, "in.bin");
    await writeFile(inputPath, buf);

    // Dims via ffprobe — single line "WxH" output is the cheapest
    // parse path. We pin to the first video stream so audio-only
    // streams (.mp4 podcasts) probe to null, not garbage.
    const dimsP = runChild(
      "ffprobe",
      [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "csv=p=0:s=x",
        inputPath,
      ],
      PROBE_TIMEOUT_MS,
    ).then(({ stdout }) => {
      const line = stdout.toString("utf8").trim();
      const m = line.match(/^(\d+)x(\d+)$/);
      if (!m) return null;
      const w = Number(m[1]);
      const h = Number(m[2]);
      if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h)) return null;
      if (w <= 0 || h <= 0 || w > 100_000 || h > 100_000) return null;
      return { width: w, height: h };
    }).catch((err) => {
      logger.debug({ err, url }, "video ffprobe failed");
      return null;
    });

    // First-frame JPEG via ffmpeg, scaled to a small edge upfront so
    // sharp gets a tiny input and doesn't decode the original size.
    const frameP = runChild(
      "ffmpeg",
      [
        "-v", "error",
        "-i", inputPath,
        "-vf", `scale='min(${LQIP_MAX_DIM * 4},iw)':-2`,
        "-frames:v", "1",
        "-f", "image2pipe",
        "-vcodec", "mjpeg",
        "-",
      ],
      PROBE_TIMEOUT_MS,
    ).then(({ stdout }) => stdout)
      .catch((err) => {
        logger.debug({ err, url }, "video ffmpeg frame extract failed");
        return null;
      });

    const [dims, frameBuf] = await Promise.all([dimsP, frameP]);

    let lqip: string | null = null;
    if (frameBuf && frameBuf.length > 0) {
      try {
        const out = await sharp(frameBuf, {
          failOn: "none",
          limitInputPixels: 100_000_000,
        })
          .resize({ width: LQIP_MAX_DIM, height: LQIP_MAX_DIM, fit: "inside" })
          .jpeg({ quality: LQIP_QUALITY, mozjpeg: true })
          .toBuffer();
        const dataUrl = `data:image/jpeg;base64,${out.toString("base64")}`;
        if (dataUrl.length <= LQIP_MAX_BYTES) lqip = dataUrl;
      } catch (err) {
        logger.debug({ err, url }, "video LQIP encode failed");
      }
    }

    if (!dims && !lqip) return null;
    return {
      width: dims?.width ?? 0,
      height: dims?.height ?? 0,
      lqip,
    };
  } catch (err) {
    logger.debug({ err, url }, "probeVideo failed");
    return null;
  } finally {
    if (tempDir) {
      rm(tempDir, { recursive: true, force: true }).catch(() => { /* best effort */ });
    }
    releaseSlot();
  }
}
