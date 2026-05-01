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

/**
 * Extract the first frame of a video File as a small JPEG Blob.
 *
 * Used at SEND time so the sender's browser produces a real preview
 * thumbnail (drawn off-screen via canvas), uploads it as a regular
 * image, and stores the resulting URL on the message. Every recipient
 * — and the sender on every future device — then renders that JPEG as
 * the video bubble's poster on the very first paint, with no momentary
 * black box and no need for each device to decode the video itself.
 *
 * Resolves to `null` on any failure (decode error, hard timeout,
 * tainted canvas, unsupported codec). Callers must treat that as
 * "no thumbnail" and proceed without one — the receiver's on-the-fly
 * capture path is still in place as a fallback for legacy videos.
 *
 * The output is bounded to ~480 px on the long edge at JPEG quality
 * 0.78 → typically 15–60 KB, fast to upload and small to store.
 */
export async function captureVideoFirstFrame(file: File): Promise<Blob | null> {
  if (!file.type.startsWith('video/')) return null;
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    let settled = false;
    const cleanup = () => {
      try { URL.revokeObjectURL(url); } catch { /**/ }
      try { video.src = ''; } catch { /**/ }
    };
    const done = (val: Blob | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(val);
    };

    const grab = () => {
      if (settled) return;
      if (video.readyState < 2 /* HAVE_CURRENT_DATA */) return;
      if (video.videoWidth <= 0 || video.videoHeight <= 0) return;
      try {
        const canvas = document.createElement('canvas');
        const maxDim = 480;
        const ratio = video.videoWidth / video.videoHeight;
        if (ratio >= 1) {
          canvas.width = maxDim;
          canvas.height = Math.max(1, Math.round(maxDim / ratio));
        } else {
          canvas.height = maxDim;
          canvas.width = Math.max(1, Math.round(maxDim * ratio));
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) { done(null); return; }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => done(blob && blob.size > 1024 ? blob : null),
          'image/jpeg',
          0.78,
        );
      } catch {
        done(null);
      }
    };

    // Seek slightly past frame 0 — the literal first frame is sometimes
    // a black/blank intro frame on certain encoders. 0.1 s is a safe
    // sweet-spot used by every major chat app.
    video.addEventListener('loadeddata', () => {
      if (settled) return;
      try { video.currentTime = 0.1; } catch { grab(); }
    });
    video.addEventListener('seeked', grab);
    video.addEventListener('error', () => done(null));

    // Hard ceiling: never block the upload pipeline waiting for a frame.
    setTimeout(() => done(null), 6000);

    video.src = url;
  });
}
