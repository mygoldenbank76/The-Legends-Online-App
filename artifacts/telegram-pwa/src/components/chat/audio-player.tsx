import { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Volume2 } from 'lucide-react';

type Props = {
  url: string;
  duration?: number | null;
  isMine: boolean;
  senderAvatar?: string | null;
  senderInitials?: string;
};

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Deterministic waveform from URL seed
function generateBars(seed: string, count: number): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  return Array.from({ length: count }, (_, i) => {
    h = (Math.imul(1664525, h) + 1013904223) | 0;
    const base = ((h >>> 0) % 55) + 20;
    const env = 0.6 + 0.4 * Math.sin((i / count) * Math.PI);
    return Math.min(100, Math.round(base * env));
  });
}

const SPEEDS = [1, 1.5, 2];

export function AudioPlayer({ url, duration, isMine, senderAvatar, senderInitials }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(duration ?? 0);
  const [progress, setProgress] = useState(0);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [dragging, setDragging] = useState(false);

  const bars = generateBars(url, 40);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      if (!dragging) {
        setCurrentTime(audio.currentTime);
        setProgress(audio.duration ? (audio.currentTime / audio.duration) * 100 : 0);
      }
    };
    const onDur = () => { if (isFinite(audio.duration)) setTotalDuration(audio.duration); };
    const onEnd = () => { setPlaying(false); setCurrentTime(0); setProgress(0); };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('durationchange', onDur);
    audio.addEventListener('ended', onEnd);
    audio.addEventListener('play', () => setPlaying(true));
    audio.addEventListener('pause', () => setPlaying(false));
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('durationchange', onDur);
      audio.removeEventListener('ended', onEnd);
    };
  }, [dragging]);

  const toggle = async () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); } else { try { await a.play(); } catch (e) { console.error(e); } }
  };

  const cycleSpeed = () => {
    const a = audioRef.current;
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    if (a) a.playbackRate = SPEEDS[next];
  };

  const ratioFrom = (e: React.MouseEvent | React.TouchEvent) => {
    const t = trackRef.current;
    if (!t) return 0;
    const rect = t.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0]?.clientX ?? 0 : (e as React.MouseEvent).clientX;
    return Math.max(0, Math.min(1, (x - rect.left) / rect.width));
  };

  const seekTo = useCallback((ratio: number) => {
    const a = audioRef.current;
    if (!a) return;
    if (isFinite(a.duration)) a.currentTime = ratio * a.duration;
    setProgress(ratio * 100);
  }, []);

  const onDown = (e: React.MouseEvent | React.TouchEvent) => { setDragging(true); seekTo(ratioFrom(e)); };
  const onMove = (e: React.MouseEvent | React.TouchEvent) => { if (dragging) seekTo(ratioFrom(e)); };
  const onUp   = (e: React.MouseEvent | React.TouchEvent) => { if (dragging) { seekTo(ratioFrom(e)); setDragging(false); } };

  const displayed = playing || currentTime > 0 ? currentTime : totalDuration;

  // Color tokens
  const playBg    = isMine ? 'bg-white/30 hover:bg-white/40' : 'bg-primary/20 hover:bg-primary/30';
  const playColor = isMine ? 'text-white'    : 'text-primary';
  const barPlayed = isMine ? 'bg-white'      : 'bg-primary';
  const barEmpty  = isMine ? 'bg-white/35'   : 'bg-primary/25';
  const dotColor  = isMine ? 'bg-white'      : 'bg-primary';
  const timeColor = isMine ? 'text-white/65' : 'text-muted-foreground';
  const speedColor= isMine ? 'text-white/75 hover:text-white' : 'text-primary/70 hover:text-primary';

  return (
    <div
      className="flex items-center gap-2.5 py-0.5"
      style={{ minWidth: 220, maxWidth: 270 }}
      onMouseLeave={() => setDragging(false)}
    >
      <audio ref={audioRef} src={url} preload="metadata" />

      {/* Play / Pause */}
      <button
        onClick={toggle}
        className={`w-10 h-10 rounded-full ${playBg} flex items-center justify-center flex-shrink-0 transition-all active:scale-90`}
      >
        {playing
          ? <Pause className={`w-[18px] h-[18px] ${playColor}`} fill="currentColor" />
          : <Play  className={`w-[18px] h-[18px] ${playColor} ml-0.5`} fill="currentColor" />
        }
      </button>

      {/* Waveform + metadata */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">

        {/* Waveform */}
        <div
          ref={trackRef}
          className="relative h-9 flex items-center cursor-pointer touch-none"
          onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}
          onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
        >
          <div className="absolute inset-x-0 inset-y-1 flex items-end gap-[1.5px]">
            {bars.map((h, i) => {
              const pct = (i / bars.length) * 100;
              return (
                <div
                  key={i}
                  className={`flex-1 rounded-full transition-colors duration-100 ${pct <= progress ? barPlayed : barEmpty}`}
                  style={{ height: `${h}%`, minWidth: 2 }}
                />
              );
            })}
          </div>
          {/* Scrubber dot */}
          <div
            className={`absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full shadow ${dotColor} pointer-events-none`}
            style={{ left: `calc(${Math.min(progress, 97)}% - 5px)` }}
          />
        </div>

        {/* Time + speed */}
        <div className="flex items-center justify-between px-0.5">
          <span className={`text-[10px] font-mono tabular-nums leading-none ${timeColor}`}>
            {formatTime(displayed)}
          </span>
          <div className="flex items-center gap-1.5">
            <button onClick={cycleSpeed} className={`text-[10px] font-bold leading-none ${speedColor} transition-colors`}>
              {SPEEDS[speedIdx]}×
            </button>
            <Volume2 className={`w-3 h-3 ${timeColor}`} />
          </div>
        </div>
      </div>
    </div>
  );
}
