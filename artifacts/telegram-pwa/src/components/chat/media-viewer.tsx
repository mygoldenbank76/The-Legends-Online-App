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
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const imgRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastTouchRef = useRef<{ x: number; y: number } | null>(null);
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null);
  const scaleRef = useRef(1);
  const lastTapRef = useRef(0);

  const url = urls[idx] ?? '';
  const isVid = isVideo(url);
  const count = urls.length;

  useEffect(() => { scaleRef.current = scale; }, [scale]);

  // Reset state on slide change
  useEffect(() => {
    setScale(1); scaleRef.current = 1;
    setOffset({ x: 0, y: 0 });
    setDragX(0); setIsDragging(false);
    if (isVid && videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
    }
  }, [idx, isVid]);

  // Escape key
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const goTo = useCallback((next: number) => {
    setIdx(Math.max(0, Math.min(count - 1, next)));
  }, [count]);

  /** Clamp pan offset using actual rendered image dimensions */
  const clamp = useCallback((x: number, y: number, s: number) => {
    const img = imgRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const iw = img ? img.offsetWidth : vw;
    const ih = img ? img.offsetHeight : vh;
    const maxX = Math.max(0, (iw * s - vw) / 2);
    const maxY = Math.max(0, (ih * s - vh) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  }, []);

  // ── Touch handlers ───────────────────────────────────────────────────
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = { dist: Math.hypot(dx, dy), scale: scaleRef.current };
      touchStartRef.current = null; lastTouchRef.current = null;
      return;
    }
    pinchRef.current = null;
    const x = e.touches[0].clientX, y = e.touches[0].clientY;
    touchStartRef.current = { x, y, t: Date.now() };
    lastTouchRef.current = { x, y };
    setIsDragging(false);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const newScale = Math.max(1, Math.min(5, pinchRef.current.scale * (dist / pinchRef.current.dist)));
      scaleRef.current = newScale;
      setScale(newScale);
      setOffset(prev => clamp(prev.x, prev.y, newScale));
      return;
    }
    if (!lastTouchRef.current || e.touches.length !== 1) return;

    const cx = e.touches[0].clientX, cy = e.touches[0].clientY;
    const dx = cx - lastTouchRef.current.x;
    const dy = cy - lastTouchRef.current.y;
    lastTouchRef.current = { x: cx, y: cy };

    if (scaleRef.current > 1) {
      e.preventDefault();
      setOffset(prev => clamp(prev.x + dx, prev.y + dy, scaleRef.current));
    } else {
      if (!touchStartRef.current) return;
      const totalDX = cx - touchStartRef.current.x;
      const totalDY = cy - touchStartRef.current.y;
      if (!isDragging && Math.abs(totalDX) > Math.abs(totalDY) && Math.abs(totalDX) > 8) {
        setIsDragging(true);
      }
      if (isDragging) setDragX(totalDX);
    }
  };

  const onTouchEnd = () => {
    pinchRef.current = null; lastTouchRef.current = null;
    setScale(prev => {
      if (prev < 1.05) { scaleRef.current = 1; setOffset({ x: 0, y: 0 }); return 1; }
      return prev;
    });
    if (!touchStartRef.current) { setDragX(0); setIsDragging(false); return; }
    touchStartRef.current = null;
    if (scaleRef.current <= 1 && Math.abs(dragX) > 60) {
      goTo(dragX < 0 ? idx + 1 : idx - 1);
    } else {
      setDragX(0);
    }
    setIsDragging(false);
  };

  // Double-tap zoom toggle
  const onTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      if (scaleRef.current > 1) {
        setScale(1); scaleRef.current = 1; setOffset({ x: 0, y: 0 });
      } else {
        setScale(2.5); scaleRef.current = 2.5; setOffset({ x: 0, y: 0 });
      }
    }
    lastTapRef.current = now;
  }, []);

  const download = () => {
    const a = document.createElement('a');
    a.href = url; a.download = url.split('/').pop() || 'media'; a.target = '_blank'; a.click();
  };

  return (
    <motion.div
      className="fixed inset-0 z-[600] bg-black select-none"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      {/* Top bar */}
      <div
        className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-3"
        style={{
          paddingTop: 'max(env(safe-area-inset-top, 0px), 12px)',
          paddingBottom: 12,
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%)',
          pointerEvents: 'none',
        }}
      >
        <button onClick={onClose}
          className="w-10 h-10 flex items-center justify-center rounded-full glass hover:bg-white/15 active:scale-95 transition-all"
          style={{ pointerEvents: 'auto' }}>
          <X className="w-5 h-5 text-white" />
        </button>

        {count > 1 ? (
          <div className="flex items-center gap-1.5">
            {urls.map((_, i) => (
              <div key={i} className="rounded-full transition-all duration-300"
                style={{ width: i === idx ? 18 : 6, height: 6,
                  background: i === idx ? '#fff' : 'rgba(255,255,255,0.45)' }} />
            ))}
          </div>
        ) : <span />}

        <button onClick={download}
          className="w-10 h-10 flex items-center justify-center rounded-full glass hover:bg-white/15 active:scale-95 transition-all"
          style={{ pointerEvents: 'auto' }}>
          <Download className="w-4 h-4 text-white" />
        </button>
      </div>

      {/* Media area */}
      <div
        className="absolute inset-0 overflow-hidden"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={onTap}
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
              <>
                {/* Blurred background fill — eliminates black bars, no distortion */}
                <video
                  src={url}
                  muted playsInline
                  aria-hidden
                  preload="metadata"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    filter: 'blur(24px) brightness(0.45) saturate(1.4)',
                    transform: 'scale(1.08)',
                    pointerEvents: 'none',
                  }}
                />
                {/* Main video — fills the viewport, centered, respects aspect ratio */}
                <video
                  ref={videoRef}
                  src={url}
                  controls playsInline autoPlay
                  onClick={e => e.stopPropagation()}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    display: 'block',
                    background: 'transparent',
                  }}
                />
              </>
            ) : (
              <>
                {/* Blurred background fill — eliminates black bars, no distortion */}
                <img
                  src={url}
                  alt=""
                  aria-hidden
                  draggable={false}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    filter: 'blur(24px) brightness(0.45) saturate(1.4)',
                    transform: 'scale(1.08)',
                    pointerEvents: 'none',
                    userSelect: 'none',
                  }}
                />
                {/* Main image — fills full viewport, always contain (no distortion) */}
                <img
                  ref={imgRef}
                  src={url}
                  alt=""
                  draggable={false}
                  style={{
                    position: 'relative',
                    width: '100vw',
                    height: '100vh',
                    objectFit: 'contain',
                    display: 'block',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    willChange: 'transform',
                    transform: `scale(${scale}) translate(${offset.x / scale}px, ${offset.y / scale}px)`,
                    transformOrigin: 'center center',
                    transition: isDragging || !!pinchRef.current ? 'none' : 'transform 0.12s ease-out',
                  }}
                />
              </>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Desktop navigation arrows */}
        {count > 1 && idx > 0 && (
          <button onClick={(e) => { e.stopPropagation(); goTo(idx - 1); }}
            className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full glass flex items-center justify-center hover:bg-white/15 active:scale-95 transition-all z-10 hidden sm:flex">
            <ChevronLeft className="w-6 h-6 text-white" />
          </button>
        )}
        {count > 1 && idx < count - 1 && (
          <button onClick={(e) => { e.stopPropagation(); goTo(idx + 1); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full glass flex items-center justify-center hover:bg-white/15 active:scale-95 transition-all z-10 hidden sm:flex">
            <ChevronRight className="w-6 h-6 text-white" />
          </button>
        )}
      </div>
    </motion.div>
  );
}
