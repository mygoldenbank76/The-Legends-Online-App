import { X } from 'lucide-react';

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

type Props = {
  loaded: number;
  total: number;
  onCancel: () => void;
};

export function UploadProgressOverlay({ loaded, total, onCancel }: Props) {
  const progress = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  // Always show a small visible arc (>= 12%) so the spinning ring is never
  // invisible at 0% — Telegram does the same so the spinner is immediately
  // perceived as "loading" before any bytes are confirmed by the server.
  const visibleProgress = Math.max(progress, 12);
  const dashOffset = circumference - (visibleProgress / 100) * circumference;

  return (
    <>
      {/* Dim overlay covering the media */}
      <div className="absolute inset-0 bg-black/45 flex items-center justify-center pointer-events-none">
        {/* Cancel button with circular progress ring */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
          className="relative w-14 h-14 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center pointer-events-auto active:scale-95 transition-transform"
          aria-label="Annuler l'envoi"
        >
          {/* Static track circle */}
          <svg
            className="absolute inset-0"
            width="56"
            height="56"
            viewBox="0 0 56 56"
            aria-hidden
          >
            <circle
              cx="28"
              cy="28"
              r={radius}
              stroke="rgba(255,255,255,0.22)"
              strokeWidth="2"
              fill="none"
            />
          </svg>

          {/* Progress arc — continuously rotates while filling
              (Telegram-style). The wrapper div spins independently of
              React updates so the rotation stays perfectly fluid even
              as the dashoffset jumps each time progress events fire.
              Removing the CSS transition on stroke-dashoffset is what
              fixes the "stutter" the user reported: with a transition,
              the browser would re-sync the arc growth on every progress
              event, which made the rotation appear to pause. */}
          <div
            className="absolute inset-0 animate-spin will-change-transform"
            style={{ animationDuration: '1.4s' }}
          >
            <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden>
              <circle
                cx="28"
                cy="28"
                r={radius}
                stroke="white"
                strokeWidth="2.5"
                fill="none"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
              />
            </svg>
          </div>

          {/* X icon stays still in the center while the ring spins */}
          <X className="w-5 h-5 text-white relative" strokeWidth={2.5} />
        </button>
      </div>

      {/* Bytes counter top-left */}
      <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/65 backdrop-blur-sm text-white text-[11px] font-medium tabular-nums pointer-events-none">
        {formatBytes(loaded)} / {formatBytes(total)}
      </div>
    </>
  );
}
