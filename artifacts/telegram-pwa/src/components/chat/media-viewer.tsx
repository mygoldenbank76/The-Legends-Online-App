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

export function MediaViewer({ urls, startIndex = 0, onClose }: Props) {
  const [idx, setIdx] = useState(startIndex);
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [scale, setScale] = useState(1);
  const [imgOffset, setImgOffset] = useState({ x: 0, y: 0 });
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const pinchStartRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const url = urls[idx] ?? '';
  const isVid = isVideo(url);
  const count = urls.length;

  // Autoplay video when navigating
  useEffect(() => {
    if (isVid && videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
    }
    setScale(1);
    setImgOffset({ x: 0, y: 0 });
  }, [idx, isVid]);

  // Close on Escape
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

  // ── Touch/swipe handling ────────────────────────────────────────────
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Pinch start
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartRef.current = Math.hypot(dx, dy);
      return;
    }
    if (e.touches.length !== 1) return;
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    setIsDragging(false);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchStartRef.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const newScale = Math.max(1, Math.min(4, scale * (dist / pinchStartRef.current)));
      setScale(newScale);
      pinchStartRef.current = dist;
      return;
    }
    if (!touchStartRef.current || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - touchStartRef.current.x;
    const dy = e.touches[0].clientY - touchStartRef.current.y;
    if (!isDragging && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8 && scale === 1) {
      setIsDragging(true);
    }
    if (isDragging && scale === 1) {
      setDragX(dx);
    } else if (scale > 1) {
      setImgOffset(prev => ({ x: prev.x + dx / 8, y: prev.y + dy / 8 }));
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    pinchStartRef.current = null;
    if (!touchStartRef.current) return;
    const dt = Date.now() - touchStartRef.current.t;
    touchStartRef.current = null;

    if (Math.abs(dragX) > 60) {
      goTo(dragX < 0 ? idx + 1 : idx - 1);
    } else if (Math.abs(dragX) < 5 && dt < 250 && scale > 1) {
      // Double-tap to reset zoom
      setScale(1);
      setImgOffset({ x: 0, y: 0 });
    } else {
      setDragX(0);
    }
    setIsDragging(false);
  };

  // Double tap to zoom
  const lastTapRef = useRef<number>(0);
  const handleDoubleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      setScale(s => s > 1 ? 1 : 2.5);
      setImgOffset({ x: 0, y: 0 });
    }
    lastTapRef.current = now;
  };

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
      {/* ── Top bar (overlay flottant) ── */}
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
          <span className="text-white text-sm font-semibold bg-black/50 px-3 py-1 rounded-full" style={{ pointerEvents: 'none' }}>
            {idx + 1} / {count}
          </span>
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
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={idx}
            className="absolute inset-0 flex items-center justify-center"
            initial={{ x: dragX > 0 ? '-30%' : '30%', opacity: 0 }}
            animate={{ x: dragX, opacity: 1 }}
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
              <motion.img
                src={url}
                alt=""
                className="w-full h-full"
                style={{
                  objectFit: 'contain',
                  maxWidth: '100vw',
                  maxHeight: '100dvh',
                  scale,
                  x: imgOffset.x,
                  y: imgOffset.y,
                  transformOrigin: 'center center',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                }}
                draggable={false}
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

      {/* ── Indicateur de page (points) en bas — albums seulement ── */}
      {count > 1 && (
        <div
          className="absolute bottom-0 left-0 right-0 z-20 flex items-center justify-center gap-1.5 pb-safe"
          style={{
            paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 14px)',
            paddingTop: 10,
            background: 'linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 100%)',
            pointerEvents: 'none',
          }}
        >
          {urls.map((_, i) => (
            <div
              key={i}
              className="rounded-full transition-all duration-300"
              style={{
                width: i === idx ? 18 : 6,
                height: 6,
                background: i === idx ? '#fff' : 'rgba(255,255,255,0.4)',
              }}
            />
          ))}
        </div>
      )}
    </motion.div>
  );
}
