/**
 * VideoPlayer — custom styled video player with:
 * - Play/pause overlay (tap anywhere)
 * - Progress bar with seeking
 * - Time display (current / total)
 * - Fullscreen via Fullscreen API
 * - Volume toggle
 * - Auto-hide controls when playing
 */
import { useRef, useState, useEffect, useCallback } from 'react';
import { Play, Pause, Maximize2, Volume2, VolumeX } from 'lucide-react';

interface Props {
  src: string;
  className?: string;
  poster?: string;
  onExpand?: () => void;
}

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
    const onLoadedMeta = () => setDuration(v.duration);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onEnded);
    v.addEventListener('timeupdate', onTimeUpdate);
    v.addEventListener('loadedmetadata', onLoadedMeta);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('timeupdate', onTimeUpdate);
      v.removeEventListener('loadedmetadata', onLoadedMeta);
    };
  }, [isDragging]);

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

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden bg-black cursor-pointer select-none ${className}`}
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
        className="w-full h-full object-contain block"
        style={{ maxHeight: isFullscreen ? 'none' : '320px' }}
      />

      {/* Play/Pause center button */}
      {(!isPlaying || showControls) && (
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

      {/* Bottom controls bar */}
      <div
        className="absolute bottom-0 left-0 right-0 transition-opacity duration-300"
        style={{
          opacity: showControls ? 1 : 0,
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
