import { useLayoutEffect, useMemo, useRef } from 'react';

const DUST_DURATION_MS = 750;

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
  alpha: number;
  dx: number;
  dy: number;
  rot: number;
  delay: number;
  duration: number;
};

const SENT_HUES = [268, 282, 295, 310, 0];
const RECEIVED_HUES = [220, 240, 260, 280, 200];

export function DustEffect({ variant = 'sent', density = 1 }: DustEffectProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const particles = useRef<Particle[]>([]);

  const palette = variant === 'sent' ? SENT_HUES : RECEIVED_HUES;

  useLayoutEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const parent = node.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const area = rect.width * rect.height;
    const target = Math.min(180, Math.max(40, Math.round((area / 900) * density)));
    const arr: Particle[] = [];
    for (let i = 0; i < target; i++) {
      const x = Math.random() * rect.width;
      const y = Math.random() * rect.height;
      const size = 1.5 + Math.random() * 2.5;
      const hue = palette[(Math.random() * palette.length) | 0];
      const dxBase = 30 + Math.random() * 80;
      const dyBase = (Math.random() - 0.55) * 60;
      arr.push({
        x,
        y,
        size,
        hue,
        alpha: 0.6 + Math.random() * 0.4,
        dx: dxBase,
        dy: dyBase,
        rot: (Math.random() - 0.5) * 90,
        delay: (x / rect.width) * 220,
        duration: 480 + Math.random() * 260,
      });
    }
    particles.current = arr;

    const frag = document.createDocumentFragment();
    for (const p of arr) {
      const el = document.createElement('span');
      el.className = 'dust-particle';
      el.style.cssText = `
        position:absolute;
        left:${p.x}px;
        top:${p.y}px;
        width:${p.size}px;
        height:${p.size}px;
        background:hsla(${p.hue}, 80%, 70%, ${p.alpha});
        box-shadow:0 0 ${p.size * 2}px hsla(${p.hue}, 90%, 70%, ${p.alpha * 0.6});
        border-radius:50%;
        pointer-events:none;
        will-change:transform,opacity;
        animation:dust-fly ${p.duration}ms cubic-bezier(.22,.61,.36,1) ${p.delay}ms forwards;
        --dust-dx:${p.dx}px;
        --dust-dy:${p.dy}px;
        --dust-rot:${p.rot}deg;
      `;
      frag.appendChild(el);
    }
    node.appendChild(frag);
  }, [palette, density]);

  return (
    <div
      ref={wrapRef}
      className="dust-overlay"
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
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
