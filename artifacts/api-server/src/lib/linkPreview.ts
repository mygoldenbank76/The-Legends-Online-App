import axios from "axios";

const URL_REGEX = /(https?:\/\/[^\s]+)/g;

interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
}

export function extractFirstUrl(text: string): string | null {
  const match = text.match(URL_REGEX);
  return match ? match[0] : null;
}

export async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  try {
    const response = await axios.get(url, {
      timeout: 5000,
      headers: {
        "User-Agent": "TeleChatBot/1.0",
      },
      maxRedirects: 3,
    });
    const html = response.data as string;
    if (typeof html !== "string") return null;

    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || null;
    const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)?.[1] || null;
    const ogDesc = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i)?.[1] || null;
    const metaDesc = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i)?.[1] || null;
    const ogImage = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i)?.[1] || null;

    return {
      url,
      title: ogTitle || title,
      description: ogDesc || metaDesc || null,
      image: ogImage || null,
    };
  } catch {
    return null;
  }
}
