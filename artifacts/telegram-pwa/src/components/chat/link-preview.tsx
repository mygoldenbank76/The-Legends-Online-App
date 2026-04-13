import { useState, useEffect, useRef } from 'react';
import { Play, ExternalLink, Music, Tv, Twitter, Instagram, Github, Radio, Plus, MoreHorizontal } from 'lucide-react';
import { CachedImg } from './cached-img';
import { preloadMedia } from '@/lib/media-cache';
import { mountIframe } from '@/lib/iframe-pool';

export type LinkPreviewData = {
  url: string;
  title?: string | null;
  description?: string | null;
  image?: string | null;
  platform?: string | null;
  embedUrl?: string | null;
  siteName?: string | null;
};

type Props = {
  preview: LinkPreviewData;
  isMine: boolean;
};

const PLATFORM_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode; canEmbed: boolean }> = {
  youtube:      { label: 'YouTube',      color: '#FF0000', icon: <Play size={12} />,        canEmbed: true  },
  spotify:      { label: 'Spotify',      color: '#1DB954', icon: <Music size={12} />,       canEmbed: true  },
  soundcloud:   { label: 'SoundCloud',   color: '#FF5500', icon: <Radio size={12} />,       canEmbed: false },
  netflix:      { label: 'Netflix',      color: '#E50914', icon: <Tv size={12} />,          canEmbed: false },
  twitch:       { label: 'Twitch',       color: '#9146FF', icon: <Tv size={12} />,          canEmbed: false },
  twitter:      { label: 'X / Twitter',  color: '#1D9BF0', icon: <Twitter size={12} />,    canEmbed: false },
  instagram:    { label: 'Instagram',    color: '#E1306C', icon: <Instagram size={12} />,   canEmbed: false },
  tiktok:       { label: 'TikTok',       color: '#010101', icon: <Music size={12} />,       canEmbed: false },
  github:       { label: 'GitHub',       color: '#6e5494', icon: <Github size={12} />,      canEmbed: false },
  'apple-music':{ label: 'Apple Music',  color: '#FA243C', icon: <Music size={12} />,       canEmbed: false },
  deezer:       { label: 'Deezer',       color: '#A238FF', icon: <Music size={12} />,       canEmbed: false },
};

function PlatformBadge({ platform, siteName }: { platform?: string | null; siteName?: string | null }) {
  const cfg = platform ? PLATFORM_CONFIG[platform] : null;
  const label = cfg?.label ?? siteName ?? platform;
  if (!label) return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
      style={{ background: cfg?.color ? `${cfg.color}22` : 'rgba(170,170,170,0.1)', color: cfg?.color ?? '#aaa', border: `1px solid ${cfg?.color ? cfg.color + '44' : '#aaa4'}` }}
    >
      {cfg?.icon}
      {label}
    </span>
  );
}

const SPOTIFY_ATTRS = {
  allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture',
  height: '152',
};

/**
 * Spotify embed using the persistent iframe pool.
 * - First visit: shows rich static card instantly while iframe loads in background.
 * - Every subsequent visit: iframe already loaded → shows instantly with NO loading state.
 */
function SpotifyEmbed({ preview }: { preview: LinkPreviewData; isMine: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [iframeReady, setIframeReady] = useState(false);

  useEffect(() => {
    if (!preview.embedUrl || !containerRef.current) return;
    if (preview.image) preloadMedia(preview.image);

    const cleanup = mountIframe(
      preview.embedUrl,
      containerRef.current,
      SPOTIFY_ATTRS,
      () => setIframeReady(true),
    );
    return cleanup;
  }, [preview.embedUrl, preview.image]);

  return (
    <div className="mt-2 rounded-xl overflow-hidden relative" style={{ background: '#121212' }}>
      {/* ── Static rich card: visible INSTANTLY, hidden once iframe is ready ── */}
      {!iframeReady && (
        <div className="flex items-center gap-3 px-3 py-3">
          {preview.image ? (
            <CachedImg
              src={preview.image}
              alt="album"
              className="rounded flex-shrink-0 object-cover"
              style={{ width: 72, height: 72 }}
            />
          ) : (
            <div className="w-[72px] h-[72px] rounded flex-shrink-0 flex items-center justify-center" style={{ background: '#282828' }}>
              <Music size={24} style={{ color: '#1DB954' }} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            {preview.title && (
              <p className="font-semibold text-white text-sm truncate leading-snug">{preview.title}</p>
            )}
            {preview.description && (
              <p className="text-xs truncate mt-0.5" style={{ color: '#b3b3b3' }}>{preview.description}</p>
            )}
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#2a2a2a', color: '#b3b3b3' }}>Preview</span>
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <Plus size={14} style={{ color: '#b3b3b3' }} />
              <span className="text-xs" style={{ color: '#b3b3b3' }}>Save on Spotify</span>
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <MoreHorizontal size={16} style={{ color: '#b3b3b3' }} />
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: '#1DB954' }}>
                <Play size={14} fill="white" className="text-white ml-0.5" />
              </div>
            </div>
          </div>
          <svg width="24" height="24" viewBox="0 0 168 168" className="absolute top-3 right-3 flex-shrink-0" style={{ fill: '#1DB954' }}>
            <path d="M84 0C37.6 0 0 37.6 0 84s37.6 84 84 84 84-37.6 84-84S130.4 0 84 0zm38.5 121.2c-1.5 2.5-4.8 3.3-7.3 1.8-19.9-12.2-45-14.9-74.5-8.2-2.8.6-5.7-1.1-6.3-3.9-.6-2.8 1.1-5.7 3.9-6.3 32.3-7.4 60-4.2 82.3 9.4 2.6 1.5 3.4 4.7 1.9 7.2zm10.3-22.8c-1.9 3.1-6 4.1-9.1 2.2-22.8-14-57.4-18-84.3-9.8-3.5 1.1-7.2-.9-8.3-4.4-1-3.5.9-7.2 4.4-8.3 30.8-9.4 69-4.8 95 11.2 3.1 1.9 4 6 2.3 9.1zm.9-23.8c-27.4-16.3-72.6-17.8-98.7-9.8-4.2 1.3-8.6-1.1-9.9-5.2-1.3-4.2 1.1-8.6 5.2-9.9 30-9.1 79.9-7.3 111.4 11.4 3.8 2.2 5 7.1 2.7 10.9-2.2 3.7-7.1 5-10.7 2.6z"/>
          </svg>
        </div>
      )}

      {/* ── Iframe slot: managed imperatively by the pool ── */}
      <div
        ref={containerRef}
        style={{ height: iframeReady ? 152 : 0, overflow: 'hidden', transition: 'height 0.25s ease' }}
      />
    </div>
  );
}

function YouTubeEmbed({ preview, isMine }: { preview: LinkPreviewData; isMine: boolean }) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (preview.image) preloadMedia(preview.image);
  }, [preview.image]);

  if (playing && preview.embedUrl) {
    return (
      <div className="mt-2 rounded-xl overflow-hidden" style={{ aspectRatio: '16/9', width: '100%' }}>
        <iframe
          src={preview.embedUrl}
          width="100%"
          height="100%"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          loading="eager"
          style={{ border: 'none', display: 'block' }}
          title={preview.title ?? 'YouTube video'}
        />
      </div>
    );
  }

  return (
    <button
      onClick={() => setPlaying(true)}
      className="mt-2 relative w-full rounded-xl overflow-hidden group block"
      style={{ aspectRatio: '16/9', background: '#000' }}
    >
      {preview.image && (
        <CachedImg
          src={preview.image}
          alt={preview.title ?? 'YouTube thumbnail'}
          className="w-full h-full object-cover transition-opacity group-hover:opacity-80"
        />
      )}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-14 h-14 rounded-full flex items-center justify-center transition-transform group-hover:scale-110"
          style={{ background: 'rgba(255,0,0,0.9)' }}>
          <Play size={24} fill="white" className="text-white ml-1" />
        </div>
      </div>
      <div className="absolute bottom-2 right-2">
        <span className="text-[10px] bg-black/70 text-white px-1.5 py-0.5 rounded font-mono">▶ YouTube</span>
      </div>
    </button>
  );
}

