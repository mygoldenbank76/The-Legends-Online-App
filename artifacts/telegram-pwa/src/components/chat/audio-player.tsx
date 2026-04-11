import { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause } from 'lucide-react';

type Props = {
  url: string;
  duration?: number | null;
  isMine: boolean;
};

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Deterministic waveform heights seeded from URL
function generateBars(seed: string, count: number): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  return Array.from({ length: count }, (_, i) => {
    h = (Math.imul(1664525, h) + 1013904223) | 0;
    const base = ((h >>> 0) % 60) + 20; // 20-80 range
    // Add natural speech envelope — slightly taller in the middle
    const env = 1 + 0.4 * Math.sin((i / count) * Math.PI);
    return Math.min(100, Math.round(base * env));
  });
}

const SPEEDS = [1, 1.5, 2];

export function AudioPlayer({ url, duration, isMine }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(duration ?? 0);
  const [progress, setProgress] = useState(0); // 0-100
  const [speedIdx, setSpeedIdx] = useState(0);
  const [dragging, setDragging] = useState(false);

  const bars = generateBars(url, 36);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTimeUpdate = () => {
      if (!dragging) {
        setCurrentTime(audio.currentTime);
        setProgress(audio.duration ? (audio.currentTime / audio.duration) * 100 : 0);
      }
    };
    const onDuration = () => { if (isFinite(audio.duration)) setTotalDuration(audio.duration); };
    const onEnded = () => { setPlaying(false); setCurrentTime(0); setProgress(0); };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDuration);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDuration);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
  }, [dragging]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); } else { try { await audio.play(); } catch (e) { console.error(e); } }
  };

  const cycleSpeed = () => {
    const audio = audioRef.current;
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    if (audio) audio.playbackRate = SPEEDS[next];
  };

  // Seek by ratio (0-1) from waveform interaction
  const seekTo = useCallback((ratio: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const clamped = Math.max(0, Math.min(1, ratio));
    if (isFinite(audio.duration)) {
      audio.currentTime = clamped * audio.duration;
    }
    setProgress(clamped * 100);
  }, []);

  const ratioFromEvent = (e: React.MouseEvent | React.TouchEvent) => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    return (clientX - rect.left) / rect.width;
  };

  const onPointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    setDragging(true);
    seekTo(ratioFromEvent(e));
  };
  const onPointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!dragging) return;
    seekTo(ratioFromEvent(e));
  };
  const onPointerUp = (e: React.MouseEvent | React.TouchEvent) => {
    if (!dragging) return;
    seekTo(ratioFromEvent(e));
    setDragging(false);
  };

  const displayed = playing || currentTime > 0 ? currentTime : totalDuration;

  // ── Color tokens per bubble type ────────────────────────────
  const playBg    = isMine ? 'bg-white/25 hover:bg-white/35' : 'bg-primary/25 hover:bg-primary/35';
  const playIcon  = isMine ? 'text-white' : 'text-primary';
  const barPlayed = isMine ? 'bg-white'        : 'bg-primary';
  const barEmpty  = isMine ? 'bg-white/30'     : 'bg-primary/30';
  const dotColor  = isMine ? 'bg-white'        : 'bg-primary';
  const timeColor = isMine ? 'text-white/70'   : 'text-muted-foreground';
  const speedColor= isMine ? 'text-white/80 hover:text-white' : 'text-primary/80 hover:text-primary';

  return (
    <div
      className="flex items-center gap-3 select-none"
      style={{ minWidth: 220, maxWidth: 280 }}
      onMouseLeave={() => { if (dragging) setDragging(false); }}
    >
      <audio ref={audioRef} src={url} preload="metadata" />

      {/* Play / Pause button */}
      <button
        onClick={toggle}
        className={`w-11 h-11 rounded-full ${playBg} flex items-center justify-center flex-shrink-0 transition-colors active:scale-95`}
      >
        {playing
          ? <Pause className={`w-5 h-5 ${playIcon}`} fill="currentColor" />
          : <Play  className={`w-5 h-5 ${playIcon} ml-0.5`} fill="currentColor" />
        }
      </button>

      {/* Waveform + time row */}
      <div className="flex-1 flex flex-col gap-1 min-w-0">

        {/* Waveform track */}
        <div
          ref={trackRef}
          className="relative h-8 flex items-center cursor-pointer"
          onMouseDown={onPointerDown}
          onMouseMove={onPointerMove}
          onMouseUp={onPointerUp}
          onTouchStart={onPointerDown}
          onTouchMove={onPointerMove}
          onTouchEnd={onPointerUp}
        >
          {/* Bars */}
          <div className="absolute inset-0 flex items-center gap-px px-1">
            {bars.map((h, i) => {
              const barProgress = (i / bars.length) * 100;
              const played = barProgress <= progress;
              return (
                <div
                  key={i}
                  className={`flex-1 rounded-full transition-colors ${played ? barPlayed : barEmpty}`}
                  style={{ height: `${h}%`, minWidth: 2 }}
                />
              );
            })}
          </div>

          {/* Scrubber dot */}
          <div
            className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full ${dotColor} shadow-md pointer-events-none transition-[left]`}
            style={{ left: `calc(${progress}% - 6px)` }}
          />
        </div>

        {/* Time + speed */}
        <div className="flex items-center justify-between px-1">
          <span className={`text-[10px] font-mono leading-none ${timeColor}`}>
            {formatTime(displayed)}
          </span>
          <button
            onClick={cycleSpeed}
            className={`text-[10px] font-bold leading-none ${speedColor} transition-colors`}
          >
            {SPEEDS[speedIdx]}×
          </button>
        </div>
      </div>
    </div>
  );
}
