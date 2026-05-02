import { useLayoutEffect, useMemo, useRef } from 'react';

const DUST_DURATION_MS = 1200;
const SWEEP_DURATION_MS = 900;

export const DUST_DURATION = DUST_DURATION_MS;

type DustEffectProps = {
  variant?: 'sent' | 'received';
  density?: number;
};

type Particle = {
  x: number;
  y: number;
  size: number;
  hue: number;
  sat: number;
  light: number;
  alpha: number;
  dx: number;
  dy: number;
  rot: number;
  delay: number;
  duration: number;
};

const SENT_HUES = [268, 282, 295, 310, 0, 320];
const RECEIVED_HUES = [220, 230, 240, 250, 260, 210];

export function DustEffect({ variant = 'sent', density = 1 }: DustEffectProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const palette = variant === 'sent' ? SENT_HUES : RECEIVED_HUES;

  useLayoutEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const parent = node.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const w = rect.width;
    const h = rect.height;

    const colCount = Math.min(80, Math.max(18, Math.round(w / 6)));
    const perCol = Math.min(28, Math.max(10, Math.round(h / 5))) * density;

    const arr: Particle[] = [];
    for (let c = 0; c < colCount; c++) {
      const colX = (c / colCount) * w;
      const colXEnd = ((c + 1) / colCount) * w;
      const arrival = (c / colCount) * SWEEP_DURATION_MS;

      for (let i = 0; i < perCol; i++) {
        const x = colX + Math.random() * (colXEnd - colX);
        const y = Math.random() * h;
        const size = 0.8 + Math.random() * 1.6;

        const speed = 25 + Math.random() * 70;
        const angle = Math.PI + (Math.random() - 0.5) * Math.PI * 0.95;
        const dx = Math.cos(angle) * speed;
        const dy = Math.sin(angle) * speed * 1.4 + (Math.random() - 0.5) * 30;

        const useWhite = Math.random() < 0.55;
        const hue = palette[(Math.random() * palette.length) | 0];

        arr.push({
          x,
          y,
          size,
          hue,
          sat: useWhite ? 10 : 70 + Math.random() * 20,
          light: useWhite ? 92 : 65 + Math.random() * 15,
          alpha: 0.55 + Math.random() * 0.45,
          dx,
          dy,
          rot: (Math.random() - 0.5) * 80,
          delay: arrival + Math.random() * 80,
          duration: 380 + Math.random() * 260,
        });
      }
    }

    // Clear any leftover particles from a prior effect run (StrictMode
    // double-invocation in dev, or any future dep change). Without this
    // the spans would accumulate and we'd leak DOM nodes.
    node.textContent = '';

    const frag = document.createDocumentFragment();
    for (const p of arr) {
      const el = document.createElement('span');
      el.className = 'dust-particle';
      el.style.cssText = `
        position:absolute;
        left:${p.x.toFixed(1)}px;
        top:${p.y.toFixed(1)}px;
        width:${p.size.toFixed(2)}px;
        height:${p.size.toFixed(2)}px;
        background:hsla(${p.hue}, ${p.sat}%, ${p.light}%, ${p.alpha.toFixed(2)});
        border-radius:50%;
        pointer-events:none;
        will-change:transform,opacity;
        animation:dust-fly ${p.duration | 0}ms cubic-bezier(.18,.7,.32,1) ${p.delay | 0}ms forwards;
        --dust-dx:${p.dx.toFixed(1)}px;
        --dust-dy:${p.dy.toFixed(1)}px;
        --dust-rot:${p.rot.toFixed(0)}deg;
      `;
      frag.appendChild(el);
    }
    node.appendChild(frag);

    return () => {
      // Wipe particles on unmount / dep change so a re-mount starts
      // from a clean overlay rather than appending on top of stale nodes.
      node.textContent = '';
    };
  }, [palette, density]);

  return (
    <div
      ref={wrapRef}
      className="dust-overlay"
      aria-hidden
      style={{
        position: 'absolute',
        left: '-30%',
        right: '-10%',
        top: '-40%',
        bottom: '-40%',
        pointerEvents: 'none',
        overflow: 'visible',
        zIndex: 5,
      }}
    />
  );
}

type MaybeDustProps = {
  dusting: boolean;
  variant?: 'sent' | 'received';
  children: React.ReactNode;
  className?: string;
};

export function MaybeDust({ dusting, variant = 'sent', children, className }: MaybeDustProps) {
  const cls = useMemo(
    () => `${className ?? ''} ${dusting ? 'dust-fading' : ''}`.trim(),
    [className, dusting],
  );
  return (
    <div className={cls} style={{ position: 'relative' }}>
      {children}
      {dusting && <DustEffect variant={variant} />}
    </div>
  );
}
