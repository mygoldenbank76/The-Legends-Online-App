/**
 * VideoThumbnail — non-playing video preview tile shown in chat bubbles.
 *
 * Behaviour:
 *  - Renders the video's first frame (no controls, no playback) at the
 *    correct aspect ratio on the very first paint — no landscape→portrait
 *    flash.
 *  - A single centred play-button overlay is the only chrome.
 *  - Tapping anywhere on the tile opens the full-screen MediaViewer
 *    via `onClick`, which is where actual playback happens.
 *
 * Aspect-ratio resolution priority (same as the previous VideoPlayer, so
 * legacy messages without server-stored dimensions still avoid the flash):
 *   1) `intrinsicWidth` / `intrinsicHeight` props (server-stored, always
 *      correct, available on the first paint).
 *   2) localStorage URL cache (populated from a previous visit on this
 *      device, covers messages inserted before the schema columns).
 *   3) <video> `loadedmetadata` event — last-resort, video kept invisible
 *      behind a small loader meanwhile so we never show a wrong-shape frame.
 */
import { useRef, useState, useEffect } from 'react';
import { Play, Loader2 } from 'lucide-react';

interface Props {
  src: string;
  className?: string;
  intrinsicWidth?: number;
  intrinsicHeight?: number;
  onClick?: () => void;
}

const aspectMemCache = new Map<string, number>();
const ASPECT_LS_PREFIX = 'tc:vra:';

function getCachedAspect(url: string): number | null {
  const mem = aspectMemCache.get(url);
  if (mem && isFinite(mem) && mem > 0) return mem;
  try {
    const stored = localStorage.getItem(ASPECT_LS_PREFIX + url);
    if (stored) {
      const n = parseFloat(stored);
      if (isFinite(n) && n > 0) {
        aspectMemCache.set(url, n);
        return n;
      }
    }
  } catch { /* localStorage unavailable */ }
  return null;
}

function setCachedAspect(url: string, ratio: number): void {
  if (!isFinite(ratio) || ratio <= 0) return;
  aspectMemCache.set(url, ratio);
  try {
    localStorage.setItem(ASPECT_LS_PREFIX + url, String(ratio));
  } catch { /* quota exceeded — memory cache is enough */ }
}

const DEFAULT_FALLBACK_ASPECT = 9 / 16; // portrait — common case for phone recordings

export function VideoThumbnail({
  src, className = '', intrinsicWidth, intrinsicHeight, onClick,
}: Props) {
  const intrinsicRatio = (intrinsicWidth && intrinsicHeight && intrinsicHeight > 0)
    ? intrinsicWidth / intrinsicHeight
    : null;

  const initial = intrinsicRatio ?? getCachedAspect(src);
  const [aspect, setAspect] = useState<number | null>(initial);
  const [ready, setReady] = useState<boolean>(initial !== null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const next = intrinsicRatio ?? getCachedAspect(src);
    setAspect(next);
    setReady(next !== null);
  }, [src, intrinsicRatio]);

  // Capture intrinsic dimensions from the video element itself as a
  // fallback for legacy messages with no server-stored dimensions.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onMeta = () => {
      if (v.videoWidth > 0 && v.videoHeight > 0) {
        const r = v.videoWidth / v.videoHeight;
        setCachedAspect(src, r);
        setAspect(r);
      }
      setReady(true);
    };
    v.addEventListener('loadedmetadata', onMeta);
    if (v.readyState >= 1 && v.videoWidth > 0 && v.videoHeight > 0) onMeta();
    return () => v.removeEventListener('loadedmetadata', onMeta);
  }, [src]);

  const effectiveAspect = aspect ?? DEFAULT_FALLBACK_ASPECT;

  // The `#t=0.1` URL fragment asks the browser to seek to the 0.1 s mark
  // when loading metadata — most engines (Chrome, Firefox, Safari) then
  // paint that frame as the visible "poster" without playing the video.
  // This gives us a real thumbnail with no extra request.
  const posterSrc = src.includes('#') ? src : `${src}#t=0.1`;

  return (
    <div
      className={`relative overflow-hidden bg-black cursor-pointer select-none ${className}`}
      style={{
        aspectRatio: String(effectiveAspect),
        maxHeight: '70vh',
      }}
      onClick={onClick}
    >
      <video
        ref={videoRef}
        src={posterSrc}
        preload="metadata"
        muted
        playsInline
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {...({ disablePictureInPicture: true, disableRemotePlayback: true } as any)}
        className="w-full h-full object-contain block transition-opacity duration-150"
        style={{ opacity: ready ? 1 : 0, pointerEvents: 'none' }}
      />

      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black">
          <Loader2 className="w-6 h-6 text-white/60 animate-spin" />
        </div>
      )}

      {ready && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
          >
            <Play className="w-7 h-7 text-white ml-1" />
          </div>
        </div>
      )}
    </div>
  );
}
