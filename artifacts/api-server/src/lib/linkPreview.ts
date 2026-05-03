import axios from "axios";

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  platform: string | null;
  embedUrl: string | null;
  siteName: string | null;
}

function cleanUrl(raw: string): string {
  // Strip trailing punctuation that's not part of the URL
  return raw.replace(/[)\].,!?;:'"]+$/, '');
}

export function extractFirstUrl(text: string): string | null {
  // 1. Markdown links [label](url) — extract URL from parentheses
  const mdMatch = text.match(/\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/);
  if (mdMatch) return cleanUrl(mdMatch[1]);

  // 2. Plain URLs
  const plainMatch = text.match(/https?:\/\/[^\s]+/);
  if (plainMatch) return cleanUrl(plainMatch[0]);

  return null;
}

function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?(?:[^&]*&)*v=)([^&?/\s]+)/,
    /(?:youtu\.be\/)([^&?/\s]+)/,
    /(?:youtube\.com\/shorts\/)([^&?/\s]+)/,
    /(?:youtube\.com\/embed\/)([^&?/\s]+)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function extractSpotifyInfo(url: string): { type: string; id: string } | null {
  const m = url.match(/open\.spotify\.com\/(track|album|playlist|artist|episode|show)\/([^?&/\s]+)/);
  return m ? { type: m[1], id: m[2] } : null;
}

function detectPlatform(url: string, siteName?: string | null): string | null {
  const u = url.toLowerCase();
  const sn = (siteName || '').toLowerCase();
  if (u.includes('twitter.com') || u.includes('x.com') || sn.includes('twitter')) return 'twitter';
  if (u.includes('instagram.com') || sn.includes('instagram')) return 'instagram';
  if (u.includes('tiktok.com') || sn.includes('tiktok')) return 'tiktok';
  if (u.includes('netflix.com') || sn.includes('netflix')) return 'netflix';
  if (u.includes('twitch.tv') || sn.includes('twitch')) return 'twitch';
  if (u.includes('soundcloud.com') || sn.includes('soundcloud')) return 'soundcloud';
  if (u.includes('deezer.com') || sn.includes('deezer')) return 'deezer';
  if (u.includes('apple.com/music') || sn.includes('apple music')) return 'apple-music';
  if (u.includes('github.com') || sn.includes('github')) return 'github';
  if (u.includes('reddit.com') || sn.includes('reddit')) return 'reddit';
  return null;
}

export async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  try {
    // ── YouTube ──────────────────────────────────────────────────────
    const ytId = extractYouTubeId(url);
    if (ytId) {
      let title: string | null = null;
      let description: string | null = null;
      try {
        const oembedRes = await axios.get(
          `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytId}&format=json`,
          { timeout: 5000 }
        );
        const oe = oembedRes.data as { title?: string; author_name?: string };
        title = oe.title ?? null;
        description = oe.author_name ? `YouTube · ${oe.author_name}` : 'YouTube';
      } catch {
        description = 'YouTube';
      }
      return {
        url,
        title,
        description,
        image: `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`,
        platform: 'youtube',
        embedUrl: `https://www.youtube.com/embed/${ytId}?autoplay=1&rel=0`,
        siteName: 'YouTube',
      };
    }

    // ── Spotify ──────────────────────────────────────────────────────
    //
    // Spotify exposes a public, no-auth oEmbed endpoint that returns
    // the track/album/playlist title + a thumbnail URL of the cover
    // art. We use it to populate the rich card so the user sees the
    // artwork + name BEFORE tapping the play button — without it the
    // card was just a generic "music note" skeleton, which is what the
    // user reported. The endpoint is rate-limit-free for typical chat
    // usage and we wrap it in a tight 4 s budget so a Spotify outage
    // can never block the message-send round-trip.
    const spotifyInfo = extractSpotifyInfo(url);
    if (spotifyInfo) {
      const embedUrl = `https://open.spotify.com/embed/${spotifyInfo.type}/${spotifyInfo.id}?utm_source=generator&theme=0`;
      let spotTitle: string | null = null;
      let spotImage: string | null = null;
      let spotDescription: string | null = null;
      try {
        const oe = await axios.get(
          `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`,
          { timeout: 4000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TeleChat/1.0)' } },
        );
        const d = oe.data as {
          title?: string;
          thumbnail_url?: string;
          provider_name?: string;
          author_name?: string;
        };
        spotTitle = d.title ?? null;
        spotImage = d.thumbnail_url ?? null;
        spotDescription = d.author_name ? `Spotify · ${d.author_name}` : 'Spotify';
      } catch {
        // oEmbed temporarily unavailable — still return a usable card,
        // just without the artwork (same skeleton behaviour we had
        // before; not a regression).
      }
      return {
        url,
        title: spotTitle,
        description: spotDescription,
        image: spotImage,
        platform: 'spotify',
        embedUrl,
        siteName: 'Spotify',
      };
    }

    // ── Generic OG scraping ───────────────────────────────────────────
    const response = await axios.get(url, {
      timeout: 6000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TeleChat/1.0; +https://legendsonline.app)' },
      maxRedirects: 5,
    });
    const html = response.data as string;
    if (typeof html !== 'string') return null;

    const getTag = (pattern: RegExp) => pattern.exec(html)?.[1]?.trim() ?? null;

    const ogTitle = getTag(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)
      ?? getTag(/<meta[^>]*content="([^"]+)"[^>]*property="og:title"/i);
    const title = ogTitle ?? getTag(/<title[^>]*>([^<]+)<\/title>/i);
    const description = getTag(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i)
      ?? getTag(/<meta[^>]*content="([^"]+)"[^>]*property="og:description"/i)
      ?? getTag(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i)
      ?? getTag(/<meta[^>]*content="([^"]+)"[^>]*name="description"/i);
    const image = getTag(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i)
      ?? getTag(/<meta[^>]*content="([^"]+)"[^>]*property="og:image"/i);
    const siteName = getTag(/<meta[^>]*property="og:site_name"[^>]*content="([^"]+)"/i)
      ?? getTag(/<meta[^>]*content="([^"]+)"[^>]*property="og:site_name"/i);

    const platform = detectPlatform(url, siteName);

    return {
      url,
      title,
      description,
      image,
      platform,
      embedUrl: null,
      siteName,
    };
  } catch {
    return null;
  }
}
