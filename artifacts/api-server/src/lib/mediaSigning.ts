/**
 * Signed-URL gate for `/api/uploads/gcs/:objectId`.
 *
 * BACKGROUND
 * ----------
 * Object IDs (`${Date.now()}-${randomUUID()}.ext`) are unguessable, but
 * they appear in every message payload that references the file. Without
 * a server-side gate, any participant could exfiltrate a URL to the
 * outside world and an arbitrary HTTP client could fetch the asset.
 *
 * We can't simply slap `requireAuth` on the GET handler because the PWA
 * loads media via `<img src=…>` / `<video src=…>` / `<audio src=…>`,
 * none of which carry the JWT bearer header.
 *
 * APPROACH
 * --------
 * Every URL leaving the server is rewritten to
 *
 *     /api/uploads/gcs/<objectId>?e=<unix-seconds>&s=<base64url HMAC>
 *
 * The HMAC binds `objectId|exp` and is computed with `SESSION_SECRET`.
 * The GET handler validates the token in constant time before serving.
 * Tokens have a sliding TTL (default 7 days) so an exfiltrated URL
 * stops working soon after it leaks. Rotating `SESSION_SECRET` is a
 * server-wide kill switch.
 *
 * The signature deliberately does NOT bind to a viewer userId — that
 * keeps room broadcasts (one socket emit, many recipients) cacheable
 * and avoids per-recipient payload shaping. The actual "is this user
 * allowed to see this conversation?" gate lives at the message route,
 * already enforced via `isConversationMember`.
 */

import { createHmac, timingSafeEqual } from "crypto";

const KEY = process.env.SESSION_SECRET || "telechat-secret-key";
const PREFIX = "/api/uploads/gcs/";
// 7-day TTL: long enough that we never sign on every render but short
// enough that a leaked URL turns to dust within the same week.
const DEFAULT_TTL_SEC = 7 * 24 * 60 * 60;

function hmac(objectId: string, exp: number): string {
  return createHmac("sha256", KEY)
    .update(`${objectId}|${exp}`)
    .digest("base64url");
}

/**
 * Append `?e=&s=` to a `/api/uploads/gcs/...` URL. Anything else
 * (external URLs, blob: / data: URLs, empty strings) is returned
 * unchanged so callers can pass mixed input safely.
 *
 * Strips any pre-existing query string (e.g. a stale signature, or
 * a client echoing back a URL it received earlier) before re-signing.
 */
export function signMediaUrl<T extends string | null | undefined>(
  url: T,
  ttlSec: number = DEFAULT_TTL_SEC,
): T {
  if (!url || typeof url !== "string") return url;
  if (!url.startsWith(PREFIX)) return url;
  const qIdx = url.indexOf("?");
  const base = qIdx >= 0 ? url.slice(0, qIdx) : url;
  const objectId = base.slice(PREFIX.length);
  if (!objectId) return url;
  // Round the expiration to the START of the next UTC day boundary,
  // then add the TTL from there. This produces the SAME signed URL
  // for every call within the same UTC day, which is critical for
  // caching: the browser HTTP cache and the client's in-memory blob
  // cache both key on the full URL string. Without this, every API
  // response mints a fresh timestamp → new URL → cache miss →
  // re-download → visible flash on every conversation open.
  //
  // Effective validity: TTL + remaining-hours-today (7d + 0-24h).
  const nowSec = Math.floor(Date.now() / 1000);
  const startOfTodayUtc = nowSec - (nowSec % 86400);
  const exp = startOfTodayUtc + ttlSec;
  const sig = hmac(objectId, exp);
  return `${base}?e=${exp}&s=${sig}` as T;
}

/**
 * Strip the signature query from a URL the client may have echoed
 * back (e.g. when including a previously-sent media URL in a reply
 * draft). Stored URLs in the DB MUST be the bare form so we can
 * re-sign with a fresh expiration on every read.
 */
