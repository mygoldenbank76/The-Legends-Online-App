/**
 * LQIP — Low-Quality Image Placeholder.
 *
 * Generates a tiny ~32 px JPEG of an image File and returns it as a
 * `data:image/jpeg;base64,…` string. Typical output is 700–1500 bytes,
 * small enough to embed directly inside the message JSON payload.
 *
 * The receiving client paints this string immediately as a blurred
 * background behind the bubble. The full-resolution photo (often
 * several MB on HD uploads) then crossfades over the top once it
 * finishes downloading from object storage. Net effect: there is no
 * coloured-rectangle placeholder phase any more — the user sees a
 * recognisable preview of the actual photo from the very first
 * frame, exactly the UX of Telegram / WhatsApp / Instagram.
 *
 * Hardened so the upload pipeline can NEVER hang on it:
 *   • 4 s hard watchdog
 *   • every failure path resolves to `null` (caller will simply
 *     send the message without an LQIP — the legacy aspect-ratio
 *     placeholder is still in place as a fallback)
 *   • output is rejected if it exceeds 4 KB so a misbehaving file
 *     can never bloat the message row beyond a sane bound
 */

const LQIP_MAX_DIM = 32;
const LQIP_QUALITY = 0.4;
const LQIP_MAX_BYTES = 4096;

export async function generateLqip(input: File | Blob | null | undefined): Promise<string | null> {
  if (!input) return null;
  if (typeof (input as File).type === "string" && !(input as File).type.startsWith("image/")) {
    return null;
  }

  return new Promise<string | null>((resolve) => {
    const url = URL.createObjectURL(input);
    const img = new Image();
    let settled = false;

    const watchdog = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      try { URL.revokeObjectURL(url); } catch { /**/ }
      resolve(null);
    }, 4000);

    const finish = (out: string | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(watchdog);
      try { URL.revokeObjectURL(url); } catch { /**/ }
      resolve(out);
    };

    img.onerror = () => finish(null);
    img.onload = () => {
      try {
        const nw = img.naturalWidth;
        const nh = img.naturalHeight;
        if (nw <= 0 || nh <= 0) { finish(null); return; }

        const ratio = nw / nh;
        let w: number;
        let h: number;
        if (ratio >= 1) {
          w = LQIP_MAX_DIM;
          h = Math.max(1, Math.round(LQIP_MAX_DIM / ratio));
        } else {
          h = LQIP_MAX_DIM;
          w = Math.max(1, Math.round(LQIP_MAX_DIM * ratio));
        }

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { finish(null); return; }
        ctx.drawImage(img, 0, 0, w, h);

        const dataUrl = canvas.toDataURL("image/jpeg", LQIP_QUALITY);
        if (!dataUrl.startsWith("data:image/")) { finish(null); return; }
        if (dataUrl.length > LQIP_MAX_BYTES) { finish(null); return; }
        finish(dataUrl);
      } catch {
        finish(null);
      }
    };

    img.src = url;
  });
}
