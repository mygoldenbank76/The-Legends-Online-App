import { useState, useRef, useEffect } from 'react';
import { Play, Pause, Volume2 } from 'lucide-react';

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

export function AudioPlayer({ url, duration, isMine }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(duration ?? 0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      setProgress(audio.duration ? (audio.currentTime / audio.duration) * 100 : 0);
    };
    const onDurationChange = () => {
      if (isFinite(audio.duration)) setTotalDuration(audio.duration);
    };
    const onEnded = () => { setPlaying(false); setCurrentTime(0); setProgress(0); };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
  }, []);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      try { await audio.play(); } catch (e) { console.error(e); }
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    audio.currentTime = ratio * audio.duration;
  };

  const displayed = playing ? currentTime : (currentTime > 0 ? currentTime : totalDuration);

  const buttonBg = isMine ? 'bg-white/20 hover:bg-white/30' : 'bg-primary/20 hover:bg-primary/30';
  const iconColor = isMine ? 'text-primary-foreground' : 'text-primary';
  const trackBg = isMine ? 'bg-white/20' : 'bg-muted';
  const fillBg = isMine ? 'bg-white/70' : 'bg-primary';
  const timeColor = isMine ? 'text-primary-foreground/70' : 'text-muted-foreground';

  return (
    <div className="flex items-center gap-2.5 min-w-[200px] max-w-[260px] py-0.5">
      <audio ref={audioRef} src={url} preload="metadata" />

      {/* Play/Pause button */}
      <button
        onClick={toggle}
        className={`w-9 h-9 rounded-full ${buttonBg} flex items-center justify-center flex-shrink-0 transition-colors`}
      >
        {playing
          ? <Pause className={`w-4 h-4 ${iconColor}`} />
          : <Play className={`w-4 h-4 ${iconColor} ml-0.5`} />
        }
      </button>

      <div className="flex-1 min-w-0">
        {/* Waveform / progress bar */}
        <div
          className={`h-1.5 rounded-full ${trackBg} cursor-pointer relative overflow-hidden`}
          onClick={handleSeek}
        >
          <div
            className={`absolute left-0 top-0 bottom-0 rounded-full ${fillBg} transition-all`}
            style={{ width: `${progress}%` }}
          />
          {/* Fake waveform dots */}
          <div className="absolute inset-0 flex items-center justify-evenly pointer-events-none">
            {Array.from({ length: 24 }).map((_, i) => (
              <div
                key={i}
                className={`w-0.5 rounded-full ${isMine ? 'bg-white/30' : 'bg-primary/30'}`}
                style={{ height: `${30 + Math.sin(i * 0.8) * 60}%` }}
              />
            ))}
          </div>
        </div>
        <div className={`text-[10px] mt-0.5 ${timeColor}`}>
          {formatTime(displayed)}
        </div>
      </div>

      <Volume2 className={`w-3.5 h-3.5 flex-shrink-0 ${timeColor}`} />
    </div>
  );
}