export function stripMediaSig<T extends string | null | undefined>(url: T): T {
  if (!url || typeof url !== "string") return url;
  if (!url.startsWith(PREFIX)) return url;
  const qIdx = url.indexOf("?");
  if (qIdx < 0) return url;
  return url.slice(0, qIdx) as T;
}

/**
 * Verify a token presented on `GET /uploads/gcs/:objectId`. Returns
 * true iff the HMAC matches and the expiration is in the future.
 * Constant-time on the HMAC compare to avoid timing oracles.
 */
export function verifyMediaToken(
  objectId: string,
  e: unknown,
  s: unknown,
): boolean {
  if (typeof e !== "string" || typeof s !== "string") return false;
  if (!objectId) return false;
  const exp = Number.parseInt(e, 10);
  if (!Number.isFinite(exp)) return false;
  if (exp * 1000 < Date.now()) return false;
  const expected = hmac(objectId, exp);
  let a: Buffer, b: Buffer;
  try {
    a = Buffer.from(s);
    b = Buffer.from(expected);
  } catch {
    return false;
  }
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-payload helpers — walk the standard message / album / user shapes and
// rewrite every `/api/uploads/gcs/...` URL inside. These are intentionally
// shape-aware (rather than a deep object walker) so they're cheap and so a
// future field that holds raw text containing the prefix can't accidentally
// be rewritten.
// ─────────────────────────────────────────────────────────────────────────────

type AlbumItem = string | { url: string; w?: number; h?: number; lqip?: string; thumbnailUrl?: string };

function signAlbum(album: AlbumItem[] | null | undefined, ttlSec?: number): AlbumItem[] | null | undefined {
  if (!album) return album;
  return album.map(item => {
    if (typeof item === "string") return signMediaUrl(item, ttlSec);
    return {
      ...item,
      url: signMediaUrl(item.url, ttlSec),
      ...(item.thumbnailUrl ? { thumbnailUrl: signMediaUrl(item.thumbnailUrl, ttlSec) } : {}),
    };
  });
}

interface SignableMessageLike {
  imageUrl?: string | null;
  thumbnailUrl?: string | null;
  audioUrl?: string | null;
  mediaAlbum?: AlbumItem[] | null;
  sender?: { avatar?: string | null } | null | undefined;
  replyTo?: SignableMessageLike | null;
  reactions?: Array<{ user?: { avatar?: string | null } | null | undefined }>;
}

/**
 * Returns a shallow-cloned copy of `msg` with all `/api/uploads/gcs/...`
 * URLs replaced by signed equivalents. Safe to call with `null` /
 * `undefined`. Recurses one level into `replyTo`.
 */
export function signMessageMedia<T extends SignableMessageLike | null | undefined>(
  msg: T,
  ttlSec?: number,
): T {
  if (!msg) return msg;
  const out: SignableMessageLike = { ...msg };
  if (out.imageUrl) out.imageUrl = signMediaUrl(out.imageUrl, ttlSec);
  if (out.thumbnailUrl) out.thumbnailUrl = signMediaUrl(out.thumbnailUrl, ttlSec);
  if (out.audioUrl) out.audioUrl = signMediaUrl(out.audioUrl, ttlSec);
  if (out.mediaAlbum) out.mediaAlbum = signAlbum(out.mediaAlbum, ttlSec);
  if (out.sender?.avatar) {
    out.sender = { ...out.sender, avatar: signMediaUrl(out.sender.avatar, ttlSec) };
  }
  if (out.replyTo) out.replyTo = signMessageMedia(out.replyTo, ttlSec);
  if (out.reactions) {
    out.reactions = out.reactions.map(r =>
      r.user?.avatar
        ? { ...r, user: { ...r.user, avatar: signMediaUrl(r.user.avatar, ttlSec) } }
        : r
    );
  }
  return out as T;
}

export function signMessageList<T extends SignableMessageLike>(
  msgs: T[],
  ttlSec?: number,
): T[] {
  return msgs.map(m => signMessageMedia(m, ttlSec));
}
