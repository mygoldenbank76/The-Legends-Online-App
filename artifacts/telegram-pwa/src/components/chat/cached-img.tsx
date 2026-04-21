import { useState, useEffect } from 'react';
import { getCachedSrc, isCached, onCached } from '@/lib/media-cache';

interface CachedImgProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
}

/**
 * Drop-in replacement for <img> with:
 * - In-memory blob cache (0ms if already fetched this session)
 * - loading="lazy" + decoding="async" (browser-level performance)
 * - Smooth fade-in when loaded from network / SW cache
 * - Instant display (no transition) when already in memory cache
 */
export function CachedImg({ src, className, style, ...props }: CachedImgProps) {
  const [resolvedSrc, setResolvedSrc] = useState<string>(() => getCachedSrc(src));
  const [loaded, setLoaded] = useState(() => isCached(src));

  useEffect(() => {
    if (!src) return;

    // Immediately update to current cache state
    setResolvedSrc(getCachedSrc(src));

    if (isCached(src)) {
      setLoaded(true);
      return;
    }

    // Not in memory yet — will fade in when loaded
    setLoaded(false);

    // Subscribe: when the memory cache gets populated, update src + mark loaded
    const unsub = onCached(src, (objectUrl) => {
      setResolvedSrc(objectUrl);
      setLoaded(true);
    });
    return unsub;
  }, [src]);

  return (
    <img
      src={resolvedSrc}
      loading="lazy"
      decoding="async"
      onLoad={() => setLoaded(true)}
      className={className}
      style={{
        ...style,
        opacity: loaded ? 1 : 0,
        transition: 'opacity 0.22s ease',
      }}
      {...props}
    />
  );
}
