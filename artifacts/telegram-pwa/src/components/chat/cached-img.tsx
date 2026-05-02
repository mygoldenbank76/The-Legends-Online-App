import { useState, useEffect } from 'react';
import { getCachedSrc, isCached, onCached } from '@/lib/media-cache';

interface CachedImgProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  /**
   * Tiny base64 LQIP (`data:image/jpeg;base64,…`) painted as a blurred
   * background BEHIND the real image so the user sees a recognisable
   * preview of the actual photo on the very first frame instead of an
   * empty coloured rectangle. Crossfaded out the moment the full image
   * finishes loading. Optional — when absent the component behaves
   * exactly like before.
   */
  placeholder?: string | null;
}

/**
 * Drop-in replacement for <img> with:
 * - In-memory blob cache (0ms if already fetched this session)
 * - loading="lazy" + decoding="async" by default; callers can override
 *   via the standard `loading` / `fetchPriority` props (used for the
 *   most-recent visible bubbles which we want loaded eagerly)
 * - Optional LQIP placeholder painted underneath for instant visible
 *   content even on slow networks
 * - Smooth fade-in when loaded from network / SW cache
 * - Instant display (no transition) when already in memory cache
 */
export function CachedImg({ src, className, style, placeholder, ...props }: CachedImgProps) {
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

  // When we have an LQIP, render it as an absolutely-positioned
  // background <img> so the bubble shape (already reserved by the
  // parent's aspectRatio / width style) is filled with a blurred
  // preview of the actual photo from the very first frame. The real
  // <img> sits on top, opacity 0 until loaded, opacity 1 once decoded
  // — giving a clean crossfade with no visible coloured-rectangle
  // phase even on slow networks.
  if (placeholder) {
    return (
      <span
        className={className}
        style={{
          ...style,
          position: 'relative',
          display: 'block',
          overflow: 'hidden',
        }}
      >
        <img
          src={placeholder}
          alt=""
          aria-hidden="true"
          decoding="sync"
          draggable={false}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            // The blur both hides JPEG artefacts at this microscopic
            // resolution AND visually signals "still loading the sharp
            // version" the way every major messenger does it.
            filter: 'blur(14px)',
            transform: 'scale(1.1)',
            opacity: loaded ? 0 : 1,
            transition: 'opacity 0.18s linear',
            pointerEvents: 'none',
          }}
        />
        <img
          src={resolvedSrc}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          style={{
            position: 'relative',
            display: 'block',
            width: '100%',
            height: '100%',
            objectFit: 'inherit',
            opacity: loaded ? 1 : 0,
            transition: 'opacity 0.18s linear',
          }}
          {...props}
        />
      </span>
    );
  }

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
        // Snappier than a fade — once the image is in (whether from RAM,
        // SW cache or network) it appears in 80 ms instead of 220 ms.
        // Combined with the conversation-list pre-warming this means most
        // photos render with `loaded === true` on the very first frame
        // and skip the transition entirely.
        transition: 'opacity 0.08s linear',
      }}
      {...props}
    />
  );
}

/**
 * Same instant-paint contract as <CachedImg> but optimised for the case
 * where the source is a `data:` or `blob:` URL (cached video posters,
 * locally-captured first frames, attached previews). For these the
 * memory cache is irrelevant — the URL itself IS the data — so we skip
 * the cache lookup, skip the fade-in, and just render the image
 * synchronously. Use this anywhere we already have a fully-decoded
 * dataURL and don't want a flash.
 */
export function InstantImg({ src, className, style, ...props }: CachedImgProps) {
  return (
    <img
      src={src}
      decoding="sync"
      className={className}
      style={style}
      {...props}
    />
  );
}
