/**
 * Album item normaliser.
 *
 * Album messages historically stored their media as a flat `string[]` of
 * URLs. To match Telegram's "everything is already there" feel we now
 * also accept a richer per-item shape with intrinsic dimensions, a tiny
 * inline LQIP (`stripped_thumb` equivalent), and an optional video
 * poster URL — same fields the single-image bubble already carries.
 *
 * The wire shape stays a JSON array; each entry is EITHER a bare string
 * (legacy / cheap path) OR an object with `{url, w?, h?, lqip?,
 * thumbnailUrl?}`. These helpers normalise both forms so every call
 * site can read the URL and metadata without a giant ternary.
 *
 * Keep this module dependency-free — it's used by the chat-area, the
 * conversation list, the group-info sheet, the background loader, and
 * the media-cache prewarm helper.
 */

export type AlbumItemRich = {
  url: string;
  /** Intrinsic media width in pixels (server-stored at upload). */
  w?: number | null;
  /** Intrinsic media height in pixels (server-stored at upload). */
  h?: number | null;
  /** Tiny base64 LQIP data URL (~700–1500 B JPEG). */
  lqip?: string | null;
  /** For video items: server-stored first-frame JPEG URL. */
  thumbnailUrl?: string | null;
};

export type AlbumItem = string | AlbumItemRich;

/**
 * Pull the URL out of an album item regardless of which shape it has.
 * Defensive at runtime: a malformed payload like `{ url: 123 }` or
 * `{ url: null }` (which TypeScript can't catch on data crossing the
 * wire) must NOT propagate a non-string into call sites that then call
 * `.match(...)` or feed it to an `<img src>`. Anything that isn't a
 * non-empty string collapses to `''`, which `albumUrls` already filters
 * out and which renderers treat as "skip this tile".
 */
export function albumUrl(item: AlbumItem | null | undefined): string {
  if (item == null) return '';
  if (typeof item === 'string') return item;
  if (typeof item === 'object' && typeof (item as AlbumItemRich).url === 'string') {
    return (item as AlbumItemRich).url;
  }
  return '';
}

/**
 * Pull the metadata fields out of an album item. Always returns an
 * object so the caller doesn't need to null-check before destructuring.
 * Bare-string items resolve to all-null metadata. Each field is
 * runtime-coerced so a malformed wire payload (e.g. `{w: "100"}` or
 * `{lqip: {}}`) cannot leak the wrong type into React props or layout
 * math.
 */
export function albumMeta(item: AlbumItem | null | undefined): {
  w: number | null;
  h: number | null;
  lqip: string | null;
  thumbnailUrl: string | null;
} {
  if (item == null || typeof item === 'string' || typeof item !== 'object') {
    return { w: null, h: null, lqip: null, thumbnailUrl: null };
  }
  const rich = item as AlbumItemRich;
  return {
    w: typeof rich.w === 'number' && Number.isFinite(rich.w) ? rich.w : null,
    h: typeof rich.h === 'number' && Number.isFinite(rich.h) ? rich.h : null,
    lqip: typeof rich.lqip === 'string' && rich.lqip.length > 0 ? rich.lqip : null,
    thumbnailUrl:
      typeof rich.thumbnailUrl === 'string' && rich.thumbnailUrl.length > 0
        ? rich.thumbnailUrl
        : null,
  };
}

/** Convenience: convert any album item form to a flat URL list. */
export function albumUrls(items: ReadonlyArray<AlbumItem> | null | undefined): string[] {
  if (!Array.isArray(items)) return [];
  return items.map(albumUrl).filter((u) => u.length > 0);
}
