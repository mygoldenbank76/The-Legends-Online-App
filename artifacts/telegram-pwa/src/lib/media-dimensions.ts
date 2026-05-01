/**
 * Compute the intrinsic pixel dimensions of an image or video File before
 * uploading it. The result is sent to the server alongside the message so
 * receivers can size the bubble correctly on the very first paint — no
 * landscape→portrait flash, no loading placeholder.
 *
 * Failures (corrupt file, unsupported format, decode error) are swallowed
 * and the caller receives `null`: the message will simply be sent without
 * dimensions and the receiving client will fall back to its on-the-fly
 * metadata-loading behaviour. This keeps the upload path resilient.
 */

export type MediaDimensions = { width: number; height: number };

function readImage(file: File): Promise<MediaDimensions | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      URL.revokeObjectURL(url);
      if (w > 0 && h > 0) resolve({ width: w, height: h });
      else resolve(null);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function readVideo(file: File): Promise<MediaDimensions | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    let settled = false;
    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.src = '';
    };
    const done = (val: MediaDimensions | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(val);
    };
    video.onloadedmetadata = () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w > 0 && h > 0) done({ width: w, height: h });
      else done(null);
    };
    video.onerror = () => done(null);
    // Hard timeout — never block the upload pipeline waiting for metadata.
    setTimeout(() => done(null), 4000);
    video.src = url;
  });
}

export async function getMediaDimensions(file: File): Promise<MediaDimensions | null> {
  try {
    if (file.type.startsWith('image/')) return await readImage(file);
    if (file.type.startsWith('video/')) return await readVideo(file);
  } catch {
    /* swallow — caller will treat as unknown */
  }
  return null;
}
