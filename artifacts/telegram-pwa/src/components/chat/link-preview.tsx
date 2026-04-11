import { useState } from 'react';
import { Play, ExternalLink, Music, Tv, Twitter, Instagram, Github, Radio } from 'lucide-react';

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

function SpotifyEmbed({ embedUrl, isMine }: { embedUrl: string; isMine: boolean }) {
  return (
    <div className="mt-2 rounded-xl overflow-hidden" style={{ height: 152 }}>
      <iframe
        src={embedUrl}
        width="100%"
        height="152"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        loading="lazy"
        style={{ border: 'none', borderRadius: 12 }}
        title="Spotify player"
      />
    </div>
  );
}

function YouTubeEmbed({ preview, isMine }: { preview: LinkPreviewData; isMine: boolean }) {
  const [playing, setPlaying] = useState(false);

  if (playing && preview.embedUrl) {
    return (
      <div className="mt-2 rounded-xl overflow-hidden" style={{ aspectRatio: '16/9', width: '100%' }}>
        <iframe
          src={preview.embedUrl}
          width="100%"
          height="100%"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          loading="lazy"
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
        <img
          src={preview.image}
          alt={preview.title ?? 'YouTube thumbnail'}
          className="w-full h-full object-cover transition-opacity group-hover:opacity-80"
        />
      )}
      {/* Play button */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-14 h-14 rounded-full flex items-center justify-center transition-transform group-hover:scale-110"
          style={{ background: 'rgba(255,0,0,0.9)' }}>
          <Play size={24} fill="white" className="text-white ml-1" />
        </div>
      </div>
      {/* Duration badge placeholder */}
      <div className="absolute bottom-2 right-2">
        <span className="text-[10px] bg-black/70 text-white px-1.5 py-0.5 rounded font-mono">▶ YouTube</span>
      </div>
    </button>
  );
}

export function LinkPreviewCard({ preview, isMine }: Props) {
  const platform = preview.platform ?? null;
  const cfg = platform ? PLATFORM_CONFIG[platform] : null;

  const containerClass = `mt-2 rounded-xl overflow-hidden text-xs cursor-pointer
    ${isMine ? 'bg-black/15 border border-white/10' : 'bg-background/60 border border-border'}`;

  // ── Spotify ──────────────────────────────────────────────────────────
  if (platform === 'spotify' && preview.embedUrl) {
    return (
      <div className={containerClass}>
        <div className="px-3 pt-2 pb-1">
          <PlatformBadge platform={platform} siteName={preview.siteName} />
          {preview.title && <p className="font-semibold mt-1 truncate text-foreground">{preview.title}</p>}
          {preview.description && <p className="opacity-70 line-clamp-1 mt-0.5">{preview.description}</p>}
        </div>
        <SpotifyEmbed embedUrl={preview.embedUrl} isMine={isMine} />
      </div>
    );
  }

  // ── YouTube ───────────────────────────────────────────────────────────
  if (platform === 'youtube') {
    return (
      <div className={containerClass}>
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
    <a href={preview.url} target="_blank" rel="noopener noreferrer" className={containerClass + ' block hover:opacity-90 transition-opacity'}>
      {hasImage && (
        <img src={preview.image!} alt={preview.title ?? ''} className="w-full object-cover max-h-40" />
      )}
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
