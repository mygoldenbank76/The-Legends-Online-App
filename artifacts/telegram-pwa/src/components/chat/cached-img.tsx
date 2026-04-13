import { useState, useEffect } from 'react';
import { getCachedSrc, isCached, onCached } from '@/lib/media-cache';

interface CachedImgProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
}

/**
 * Drop-in replacement for <img> that serves from an in-memory blob cache.
 * - If the image is already cached: renders instantly (0ms, no network call)
 * - If not yet cached: fetches once, caches, and updates src seamlessly
 */
export function CachedImg({ src, ...props }: CachedImgProps) {
  const [resolvedSrc, setResolvedSrc] = useState<string>(() => getCachedSrc(src));

  useEffect(() => {
    if (!src) return;
    if (isCached(src)) {
      setResolvedSrc(getCachedSrc(src));
      return;
    }
    // Subscribe: when cached, update src (causes instant re-render from objectURL)
    const unsub = onCached(src, (objectUrl) => setResolvedSrc(objectUrl));
    return unsub;
  }, [src]);

  // Keep src updated if prop changes (e.g., conversation switch)
  useEffect(() => {
    setResolvedSrc(getCachedSrc(src));
  }, [src]);

  // eslint-disable-next-line jsx-a11y/alt-text
  return <img src={resolvedSrc} {...props} />;
}
