/**
 * Telegram-style "stripped thumbnail" encoder.
 *
 * The wire format mirrors https://core.telegram.org/api/files#stripped-thumbnails:
 *
 *   [0x01, width_byte, height_byte, ...entropy data from SOS through EOI]
 *
 * The trick: a JPEG file is ~600 bytes of header (quantization tables +
 * Huffman tables + SOF0) followed by the actual entropy-coded scan data.
 * For a 40x40 grayscale-ish thumbnail the entropy data is only ~50-300
 * bytes — the header dominates the payload. By agreeing on a FIXED
 * canonical prefix on both sides, we only need to ship the entropy data
 * + the 3 dimension bytes.
 *
 * Determinism contract — DO NOT touch these sharp options without also
 * regenerating the canonical prefix in `telegram-pwa/src/lib/stripped-
 * thumb.ts`. The prefix bytes are valid ONLY for this exact profile:
 *
 *   • mozjpeg: false        — mozjpeg may choose per-image Huffman codes
 *   • optimiseCoding: false — same reason
 *   • optimizeScans: false  — no progressive multi-scan layout
 *   • progressive: false    — single-scan baseline JPEG
 *   • chromaSubsampling: '4:2:0' — fixes which Huffman tables apply
 *   • quality: 50           — fixes the quantization table values
 *
 * With these flags pinned, sharp produces a byte-identical 591-byte
 * header for every input image (verified empirically) and only the
 * scan data varies. Width/height (≤ 255) live at offsets 145/147 of
 * that prefix and are the only header bytes the decoder injects.
 *
 * Output: a base64 string suitable for direct storage in a TEXT column
 * and embedding in JSON payloads. Returns null on any failure or for
 * inputs that produce a JPEG bigger than the absolute safety cap (we'd
 * rather drop the value than ship a multi-KB blob in every message).
 */

import sharp from "sharp";
import { logger } from "./logger";

// Must match the prefix length used by the client decoder. Sharp produces
// 591 header bytes (everything before the FF DA SOS marker) for the
// pinned encoding profile above.
const CANONICAL_PREFIX_LEN = 591;

// Target dimensions. Telegram uses ≤ 90, we use 40 to keep the entropy
// data small. Anything ≤ 255 fits in the single-byte dim slots of the
// stripped wire format — bigger would overflow.
const TARGET_DIM = 40;

// Hard cap on the stripped payload (raw bytes, before base64). The
// entropy data for a 40x40 4:2:0 photo is normally 80-300 bytes; 1024
// is a generous safety net. Anything larger means the JPEG encoder
// produced an unusual layout and we'd rather drop the value than
// store / ship a malformed payload.
const MAX_STRIPPED_BYTES = 1024;

// Hard cap on source bytes. A pixel-bomb defence in addition to sharp's
// limitInputPixels. Matches the LQIP backfill ceiling.
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

export async function generateStrippedThumb(
  source: Buffer,
): Promise<string | null> {
  if (!Buffer.isBuffer(source) || source.length === 0) return null;
  if (source.length > MAX_SOURCE_BYTES) return null;

  let jpeg: Buffer;
  let info: sharp.OutputInfo;
  try {
    const result = await sharp(source, {
      failOn: "none",
      limitInputPixels: 100_000_000,
    })
      // Apply EXIF rotation BEFORE resize so the thumbnail matches the
      // orientation the browser will paint for the original.
      .rotate()
      .resize({ width: TARGET_DIM, height: TARGET_DIM, fit: "inside" })
      .jpeg({
        quality: 50,
        mozjpeg: false,
        optimiseCoding: false,
        optimizeScans: false,
        progressive: false,
        chromaSubsampling: "4:2:0",
      })
      .toBuffer({ resolveWithObject: true });
    jpeg = result.data;
    info = result.info;
  } catch (err) {
    logger.debug({ err }, "stripped thumb sharp encode failed");
    return null;
  }

  if (jpeg.length <= CANONICAL_PREFIX_LEN + 2) {
    // Smaller than prefix + EOI — couldn't possibly be a valid JPEG.
    return null;
  }

  // Defence-in-depth: verify the prefix actually ends at the SOS marker
  // (FF DA) at the expected offset. If sharp's header layout has drifted
  // (different libjpeg version, different sharp build), bail out so we
  // ship NO stripped value rather than corrupted data.
  if (
    jpeg[CANONICAL_PREFIX_LEN] !== 0xff ||
    jpeg[CANONICAL_PREFIX_LEN + 1] !== 0xda
  ) {
    logger.warn(
      { sosByte0: jpeg[CANONICAL_PREFIX_LEN], sosByte1: jpeg[CANONICAL_PREFIX_LEN + 1] },
      "stripped thumb: SOS marker not at canonical offset; check sharp/libjpeg version vs prefix in telegram-pwa/src/lib/stripped-thumb.ts",
    );
    return null;
  }

  const w = info.width;
  const h = info.height;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0 || w > 255 || h > 255) {
    return null;
  }

  // Build the wire payload: [0x01, w, h, ...everything from SOS onwards
  // (which already ends with the JPEG EOI marker FF D9)].
  const entropy = jpeg.subarray(CANONICAL_PREFIX_LEN);
  if (entropy.length > MAX_STRIPPED_BYTES) return null;

  const wire = Buffer.alloc(3 + entropy.length);
  wire[0] = 0x01;
  wire[1] = w;
  wire[2] = h;
  entropy.copy(wire, 3);

  return wire.toString("base64");
}
