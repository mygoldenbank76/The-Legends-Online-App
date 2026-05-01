/**
 * VideoPlayer — custom styled video player with:
 * - Play/pause overlay (tap anywhere)
 * - Progress bar with seeking
 * - Time display (current / total)
 * - Fullscreen via Fullscreen API
 * - Volume toggle
 * - Auto-hide controls when playing
 *
 * IMPORTANT: aspect-ratio handling.
 * Browsers default a <video> with no metadata to 300x150 (landscape 2:1).
 * That meant whenever a portrait phone-recording was loaded for the first
 * time, the bubble briefly appeared as a wide landscape box and then
 * "snapped" to its real portrait shape once metadata arrived. To eliminate
 * this jarring flash we:
 *   1) cache each URL's intrinsic aspect ratio (memory + localStorage), so
 *      any subsequent visit can size the bubble correctly on the very first
 *      paint (no flash, ever);
 *   2) on first-ever load (no cache yet), we apply a sensible portrait
 *      default (9/16 — the common case for user recordings on this app) AND
 *      we hide the <video> element with opacity-0 behind a small loader
 *      until metadata arrives, then fade it in at the now-known correct
 *      size. After that first load, the URL is cached for ever.
 */
import { useRef, useState, useEffect, useCallback } from 'react';
import { Play, Pause, Maximize2, Volume2, VolumeX, Loader2 } from 'lucide-react';

interface Props {
  src: string;
  className?: string;
  poster?: string;
  onExpand?: () => void;
}

// ── Aspect-ratio cache (shared across all VideoPlayer instances) ────────────
// Keyed by full video URL. Stored as `width / height`.
const videoAspectMemCache = new Map<string, number>();
const ASPECT_LS_PREFIX = 'tc:vra:'; // telechat video ratio aspect

function getCachedAspect(url: string): number | null {
  const mem = videoAspectMemCache.get(url);
  if (mem && isFinite(mem) && mem > 0) return mem;
  try {
    const stored = localStorage.getItem(ASPECT_LS_PREFIX + url);
    if (stored) {
      const n = parseFloat(stored);
      if (isFinite(n) && n > 0) {
        videoAspectMemCache.set(url, n);
        return n;
      }
    }
  } catch {
    /* localStorage unavailable (private mode etc.) — fall back to memory only */
  }
  return null;
}

function setCachedAspect(url: string, ratio: number): void {
  if (!isFinite(ratio) || ratio <= 0) return;
  videoAspectMemCache.set(url, ratio);
  try {
    localStorage.setItem(ASPECT_LS_PREFIX + url, String(ratio));
  } catch {
    /* quota exceeded or unavailable — memory cache still works */
  }
}

// Default ratio used only on the very first load of a brand-new video,
// before metadata has arrived. Portrait because user-recorded mobile videos
// (the common case here) are portrait. The video itself is hidden behind a
// loader during this brief window so the user never sees a wrong-orientation
// frame — the placeholder just needs SOME shape so the bubble isn't 0×0.
const DEFAULT_FALLBACK_ASPECT = 9 / 16;