// Generic image using CachedImg — no skeleton flash, instant from cache
function GenericImage({ src, alt }: { src: string; alt: string }) {
  return (
    <CachedImg
      src={src}
      alt={alt}
      loading="eager"
      className="w-full object-cover max-h-40 block"
    />
  );
}

// Stop touch events from bubbling to the message bubble (prevents long-press menu)
const stopTouch = (e: React.TouchEvent | React.MouseEvent) => e.stopPropagation();

export function LinkPreviewCard({ preview, isMine }: Props) {
  const platform = preview.platform ?? null;
  const cfg = platform ? PLATFORM_CONFIG[platform] : null;

  const containerClass = `mt-2 rounded-xl overflow-hidden text-xs
    ${isMine ? 'bg-black/15 border border-white/10' : 'bg-background/60 border border-border'}`;

  const blockProps = {
    onTouchStart: stopTouch,
    onTouchEnd: stopTouch,
    onTouchMove: stopTouch,
    onClick: stopTouch,
  };

  // ── Spotify ──────────────────────────────────────────────────────────
  if (platform === 'spotify' && preview.embedUrl) {
    return (
      <div className={containerClass} {...blockProps}>
        <div className="px-3 pt-2 pb-1">
          <PlatformBadge platform={platform} siteName={preview.siteName} />
          {preview.title && <p className="font-semibold mt-1 truncate text-foreground">{preview.title}</p>}
          {preview.description && <p className="opacity-70 line-clamp-1 mt-0.5">{preview.description}</p>}
        </div>
        <SpotifyEmbed preview={preview} isMine={isMine} />
      </div>
    );
  }

  // ── YouTube ───────────────────────────────────────────────────────────
  if (platform === 'youtube') {
    return (
      <div className={containerClass} {...blockProps}>
        <YouTubeEmbed preview={preview} isMine={isMine} />
        <div className="px-3 py-2 flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <PlatformBadge platform={platform} siteName={preview.siteName} />
            {preview.title && <p className="font-semibold mt-1 text-foreground line-clamp-2">{preview.title}</p>}
            {preview.description && <p className="opacity-70 line-clamp-1 mt-0.5">{preview.description}</p>}
          </div>
          <a href={preview.url} target="_blank" rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground flex-shrink-0 mt-0.5"
            onClick={e => e.stopPropagation()}>
            <ExternalLink size={13} />
          </a>
        </div>
      </div>
    );
  }

  // ── Generic (with image) ──────────────────────────────────────────────
  const hasImage = !!preview.image;
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className={containerClass + ' block hover:opacity-90 transition-opacity'}
      {...blockProps}
    >
      {hasImage && <GenericImage src={preview.image!} alt={preview.title ?? ''} />}
      <div className="px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <PlatformBadge platform={platform} siteName={preview.siteName} />
          <ExternalLink size={12} className="text-muted-foreground flex-shrink-0" />
        </div>
        {preview.title && <p className="font-semibold mt-1.5 text-foreground line-clamp-2">{preview.title}</p>}
        {preview.description && <p className="opacity-70 line-clamp-2 mt-0.5">{preview.description}</p>}
        {!preview.title && !preview.description && (
          <p className="opacity-60 mt-1 truncate">{preview.url}</p>
        )}
      </div>
    </a>
  );
}
