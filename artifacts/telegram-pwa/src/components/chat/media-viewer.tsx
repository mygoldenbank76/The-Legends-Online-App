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
  // naturalRatio = naturalWidth / naturalHeight, known after image loads
  const [naturalRatio, setNaturalRatio] = useState<number | null>(null);

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

  const screenRatio = window.innerWidth / window.innerHeight; // e.g. 0.46 on tall phone

  /**
   * Fill strategy — mirrors Telegram's behaviour:
   * • Portrait images (close to screen ratio) → fill by HEIGHT, no top/bottom bars,
   *   slight side clip (user can pan). Threshold: image ratio ≤ 1.7× screen ratio.
   * • Landscape / very wide images → fill by WIDTH, small top/bottom bars,
   *   no side clip.
   */
  const fillByHeight = naturalRatio !== null && naturalRatio <= screenRatio * 1.7;

  /**
   * Is the image wider than the screen at scale 1?
   * This happens for portrait images where height-fill makes width > screenWidth.
   * In this case horizontal swipe pans instead of navigating.
   */
  const isHClipped = fillByHeight && naturalRatio !== null && naturalRatio > screenRatio;

  useEffect(() => { scaleRef.current = scale; }, [scale]);

  // Reset state on slide change
  useEffect(() => {
    setNaturalRatio(null);
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

  /**
   * Clamp offset so the image never exposes empty background.
   * Uses actual rendered img dimensions (offsetWidth/offsetHeight at scale=1).
   */
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
    // Pinch zoom
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

    const s = scaleRef.current;
    const canPanH = s > 1 || isHClipped; // pan horizontally if zoomed or image wider than screen

    if (s > 1 || isHClipped) {
      // Pan mode
      e.preventDefault();
      setOffset(prev => clamp(prev.x + dx, prev.y + dy, s));
    } else {
      // Swipe-to-navigate mode (only when image fits in screen at scale 1)
      if (!touchStartRef.current) return;
      const totalDX = cx - touchStartRef.current.x;
      const totalDY = cy - touchStartRef.current.y;
      if (!isDragging && Math.abs(totalDX) > Math.abs(totalDY) && Math.abs(totalDX) > 8) {
        setIsDragging(true);
      }
      if (isDragging) setDragX(totalDX);
    }
    void canPanH;
  };

  const onTouchEnd = () => {
    pinchRef.current = null; lastTouchRef.current = null;

    // Snap to 1 if barely zoomed
    setScale(prev => {
      if (prev < 1.05) { scaleRef.current = 1; setOffset({ x: 0, y: 0 }); return 1; }
      return prev;
    });

    if (!touchStartRef.current) { setDragX(0); setIsDragging(false); return; }
    touchStartRef.current = null;

    if (!isHClipped && scaleRef.current <= 1 && Math.abs(dragX) > 60) {
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

  // Image CSS — the key to margin-free portrait display
  const imgCss: React.CSSProperties = fillByHeight
    ? {
        // Fill screen height → no top/bottom margins, slight side clip
        height: '100vh',
        width: 'auto',
        display: 'block',
      }
    : {
        // Contain wide images → no left/right margins, small top/bottom bars
        width: '100vw',
        height: 'auto',
        maxHeight: '100vh',
        display: 'block',
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
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.65) 0%, transparent 100%)',
          pointerEvents: 'none',
        }}
      >
        <button onClick={onClose}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 transition-colors"
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
          className="w-10 h-10 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 transition-colors"
          style={{ pointerEvents: 'auto' }}>
          <Download className="w-4 h-4 text-white" />
        </button>
      </div>

      {/* Media area */}
      <div
        className="absolute inset-0 flex items-center justify-center overflow-hidden"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={onTap}
        style={{ touchAction: (scale > 1 || isHClipped) ? 'none' : 'pan-y' }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={idx}
            className="absolute inset-0 flex items-center justify-center"
            initial={{ x: dragX > 0 ? '-30%' : '30%', opacity: 0 }}
            animate={{ x: (!isHClipped && scale === 1) ? dragX : 0, opacity: 1 }}
            exit={{ x: dragX > 0 ? '30%' : '-30%', opacity: 0 }}
            transition={isDragging ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 35 }}
          >
            {isVid ? (
              <video
                ref={videoRef}
                src={url}
                controls playsInline autoPlay
                onClick={e => e.stopPropagation()}
                style={{
                  width: '100vw', height: '100vh',
                  objectFit: 'contain', display: 'block',
                }}
              />
            ) : (
              <img
                ref={imgRef}
                src={url}
                alt=""
                draggable={false}
                onLoad={e => {
                  const img = e.currentTarget;
                  if (img.naturalWidth && img.naturalHeight) {
                    setNaturalRatio(img.naturalWidth / img.naturalHeight);
                  }
                }}
                style={{
                  ...imgCss,
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                  willChange: 'transform',
                  transform: `scale(${scale}) translate(${offset.x / scale}px, ${offset.y / scale}px)`,
                  transformOrigin: 'center center',
                  transition: isDragging || !!pinchRef.current ? 'none' : 'transform 0.12s ease-out',
                }}
              />
            )}
          </motion.div>
        </AnimatePresence>

        {/* Desktop arrows */}
        {count > 1 && idx > 0 && (
          <button onClick={(e) => { e.stopPropagation(); goTo(idx - 1); }}
            className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70 transition-colors z-10 hidden sm:flex">
            <ChevronLeft className="w-6 h-6 text-white" />
          </button>
        )}
        {count > 1 && idx < count - 1 && (
          <button onClick={(e) => { e.stopPropagation(); goTo(idx + 1); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70 transition-colors z-10 hidden sm:flex">
            <ChevronRight className="w-6 h-6 text-white" />
          </button>
        )}
      </div>
    </motion.div>
  );
}