function formatTime(s: number): string {
  if (!isFinite(s) || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export function VideoPlayer({ src, className = '', poster, onExpand }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // ── Aspect ratio: cached from previous loads → applied immediately ───────
  // If we already know the ratio (cache hit), the bubble is correctly sized
  // on the very first paint and the <video> can be shown right away with no
  // risk of a wrong-orientation flash.
  const [aspectRatio, setAspectRatio] = useState<number | null>(() => getCachedAspect(src));
  const [metaLoaded, setMetaLoaded] = useState<boolean>(() => getCachedAspect(src) !== null);

  // Reset cached state when the src changes (e.g. when this player is reused
  // for a different message — happens with React's key reconciliation).
  useEffect(() => {
    const cached = getCachedAspect(src);
    setAspectRatio(cached);
    setMetaLoaded(cached !== null);
  }, [src]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  // ── Control visibility auto-hide ──────────────────────────────────────────
  const showAndScheduleHide = useCallback(() => {
    setShowControls(true);
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    if (isPlaying) {
      hideControlsTimer.current = setTimeout(() => setShowControls(false), 3000);
    }
  }, [isPlaying]);

  useEffect(() => {
    if (!isPlaying) {
      setShowControls(true);
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    }
  }, [isPlaying]);

  // ── Video event listeners ─────────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => { setIsPlaying(false); setShowControls(true); };
    const onTimeUpdate = () => { if (!isDragging) setCurrentTime(v.currentTime); };
    const onLoadedMeta = () => {
      setDuration(v.duration);
      // Capture intrinsic dimensions ASAP so future visits to this same
      // video render at the correct shape from the very first paint.
      if (v.videoWidth > 0 && v.videoHeight > 0) {
        const r = v.videoWidth / v.videoHeight;
        setCachedAspect(src, r);
        setAspectRatio(r);
      }
      setMetaLoaded(true);
    };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onEnded);
    v.addEventListener('timeupdate', onTimeUpdate);
    v.addEventListener('loadedmetadata', onLoadedMeta);
    // If the video element already had metadata before this effect ran
    // (cache hit + immediate availability via HMR / fast cache), fire it once.
    if (v.readyState >= 1 && v.videoWidth > 0 && v.videoHeight > 0) {
      onLoadedMeta();
    }
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('timeupdate', onTimeUpdate);
      v.removeEventListener('loadedmetadata', onLoadedMeta);
    };
  }, [isDragging, src]);

  // ── Fullscreen change listener ─────────────────────────────────────────────
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────
  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
    showAndScheduleHide();
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setIsMuted(v.muted);
  };

  const toggleFullscreen = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Prefer in-app viewer (consistent UX across devices) when available
    if (onExpand) {
      videoRef.current?.pause();
      onExpand();
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen().catch(() => {});
    }
  };

  // ── Seeking ───────────────────────────────────────────────────────────────
  const seek = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    const bar = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const ratio = Math.max(0, Math.min(1, (clientX - bar.left) / bar.width));
    const v = videoRef.current;
    if (!v || !isFinite(duration)) return;
    v.currentTime = ratio * duration;
    setCurrentTime(ratio * duration);
  };

  // The container is sized via CSS aspect-ratio so the bubble shape is
  // determined BEFORE any video bytes load — preventing the landscape→
  // portrait flash. Cache hit → real ratio; cache miss → portrait default
  // while the video stays hidden behind a loader.
  const effectiveAspect = aspectRatio ?? DEFAULT_FALLBACK_ASPECT;

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden bg-black cursor-pointer select-none ${className}`}
      style={{
        aspectRatio: String(effectiveAspect),
        // Cap the visible height so very tall portrait videos don't hog
        // the entire screen. With aspect-ratio set, hitting this maxHeight
        // makes the browser shrink the WIDTH proportionally to preserve
        // the ratio — which is exactly what we want.
        maxHeight: isFullscreen ? 'none' : '70vh',
      }}
      onClick={togglePlay}
      onMouseMove={showAndScheduleHide}
      onTouchStart={showAndScheduleHide}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        preload="metadata"
        playsInline
        className="w-full h-full object-contain block transition-opacity duration-150"
        style={{ opacity: metaLoaded ? 1 : 0 }}
      />

      {/* Loading placeholder shown ONLY for the very first load of an
          uncached video, while metadata is being fetched. Hidden as soon
          as the real intrinsic size is known (and then permanently for
          this URL thanks to the persistent cache). */}
      {!metaLoaded && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black">
          <Loader2 className="w-6 h-6 text-white/60 animate-spin" />
        </div>
      )}

      {/* Play/Pause center button — only show once metadata is loaded so
          we don't render a misleading play button over an empty box. */}
      {metaLoaded && (!isPlaying || showControls) && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
          >
            {isPlaying
              ? <Pause className="w-7 h-7 text-white" />
              : <Play className="w-7 h-7 text-white ml-1" />
            }
          </div>
        </div>
      )}

      {/* Bottom controls bar — hidden until metadata is loaded so we don't
          show a stale "0:00 / 0:00" line over the placeholder. */}
      <div
        className="absolute bottom-0 left-0 right-0 transition-opacity duration-300"
        style={{
          opacity: metaLoaded && showControls ? 1 : 0,
          pointerEvents: metaLoaded && showControls ? 'auto' : 'none',
          background: 'linear-gradient(transparent, rgba(0,0,0,0.75))',
          padding: '20px 10px 8px',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Progress bar */}
        <div
          className="relative h-1.5 rounded-full bg-white/25 mb-2 cursor-pointer"
          onMouseDown={e => { setIsDragging(true); seek(e); }}
          onMouseMove={e => { if (isDragging) seek(e); }}
          onMouseUp={() => setIsDragging(false)}
          onMouseLeave={() => setIsDragging(false)}
          onTouchStart={e => { setIsDragging(true); seek(e); }}
          onTouchMove={e => { if (isDragging) seek(e); }}
          onTouchEnd={() => setIsDragging(false)}
        >
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progress}%` }}
          />
          {/* Thumb */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow"
            style={{ left: `calc(${progress}% - 6px)` }}
          />
        </div>

        {/* Controls row */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-white/80 text-[10px] font-mono tabular-nums">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleMute}
              className="text-white/70 hover:text-white transition-colors p-1"
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <button
              onClick={toggleFullscreen}
              className="text-white/70 hover:text-white transition-colors p-1"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
