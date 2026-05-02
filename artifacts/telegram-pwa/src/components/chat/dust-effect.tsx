import { useMemo } from 'react';

import turbulenceUrl from '../../assets/spoilers/turbulence_2x.png';

const DUST_DURATION_MS = 1100;

export const DUST_DURATION = DUST_DURATION_MS;

type DustEffectProps = {
  variant?: 'sent' | 'received';
};

export function DustEffect({ variant = 'sent' }: DustEffectProps) {
  return (
    <div
      className="dust-overlay"
      aria-hidden
      data-variant={variant}
      style={{ ['--dust-tex' as string]: `url(${turbulenceUrl})` }}
    >
      <div className="dust-layer dust-layer-1" />
      <div className="dust-layer dust-layer-2" />
      <div className="dust-layer dust-layer-3" />
    </div>
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
      {dusting && <DustEffect variant={variant} />}
      {children}
    </div>
  );
}
