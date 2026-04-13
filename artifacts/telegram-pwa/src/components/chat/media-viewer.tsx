import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight, Download } from 'lucide-react';

interface Props {
  urls: string[];
  startIndex?: number;
  onClose: () => void;
}

function isVideo(url: string) {
  return /\.(mp4|webm|mov|avi|mkv)$/i.test(url);
}

/** Clamp offset so the zoomed image never exposes empty space */
function clampOffset(x: number, y: number, scale: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // When zoomed by `scale`, the extra pixels available for panning are:
  const maxX = Math.max(0, (vw * scale - vw) / 2);
  const maxY = Math.max(0, (vh * scale - vh) / 2);
  return {
    x: Math.max(-maxX, Math.min(maxX, x)),
    y: Math.max(-maxY, Math.min(maxY, y)),
  };
}

export function MediaViewer({ urls, startIndex = 0, onClose }: Props) {
  const [idx, setIdx] = useState(startIndex);
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [scale, setScale] = useState(1);
  const [imgOffset, setImgOffset] = useState({ x: 0, y: 0 });

  // Refs for touch tracking
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  // Last position during pan (used to compute per-frame delta)
  const lastTouchRef = useRef<{ x: number; y: number } | null>(null);
  const pinchStartRef = useRef<{ dist: number; scale: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastTapRef = useRef<number>(0);

  // Current scale ref (to avoid stale closure in touch handlers)
  const scaleRef = useRef(scale);
  const offsetRef = useRef(imgOffset);
  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { offsetRef.current = imgOffset; }, [imgOffset]);

  const url = urls[idx] ?? '';
  const isVid = isVideo(url);
  const count = urls.length;

  // Reset state on navigation
  useEffect(() => {
    if (isVid && videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
    }
    setScale(1);
    setImgOffset({ x: 0, y: 0 });
    setDragX(0);
    setIsDragging(false);
  }, [idx, isVid]);

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const goTo = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(count - 1, next));
    setIdx(clamped);
    setDragX(0);
  }, [count]);

  // ── Touch handling ──────────────────────────────────────────────────
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Pinch-to-zoom start: capture initial distance AND current scale
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartRef.current = { dist: Math.hypot(dx, dy), scale: scaleRef.current };
      touchStartRef.current = null;
      lastTouchRef.current = null;
      return;
    }
    if (e.touches.length !== 1) return;
    pinchStartRef.current = null;
    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    touchStartRef.current = { x, y, t: Date.now() };
    lastTouchRef.current = { x, y };
    setIsDragging(false);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    // ── Pinch zoom ──
    if (e.touches.length === 2 && pinchStartRef.current !== null) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const rawScale = pinchStartRef.current.scale * (dist / pinchStartRef.current.dist);
      const newScale = Math.max(1, Math.min(5, rawScale));
      setScale(newScale);
      scaleRef.current = newScale;
      // Clamp offset to new scale
      setImgOffset(prev => clampOffset(prev.x, prev.y, newScale));
      return;
    }

    if (!lastTouchRef.current || e.touches.length !== 1) return;

    const curX = e.touches[0].clientX;
    const curY = e.touches[0].clientY;

    // Per-frame delta (not cumulative from start)
    const deltaX = curX - lastTouchRef.current.x;
    const deltaY = curY - lastTouchRef.current.y;
    lastTouchRef.current = { x: curX, y: curY };

    const currentScale = scaleRef.current;

    if (currentScale > 1) {
      // ── Pan mode: move image within clamped bounds ──
      e.preventDefault();
      setImgOffset(prev => {
        const raw = { x: prev.x + deltaX, y: prev.y + deltaY };
        return clampOffset(raw.x, raw.y, currentScale);
      });
    } else {
      // ── Swipe mode: horizontal swipe to navigate ──
      if (!touchStartRef.current) return;
      const totalDX = curX - touchStartRef.current.x;
      const totalDY = curY - touchStartRef.current.y;
      if (!isDragging && Math.abs(totalDX) > Math.abs(totalDY) && Math.abs(totalDX) > 8) {
        setIsDragging(true);
      }
      if (isDragging) {
        setDragX(totalDX);
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    pinchStartRef.current = null;
    lastTouchRef.current = null;

    // Snap scale to 1 if very close
    setScale(prev => {
      const snapped = prev < 1.05 ? 1 : prev;
      if (snapped === 1) setImgOffset({ x: 0, y: 0 });
      return snapped;
    });

    if (!touchStartRef.current) return;
    const dt = Date.now() - touchStartRef.current.t;
    touchStartRef.current = null;

    if (scaleRef.current <= 1 && Math.abs(dragX) > 60) {
      goTo(dragX < 0 ? idx + 1 : idx - 1);
    } else {
      setDragX(0);
    }
    setIsDragging(false);
  };

  // Double-tap to zoom / reset
  const handleDoubleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      if (scaleRef.current > 1) {
        setScale(1);
        setImgOffset({ x: 0, y: 0 });
      } else {
        setScale(2.5);
        setImgOffset({ x: 0, y: 0 });
      }
    }
    lastTapRef.current = now;
  }, []);

  const downloadUrl = () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = url.split('/').pop() || 'media';
    a.target = '_blank';
    a.click();
  };

  return (
    <motion.div
      className="fixed inset-0 z-[600] bg-black select-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      {/* ── Top bar ── */}
      <div
        className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-3"
        style={{
          paddingTop: 'max(env(safe-area-inset-top, 0px), 12px)',
          paddingBottom: 12,
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.65) 0%, transparent 100%)',
          pointerEvents: 'none',
        }}
      >
        <button
          onClick={onClose}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 transition-colors"
          style={{ pointerEvents: 'auto' }}
        >
          <X className="w-5 h-5 text-white" />
        </button>

        {count > 1 ? (
          <div className="flex items-center gap-1.5" style={{ pointerEvents: 'none' }}>
            {urls.map((_, i) => (
              <div
                key={i}
                className="rounded-full transition-all duration-300"
                style={{
                  width: i === idx ? 18 : 6,
                  height: 6,
                  background: i === idx ? '#fff' : 'rgba(255,255,255,0.45)',
                }}
              />
            ))}
          </div>
        ) : <span />}

        <button
          onClick={downloadUrl}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 transition-colors"
          style={{ pointerEvents: 'auto' }}
        >
          <Download className="w-4 h-4 text-white" />
        </button>
      </div>

      {/* ── Full-screen media area ── */}
      <div
        className="absolute inset-0 flex items-center justify-center overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleDoubleTap}
        style={{ touchAction: scale > 1 ? 'none' : 'pan-y' }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={idx}
            className="absolute inset-0 flex items-center justify-center"
            initial={{ x: dragX > 0 ? '-30%' : '30%', opacity: 0 }}
            animate={{ x: scale === 1 ? dragX : 0, opacity: 1 }}
            exit={{ x: dragX > 0 ? '30%' : '-30%', opacity: 0 }}
            transition={isDragging ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 35 }}
          >
            {isVid ? (
              <video
                ref={videoRef}
                src={url}
                controls
                playsInline
                autoPlay
                className="w-full h-full"
                style={{ objectFit: 'contain', maxWidth: '100vw', maxHeight: '100dvh' }}
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <img
                src={url}
                alt=""
                draggable={false}
                style={{
                  objectFit: 'contain',
                  maxWidth: '100vw',
                  maxHeight: '100dvh',
                  width: '100%',
                  height: '100%',
                  transform: `scale(${scale}) translate(${imgOffset.x / scale}px, ${imgOffset.y / scale}px)`,
                  transformOrigin: 'center center',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                  willChange: 'transform',
                  transition: isDragging || pinchStartRef.current ? 'none' : 'transform 0.15s ease-out',
                }}
              />
            )}
          </motion.div>
        </AnimatePresence>

        {/* Desktop nav arrows */}
        {count > 1 && idx > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); goTo(idx - 1); }}
            className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70 transition-colors z-10 hidden sm:flex"
          >
            <ChevronLeft className="w-6 h-6 text-white" />
          </button>
        )}
        {count > 1 && idx < count - 1 && (
          <button
            onClick={(e) => { e.stopPropagation(); goTo(idx + 1); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70 transition-colors z-10 hidden sm:flex"
          >
            <ChevronRight className="w-6 h-6 text-white" />
          </button>
        )}
      </div>
    </motion.div>
  );
}
