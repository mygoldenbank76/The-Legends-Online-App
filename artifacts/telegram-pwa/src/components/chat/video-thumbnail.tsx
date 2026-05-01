/**
 * VideoThumbnail — non-playing video preview tile shown in chat bubbles.
 *
 * Behaviour:
 *  - On first ever encounter with a video URL: load metadata in an
 *    OFF-SCREEN <video>, seek to the 0.1 s frame, draw it onto a canvas,
 *    save the resulting JPEG data URL in localStorage keyed by URL.
 *  - On every subsequent encounter (and on every paint after the first
 *    capture): render the cached frame as a regular <img>. No <video>
 *    bytes are loaded, no black flash, paint is instant — same UX as
 *    Telegram's video thumbnails.
 *  - A single centred play-button overlay is the only chrome. Tapping the
 *    tile fires `onClick`, which in chat-area opens the full-screen
 *    MediaViewer (where actual playback happens with native controls).
 *
 * Aspect-ratio resolution priority (so the bubble shape is correct on
 * the very first paint, no landscape→portrait flash):
 *   1) `intrinsicWidth` / `intrinsicHeight` props (server-stored at
 *      upload time, always correct, available immediately).
 *   2) localStorage URL ratio cache (covers legacy messages + offline).
 *   3) Off-screen <video> `loadedmetadata` event — last resort.
 *
 * The visible placeholder shown WHILE the first-ever capture is in
 * flight is a soft purple gradient, NOT a black box, so the brief gap
 * doesn't look like the player is broken.
 */
import { useState, useEffect } from 'react';
import { Play, Loader2 } from 'lucide-react';

interface Props {
  src: string;
  className?: string;
  intrinsicWidth?: number;
  intrinsicHeight?: number;
  onClick?: () => void;
}

// ── Aspect-ratio cache ────────────────────────────────────────────────
const aspectMemCache = new Map<string, number>();
const ASPECT_LS_PREFIX = 'tc:vra:';

function getCachedAspect(url: string): number | null {
  const m = aspectMemCache.get(url);
  if (m && isFinite(m) && m > 0) return m;
  try {
    const s = localStorage.getItem(ASPECT_LS_PREFIX + url);
    if (s) {
      const n = parseFloat(s);
      if (isFinite(n) && n > 0) {
        aspectMemCache.set(url, n);
        return n;
      }
    }
  } catch { /* localStorage unavailable */ }
  return null;
}
function setCachedAspect(url: string, r: number): void {
  if (!isFinite(r) || r <= 0) return;
  aspectMemCache.set(url, r);
  try { localStorage.setItem(ASPECT_LS_PREFIX + url, String(r)); } catch { /* quota */ }
}

// ── Poster (first-frame) cache ────────────────────────────────────────
//   Keys are full video URLs, values are JPEG data URLs (~10–40 KB each).
//   When localStorage runs out of space we evict ~20 % of the OLDEST
//   poster entries (insertion order) and retry once. Aspect-ratio
//   entries are kept untouched — they're tiny and high-value.
const posterMemCache = new Map<string, string>();
const POSTER_LS_PREFIX = 'tc:vp:';

function getCachedPoster(url: string): string | null {
  const m = posterMemCache.get(url);
  if (m) return m;
  try {
    const s = localStorage.getItem(POSTER_LS_PREFIX + url);
    if (s) {
      posterMemCache.set(url, s);
      return s;
    }
  } catch { /* localStorage unavailable */ }
  return null;
}

function setCachedPoster(url: string, dataUrl: string): void {
  posterMemCache.set(url, dataUrl);
  const tryStore = () => localStorage.setItem(POSTER_LS_PREFIX + url, dataUrl);
  try {
    tryStore();
  } catch {
    // Likely quota exceeded — evict oldest poster keys and retry once.
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(POSTER_LS_PREFIX)) keys.push(k);
      }
      const drop = Math.max(1, Math.ceil(keys.length * 0.2));
      for (let i = 0; i < drop; i++) localStorage.removeItem(keys[i]);
      tryStore();
    } catch { /* still failing — memory cache will keep working */ }
  }
}

/** Draws the current frame of `v` to a canvas and returns a JPEG data URL.
 *  Returns null on any failure (taint, no frame, decoder issue) — caller
 *  treats that as "no poster yet" and falls back to the placeholder. */
function captureFrame(v: HTMLVideoElement, maxDim = 360): string | null {
  if (v.videoWidth <= 0 || v.videoHeight <= 0) return null;
  try {
    const canvas = document.createElement('canvas');
    const ratio = v.videoWidth / v.videoHeight;
    if (ratio >= 1) {
      canvas.width = maxDim;
      canvas.height = Math.round(maxDim / ratio);
    } else {
      canvas.height = maxDim;
      canvas.width = Math.round(maxDim * ratio);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL('image/jpeg', 0.7);
    // Sanity-check: a valid JPEG of any size is well over 1 KB. Anything
    // tiny is almost certainly a blank/transparent canvas (some browsers
    // return one when drawImage runs before the frame is decoded).
    if (out.length < 1024) return null;
    return out;
  } catch {
    return null; // tainted canvas (rare for same-origin) or other error
  }
}

const DEFAULT_FALLBACK_ASPECT = 9 / 16;

export function VideoThumbnail({
  src, className = '', intrinsicWidth, intrinsicHeight, onClick,
}: Props) {
  const intrinsicRatio = (intrinsicWidth && intrinsicHeight && intrinsicHeight > 0)
    ? intrinsicWidth / intrinsicHeight
    : null;

  const [aspect, setAspect] = useState<number | null>(
    () => intrinsicRatio ?? getCachedAspect(src),
  );
  const [poster, setPoster] = useState<string | null>(() => getCachedPoster(src));

  // Re-resolve when the URL or supplied dimensions change (component reuse
  // via React's key reconciliation when scrolling through messages).
  useEffect(() => {
    setAspect(intrinsicRatio ?? getCachedAspect(src));
    setPoster(getCachedPoster(src));
  }, [src, intrinsicRatio]);

  // First-load capture: if we don't have a cached poster, load the video
  // in an OFF-SCREEN element, grab its first frame, cache it. From then
  // on this URL renders instantly as a regular <img>.
  useEffect(() => {
    if (poster) return;
    let cancelled = false;
    let captured = false;

    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'metadata';
    // Append off-screen so iOS Safari actually decodes the frame —
    // detached <video> elements sometimes never paint on WebKit.
    v.style.position = 'fixed';
    v.style.left = '-99999px';
    v.style.top = '-99999px';
    v.style.width = '1px';
    v.style.height = '1px';
    v.style.opacity = '0';
    v.style.pointerEvents = 'none';
    document.body.appendChild(v);
    // Use #t=0.1 so the browser seeks to the 0.1 s mark on metadata
    // load — that's the frame we want as the thumbnail.
    v.src = `${src}#t=0.1`;

    const tryCapture = () => {
      if (cancelled || captured) return;
      if (v.readyState < 2 /* HAVE_CURRENT_DATA */) return;
      // Cache the aspect ratio while we have it (cheap and useful even
      // if the frame capture itself fails).
      if (v.videoWidth > 0 && v.videoHeight > 0) {
        const r = v.videoWidth / v.videoHeight;
        setCachedAspect(src, r);
        setAspect(prev => prev ?? r);
      }
      const dataUrl = captureFrame(v);
      if (!dataUrl || cancelled) return;
      captured = true;
      setCachedPoster(src, dataUrl);
      setPoster(dataUrl);
      // Free the buffer immediately — we have the frame, the bytes are
      // no longer needed.
      v.src = '';
      v.load();
      v.remove();
    };

    v.addEventListener('loadeddata', tryCapture);
    v.addEventListener('seeked', tryCapture);
    v.addEventListener('canplay', tryCapture);
    // Some browsers fire `error` for unsupported codecs etc. — clean up.
    const onErr = () => { if (!cancelled) v.remove(); };
    v.addEventListener('error', onErr);

    v.load();

    return () => {
      cancelled = true;
      v.removeEventListener('loadeddata', tryCapture);
      v.removeEventListener('seeked', tryCapture);
      v.removeEventListener('canplay', tryCapture);
      v.removeEventListener('error', onErr);
      v.src = '';
      try { v.remove(); } catch { /* already removed */ }
    };
  }, [src, poster]);

  const effectiveAspect = aspect ?? DEFAULT_FALLBACK_ASPECT;

  return (
    <div
      className={`relative overflow-hidden cursor-pointer select-none ${className}`}
      style={{
        aspectRatio: String(effectiveAspect),
        maxHeight: '70vh',
        // Soft purple-tinted gradient placeholder so the very brief moment
        // before the cached poster (or first-frame capture) lands isn't a
        // jarring black box. Matches the app's accent palette.
        background:
          'linear-gradient(135deg, rgba(140,120,255,0.14), rgba(60,40,120,0.22))',
      }}
      onClick={onClick}
    >
      {poster && (
        <img
          src={poster}
          alt=""
          className="absolute inset-0 w-full h-full object-contain block"
          draggable={false}
        />
      )}

      {!poster && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Loader2 className="w-6 h-6 text-white/70 animate-spin" />
        </div>
      )}

      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
        >
          <Play className="w-7 h-7 text-white ml-1" />
        </div>
      </div>
    </div>
  );
}
