import { Router, type IRouter } from "express";
import {
  db, usersTable, messagesTable, reactionsTable,
  conversationParticipantsTable, conversationsTable,
  pollsTable, pollOptionsTable, conversationPinsTable,
} from "@workspace/db";
import { eq, and, lt, desc, inArray, ne, gt, gte } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { formatUser } from "./users";
import { extractFirstUrl, fetchLinkPreview } from "../lib/linkPreview";
import { probeImageDimensions } from "../lib/mediaProbe";
import { probeVideo, isProbableVideo } from "../lib/videoProbe";
import { io, userSockets, getRoomMembers } from "../app";
import { buildPoll } from "./polls";
import { notifyNewMessage } from "../lib/pushNotifications";

const router: IRouter = Router();

// ── Album payload sanitiser ──────────────────────────────────────────────
// Album entries arrive on the wire as either a bare URL string (legacy
// senders) or an enriched `{url, w?, h?, lqip?, thumbnailUrl?}` object
// (Telegram-style payload). This helper:
//
//   • drops anything that doesn't reduce to a non-empty URL string
//   • enforces the same LQIP shape + 4 KB cap that single-image bubbles
//     use, so a misbehaving client can't bloat the row or smuggle an
//     `http(s):` URL into the LQIP slot
//   • clamps width/height to the same MAX_DIM safe-positive-integer
//     bound used for single-image dims
//   • returns `null` (not `[]`) when the resulting album is empty so
//     `mediaAlbum IS NULL` queries keep working unchanged
//
// Output is intentionally shaped as a homogeneous array of rich objects
// when ANY metadata is present, falling back to the bare URL form when
// nothing extra is known. Both forms are read by the client normaliser.
// Tightened from 4096 → 1500 to match the Telegram-grade ultra-tiny
// LQIPs we now generate (24x24 q30 mozjpeg ~300-700 bytes). Anything
// larger is either a misbehaving client or a regression in the LQIP
// pipeline and we'd rather drop it than bloat the wire payload.
const ALBUM_LQIP_MAX_BYTES = 1500;
const ALBUM_LQIP_PATTERN = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/i;
const ALBUM_MAX_DIM = 100_000;

type SanitisedAlbumItem =
  | string
  | { url: string; w?: number; h?: number; lqip?: string; thumbnailUrl?: string };

function sanitizeAlbum(input: unknown): SanitisedAlbumItem[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const out: SanitisedAlbumItem[] = [];
  for (const raw of input) {
    if (typeof raw === "string") {
      if (raw.length > 0) out.push(raw);
      continue;
    }
    if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;
      const url = typeof obj.url === "string" ? obj.url : "";
      if (!url) continue;
      const w = typeof obj.w === "number" && Number.isSafeInteger(obj.w)
        && obj.w > 0 && obj.w <= ALBUM_MAX_DIM ? obj.w : undefined;
      const h = typeof obj.h === "number" && Number.isSafeInteger(obj.h)
        && obj.h > 0 && obj.h <= ALBUM_MAX_DIM ? obj.h : undefined;
      const lqip = typeof obj.lqip === "string"
        && obj.lqip.length > 0
        && obj.lqip.length <= ALBUM_LQIP_MAX_BYTES
        && ALBUM_LQIP_PATTERN.test(obj.lqip)
          ? obj.lqip : undefined;
      const thumbnailUrl = typeof obj.thumbnailUrl === "string"
        && obj.thumbnailUrl.length > 0 ? obj.thumbnailUrl : undefined;
      // Keep dims paired — a lone width or height isn't useful for
      // sizing the tile, so drop the orphan.
      const hasDims = w !== undefined && h !== undefined;
      if (!hasDims && !lqip && !thumbnailUrl) {
        out.push(url);
      } else {
        out.push({
          url,
          ...(hasDims ? { w: w as number, h: h as number } : {}),
          ...(lqip ? { lqip } : {}),
          ...(thumbnailUrl ? { thumbnailUrl } : {}),
        });
      }
    }
  }
  return out.length > 0 ? out : null;
}

async function buildMessage(messageId: number, requestingUserId?: number): Promise<FormattedMessage | null> {
  const [msg] = await db.select().from(messagesTable).where(eq(messagesTable.id, messageId));
  if (!msg) return null;

  const [sender] = await db.select().from(usersTable).where(eq(usersTable.id, msg.senderId));
  const reactions = await db.select().from(reactionsTable).where(eq(reactionsTable.messageId, msg.id));
  const reactionUserIds = [...new Set(reactions.map(r => r.userId))];
  const reactionUsers = reactionUserIds.length > 0
    ? await db.select().from(usersTable).where(inArray(usersTable.id, reactionUserIds))
    : [];
  const reactionUserMap = Object.fromEntries(reactionUsers.map(u => [u.id, u]));

  let replyTo = null;
  if (msg.replyToId) {
    const [replyMsg] = await db.select().from(messagesTable).where(eq(messagesTable.id, msg.replyToId));
    if (replyMsg) {
      const [replySender] = await db.select().from(usersTable).where(eq(usersTable.id, replyMsg.senderId));
      replyTo = {
        id: replyMsg.id,
        conversationId: replyMsg.conversationId,
        senderId: replyMsg.senderId,
        sender: replySender ? formatUser(replySender) : undefined,
        content: replyMsg.isDeleted ? null : replyMsg.content,
        imageUrl: replyMsg.isDeleted ? null : replyMsg.imageUrl,
        // Forward the intrinsic dimensions + LQIP + server thumbnail of
        // the quoted message so the small reply preview inside the new
        // bubble paints a recognisable blurred preview on the very
        // first frame instead of an empty grey square — same UX as
        // Telegram's reply previews.
        mediaWidth: replyMsg.isDeleted ? null : replyMsg.mediaWidth,
        mediaHeight: replyMsg.isDeleted ? null : replyMsg.mediaHeight,
        thumbnailUrl: replyMsg.isDeleted ? null : replyMsg.thumbnailUrl,
        mediaPreview: replyMsg.isDeleted ? null : replyMsg.mediaPreview,
        audioUrl: replyMsg.isDeleted ? null : replyMsg.audioUrl,
        isDeleted: replyMsg.isDeleted,
        reactions: [],
        createdAt: replyMsg.createdAt.toISOString(),
      };
    }
  }

  let poll = null;
  if (msg.pollId) {
    poll = await buildPoll(msg.pollId, requestingUserId);
  }

  return {
    id: msg.id,
    conversationId: msg.conversationId,
    senderId: msg.senderId,
    sender: sender ? formatUser(sender) : undefined,
    content: msg.isDeleted ? null : msg.content,
    imageUrl: msg.isDeleted ? null : msg.imageUrl,
    mediaWidth: msg.isDeleted ? null : msg.mediaWidth,
    mediaHeight: msg.isDeleted ? null : msg.mediaHeight,
    thumbnailUrl: msg.isDeleted ? null : msg.thumbnailUrl,
    mediaPreview: msg.isDeleted ? null : msg.mediaPreview,
    mediaAlbum: msg.isDeleted ? null : (msg.mediaAlbum as SanitisedAlbumItem[] | null),
    audioUrl: msg.isDeleted ? null : msg.audioUrl,
    audioDuration: msg.isDeleted ? null : msg.audioDuration,
    poll: msg.isDeleted ? null : poll,
    linkPreview: msg.isDeleted ? null : (msg.linkPreview as { url: string; title?: string; description?: string; image?: string } | null),
    replyTo,
    editedAt: msg.editedAt ? msg.editedAt.toISOString() : null,
    isDeleted: msg.isDeleted,
    reactions: msg.isDeleted ? [] : reactions.map(r => ({
      id: r.id,
      messageId: r.messageId,
      userId: r.userId,
      emoji: r.emoji,
      user: reactionUserMap[r.userId] ? formatUser(reactionUserMap[r.userId]) : undefined,
      createdAt: r.createdAt.toISOString(),
    })),
    createdAt: msg.createdAt.toISOString(),
  };
}

type FormattedMessage = {
  id: number;
  conversationId: number;
  senderId: number;
  sender?: ReturnType<typeof formatUser>;
  content: string | null;
  imageUrl: string | null;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
  thumbnailUrl?: string | null;
  mediaPreview?: string | null;
  mediaAlbum?: SanitisedAlbumItem[] | null;
  audioUrl?: string | null;
  audioDuration?: number | null;
  poll?: any;
  linkPreview: { url: string; title?: string; description?: string; image?: string } | null;
  replyTo: any;
  editedAt: string | null;
  isDeleted: boolean;
  status?: 'sent' | 'delivered' | 'read';
  callType?: string | null;
  callStatus?: string | null;
  callDuration?: number | null;
  reactions: Array<{ id: number; messageId: number; userId: number; emoji: string; user?: ReturnType<typeof formatUser>; createdAt: string }>;
  createdAt: string;
};

// POST /api/link-preview — fetch Open Graph metadata for a URL extracted
// from the given text. Used by the composer to show an inline preview as
// the user types, before the message is sent.
router.post("/link-preview", requireAuth, async (req, res): Promise<void> => {
  const { text, url: rawUrl } = (req.body || {}) as { text?: string; url?: string };
  const url = rawUrl ?? (text ? extractFirstUrl(text) : null);
  if (!url) {
    res.status(200).json({ preview: null });
    return;
  }
  try {
    const preview = await fetchLinkPreview(url);
    res.status(200).json({ preview: preview ?? null });
  } catch {
    res.status(200).json({ preview: null });
  }
});

// GET messages in conversation
router.get("/conversations/:conversationId/messages", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const rawId = Array.isArray(req.params.conversationId) ? req.params.conversationId[0] : req.params.conversationId;
  const conversationId = parseInt(rawId, 10);
  if (isNaN(conversationId)) { res.status(400).json({ error: "Invalid conversation ID" }); return; }

  const limit = Math.min(parseInt(req.query.limit as string || "50", 10), 100);
  const before = req.query.before ? parseInt(req.query.before as string, 10) : undefined;

  const conditions = [eq(messagesTable.conversationId, conversationId)];
  if (before && !isNaN(before)) conditions.push(lt(messagesTable.id, before));

  const msgs = await db.select().from(messagesTable)
    .where(and(...conditions))
    .orderBy(desc(messagesTable.createdAt))
    .limit(limit);

  msgs.reverse();

  const senderIds = [...new Set(msgs.map(m => m.senderId))];
  const senders = senderIds.length > 0 ? await db.select().from(usersTable).where(inArray(usersTable.id, senderIds)) : [];
  const senderMap = Object.fromEntries(senders.map(s => [s.id, s]));

  const msgIds = msgs.map(m => m.id);
  const reactions = msgIds.length > 0 ? await db.select().from(reactionsTable).where(inArray(reactionsTable.messageId, msgIds)) : [];
  const reactionUserIds = [...new Set(reactions.map(r => r.userId))];
  const reactionUsers = reactionUserIds.length > 0 ? await db.select().from(usersTable).where(inArray(usersTable.id, reactionUserIds)) : [];
  const reactionUserMap = Object.fromEntries(reactionUsers.map(u => [u.id, u]));
  const reactionsByMessage: Record<number, typeof reactions> = {};
  for (const r of reactions) {
    if (!reactionsByMessage[r.messageId]) reactionsByMessage[r.messageId] = [];
    reactionsByMessage[r.messageId].push(r);
  }

  const replyToIds = msgs.map(m => m.replyToId).filter((id): id is number => id != null);
  const replyMsgs = replyToIds.length > 0 ? await db.select().from(messagesTable).where(inArray(messagesTable.id, replyToIds)) : [];
  const replySenderIds = [...new Set(replyMsgs.map(m => m.senderId))];
  const replySenders = replySenderIds.length > 0 ? await db.select().from(usersTable).where(inArray(usersTable.id, replySenderIds)) : [];
  const replySenderMap = Object.fromEntries(replySenders.map(s => [s.id, s]));
  const replyMsgMap = Object.fromEntries(replyMsgs.map(m => [m.id, m]));

  // Load polls for poll messages
  const pollIds = msgs.map(m => m.pollId).filter((id): id is number => id != null);
  const pollsData: Record<number, any> = {};
  for (const pollId of pollIds) {
    pollsData[pollId] = await buildPoll(pollId, userId);
  }

  // ── Message status (read receipts) ──────────────────────────────────────────
  // Fetch all participants (except current user) and their lastReadAt
  const participants = await db.select({
    userId: conversationParticipantsTable.userId,
    lastReadAt: conversationParticipantsTable.lastReadAt,
  }).from(conversationParticipantsTable)
    .where(and(
      eq(conversationParticipantsTable.conversationId, conversationId),
      ne(conversationParticipantsTable.userId, userId),
    ));

  // IDs of non-sender participants currently in the socket room
  const presentInRoom = getRoomMembers(conversationId);

  // Helper: compute status for a message sent by the current user
  function computeStatus(msg: typeof msgs[number]): 'sent' | 'delivered' | 'read' {
    if (msg.senderId !== userId) return 'sent'; // status only shown for own messages
    const createdAt = msg.createdAt;
    // read = at least one non-sender has lastReadAt >= createdAt
    const isRead = participants.some(p => p.lastReadAt && p.lastReadAt >= createdAt);
    if (isRead) return 'read';
    // delivered = at least one non-sender is currently in the socket room
    const isDelivered = participants.some(p => presentInRoom.has(p.userId));
    if (isDelivered) return 'delivered';
    return 'sent';
  }

  const formatted = msgs.map(m => {
    const replyMsg = m.replyToId ? replyMsgMap[m.replyToId] : null;
    const replyTo = replyMsg ? {
      id: replyMsg.id,
      conversationId: replyMsg.conversationId,
      senderId: replyMsg.senderId,
      sender: replySenderMap[replyMsg.senderId] ? formatUser(replySenderMap[replyMsg.senderId]) : undefined,
      content: replyMsg.isDeleted ? null : replyMsg.content,
      imageUrl: replyMsg.isDeleted ? null : replyMsg.imageUrl,
      // Same Telegram-like reply preview enrichment as buildMessage above:
      // forward dims + LQIP + server thumbnail so the small image inside
      // the reply box paints a recognisable preview on the very first
      // frame, no grey square waiting on a network round-trip.
      mediaWidth: replyMsg.isDeleted ? null : replyMsg.mediaWidth,
      mediaHeight: replyMsg.isDeleted ? null : replyMsg.mediaHeight,
      thumbnailUrl: replyMsg.isDeleted ? null : replyMsg.thumbnailUrl,
      mediaPreview: replyMsg.isDeleted ? null : replyMsg.mediaPreview,
      audioUrl: replyMsg.isDeleted ? null : replyMsg.audioUrl,
      isDeleted: replyMsg.isDeleted,
      reactions: [],
      createdAt: replyMsg.createdAt.toISOString(),
    } : null;

    return {
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      sender: senderMap[m.senderId] ? formatUser(senderMap[m.senderId]) : undefined,
      content: m.isDeleted ? null : m.content,
      imageUrl: m.isDeleted ? null : m.imageUrl,
      mediaWidth: m.isDeleted ? null : m.mediaWidth,
      mediaHeight: m.isDeleted ? null : m.mediaHeight,
      thumbnailUrl: m.isDeleted ? null : m.thumbnailUrl,
      mediaPreview: m.isDeleted ? null : m.mediaPreview,
      mediaAlbum: m.isDeleted ? null : (m.mediaAlbum as SanitisedAlbumItem[] | null),
      audioUrl: m.isDeleted ? null : m.audioUrl,
      audioDuration: m.isDeleted ? null : m.audioDuration,
      poll: m.isDeleted ? null : (m.pollId ? pollsData[m.pollId] || null : null),
      linkPreview: m.isDeleted ? null : (m.linkPreview as { url: string; title?: string; description?: string; image?: string } | null),
      replyTo,
      editedAt: m.editedAt ? m.editedAt.toISOString() : null,
      isDeleted: m.isDeleted,
      status: computeStatus(m),
      callType: m.callType,
      callStatus: m.callStatus,
      callDuration: m.callDuration,
      reactions: m.isDeleted ? [] : (reactionsByMessage[m.id] || []).map(r => ({
        id: r.id,
        messageId: r.messageId,
        userId: r.userId,
        emoji: r.emoji,
        user: reactionUserMap[r.userId] ? formatUser(reactionUserMap[r.userId]) : undefined,
        createdAt: r.createdAt.toISOString(),
      })),
      createdAt: m.createdAt.toISOString(),
    };
  });

  res.json(formatted);
});

// POST send message
router.post("/conversations/:conversationId/messages", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;

  // Block banned users from sending messages
  const [senderCheck] = await db.select({ isBanned: usersTable.isBanned }).from(usersTable).where(eq(usersTable.id, userId));
  if (senderCheck?.isBanned) {
    res.status(403).json({ error: "Compte suspendu" });
    return;
  }

  const rawId = Array.isArray(req.params.conversationId) ? req.params.conversationId[0] : req.params.conversationId;
  const conversationId = parseInt(rawId, 10);
  if (isNaN(conversationId)) { res.status(400).json({ error: "Invalid conversation ID" }); return; }

  const {
    content, imageUrl, mediaWidth, mediaHeight, thumbnailUrl, mediaPreview, mediaAlbum,
    audioUrl, audioDuration, replyToId, poll, disableLinkPreview,
  } = req.body as {
    content?: string;
    imageUrl?: string;
    // Intrinsic dimensions of the single image/video (when imageUrl is set).
    // Sent by the client at upload time so the receiver can size the bubble
    // correctly on the very first paint.
    mediaWidth?: number;
    mediaHeight?: number;
    // For video messages: URL to the server-stored JPEG of the first frame
    // (captured by the sender's browser at send time and uploaded as a
    // regular image). The receiving client uses this as the poster so the
    // bubble shows a real preview thumbnail on the very first paint —
    // no momentary black box, no per-recipient on-the-fly capture.
    thumbnailUrl?: string;
    // Tiny base64 LQIP (`data:image/jpeg;base64,…`) generated by the
    // sender's browser at send time. Embedded in the message JSON so
    // every recipient paints a recognisable blurred preview on the
    // very first frame instead of an empty placeholder while the
    // multi-MB original streams from object storage.
    mediaPreview?: string;
    // Album entries: each item is EITHER a bare URL string (legacy
    // senders) OR a rich object {url, w, h, lqip, thumbnailUrl} with
    // per-item intrinsic dimensions, LQIP, and (for videos) server
    // thumbnail. Both shapes are validated and persisted as-is so
    // recipients render the right preview on the very first frame
    // without any grey-square flash.
    mediaAlbum?: Array<
      | string
      | { url?: unknown; w?: unknown; h?: unknown; lqip?: unknown; thumbnailUrl?: unknown }
    >;
    audioUrl?: string;
    audioDuration?: number;
    replyToId?: number;
    disableLinkPreview?: boolean;
    poll?: {
      question: string;
      options: string[];
      isAnonymous?: boolean;
      isMultipleChoice?: boolean;
      isQuiz?: boolean;
    };
  };

  // Validate dimensions: only accept safe positive integers within a sane
  // upper bound (much larger than any real photo/video resolution but well
  // below int4 overflow). Also require BOTH width and height — a lone
  // dimension is meaningless for sizing the bubble, so we discard the pair.
  const MAX_DIM = 100_000;
  const isValidDim = (n: unknown): n is number =>
    typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= MAX_DIM;
  const dimsValid = isValidDim(mediaWidth) && isValidDim(mediaHeight);
  let safeWidth = dimsValid ? (mediaWidth as number) : null;
  let safeHeight = dimsValid ? (mediaHeight as number) : null;

  // Safety net: if the client forwarded an imageUrl without dimensions
  // (older clients, document picker reroute, future bugs), probe the
  // bytes once so the row lands in the database with width/height
  // populated and every recipient still gets a bubble that paints at
  // the correct shape on the very first frame — no fallback aspect,
  // no visible reflow when the image decodes.
  //
  // For videos we also probe the first frame for a tiny LQIP if the
  // client didn't send one (legacy clients, share-target uploads).
  // Both probes are best-effort and capped (image: 64 KB read; video:
  // 50 MB / 8 s ffmpeg timeout) so they can never delay the send.
  let probedVideoLqip: string | null = null;
  if (imageUrl && (safeWidth === null || safeHeight === null)) {
    try {
      if (isProbableVideo(imageUrl)) {
        const probed = await probeVideo(imageUrl);
        if (probed) {
          if (probed.width > 0 && probed.height > 0) {
            safeWidth = probed.width;
            safeHeight = probed.height;
          }
          probedVideoLqip = probed.lqip;
        }
      } else {
        const probed = await probeImageDimensions(imageUrl);
        if (probed) {
          safeWidth = probed.width;
          safeHeight = probed.height;
        }
      }
    } catch {
      // probe is best-effort; never fail the send because of it
    }
  }

  // Sanitise the LQIP: must be a small JPEG/PNG/WebP data URL and at
  // most 4 KB. A misbehaving client could otherwise stuff arbitrary
  // text into the row, bloat the payload, or smuggle an `http(s):`
  // URL that recipients would render unfiltered. Anything that fails
  // the check is silently dropped — the bubble simply falls back to
  // the legacy aspect-ratio placeholder.
  // Matches the album-side cap above and the server-side generator
  // (24x24 q30 mozjpeg). See the long comment at ALBUM_LQIP_MAX_BYTES.
  const LQIP_MAX_BYTES = 1500;
  // Strict: prefix + actual base64 character set (so a misbehaving
  // client can't smuggle non-base64 garbage past the length check).
  const LQIP_PATTERN = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/i;
  let safeMediaPreview: string | null = null;
  if (
    imageUrl &&
    typeof mediaPreview === "string" &&
    mediaPreview.length > 0 &&
    mediaPreview.length <= LQIP_MAX_BYTES &&
    LQIP_PATTERN.test(mediaPreview)
  ) {
    safeMediaPreview = mediaPreview;
  } else if (imageUrl && probedVideoLqip && LQIP_PATTERN.test(probedVideoLqip)) {
    // Video sender didn't supply a LQIP — use the one we just
    // generated from the first frame above.
    safeMediaPreview = probedVideoLqip;
  }

  if (content == null && imageUrl == null && mediaAlbum == null && audioUrl == null && poll == null) {
    res.status(400).json({ error: "Message must have content, imageUrl, mediaAlbum, audioUrl, or poll" });
    return;
  }

  let linkPreview = null;
  if (content && !disableLinkPreview) {
    const url = extractFirstUrl(content);
    if (url) linkPreview = await fetchLinkPreview(url);
  }

  let pollId: number | null = null;
  if (poll) {
    const [newPoll] = await db.insert(pollsTable).values({
      question: poll.question,
      isAnonymous: poll.isAnonymous ?? true,
      isMultipleChoice: poll.isMultipleChoice ?? false,
      isQuiz: poll.isQuiz ?? false,
    }).returning();

    await db.insert(pollOptionsTable).values(
      poll.options.map((text, idx) => ({ pollId: newPoll.id, text, sortOrder: idx }))
    );
    pollId = newPoll.id;
  }

  const [msg] = await db.insert(messagesTable).values({
    conversationId,
    senderId: userId,
    content: content ?? null,
    imageUrl: imageUrl ?? null,
    // Only persist dimensions when the message actually carries a single
    // image/video — they don't apply to album entries or audio messages.
    mediaWidth: imageUrl ? safeWidth : null,
    mediaHeight: imageUrl ? safeHeight : null,
    // Only persist the thumbnail URL alongside an actual single-media
    // message; thumbnails for albums or non-image entries don't apply.
    thumbnailUrl: imageUrl && typeof thumbnailUrl === "string" && thumbnailUrl.length > 0
      ? thumbnailUrl
      : null,
    // LQIP only applies to single-image messages (album entries each
    // need their own preview, handled separately in a future change).
    mediaPreview: imageUrl ? safeMediaPreview : null,
    mediaAlbum: sanitizeAlbum(mediaAlbum),
    audioUrl: audioUrl ?? null,
    audioDuration: audioDuration ?? null,
    pollId: pollId ?? null,
    linkPreview: linkPreview ?? null,
    replyToId: replyToId ?? null,
  }).returning();

  await db.update(conversationsTable).set({ updatedAt: new Date() }).where(eq(conversationsTable.id, conversationId));

  const fullMessage = await buildMessage(msg.id, userId);
  io.to(`conversation:${conversationId}`).emit("new_message", fullMessage);

  // Trigger push notifications (async — don't block response)
  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId));
  const [sender] = await db.select({
    displayName: usersTable.displayName,
    avatarUrl: usersTable.avatar,
  }).from(usersTable).where(eq(usersTable.id, userId));
  if (conv && sender) {
    notifyNewMessage({
      conversationId,
      senderId: userId,
      senderName: sender.displayName,
      senderAvatar: sender.avatarUrl ?? null,
      conversationTitle: conv.name,
      isGroup: conv.type === "group",
      content: content ?? null,
      imageUrl: imageUrl ?? null,
      messageId: msg.id,
    }).catch(() => {});
  }

  res.status(201).json(fullMessage);
});

// POST mark conversation read
router.post("/conversations/:conversationId/read", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const rawId = Array.isArray(req.params.conversationId) ? req.params.conversationId[0] : req.params.conversationId;
  const conversationId = parseInt(rawId, 10);
  if (isNaN(conversationId)) { res.status(400).json({ error: "Invalid conversation ID" }); return; }

  // Get previous lastReadAt before updating
  const [participant] = await db.select({ lastReadAt: conversationParticipantsTable.lastReadAt })
    .from(conversationParticipantsTable)
    .where(and(eq(conversationParticipantsTable.conversationId, conversationId), eq(conversationParticipantsTable.userId, userId)));

  const prevReadAt = participant?.lastReadAt ?? new Date(0);
  const now = new Date();

  await db.update(conversationParticipantsTable)
    .set({ lastReadAt: now })
    .where(and(eq(conversationParticipantsTable.conversationId, conversationId), eq(conversationParticipantsTable.userId, userId)));

  // Find senders of newly-read messages and notify them
  try {
    const newlyReadMsgs = await db.select({ senderId: messagesTable.senderId })
      .from(messagesTable)
      .where(and(
        eq(messagesTable.conversationId, conversationId),
        ne(messagesTable.senderId, userId),
        gt(messagesTable.createdAt, prevReadAt),
      ));
    const senderIds = [...new Set(newlyReadMsgs.map(m => m.senderId))];
    for (const senderId of senderIds) {
      const senderSocketIds = userSockets.get(senderId);
      if (senderSocketIds) {
        for (const socketId of senderSocketIds) {
          io.to(socketId).emit("messages_read", { conversationId, readBy: userId });
        }
      }
    }
  } catch { /* non-critical */ }

  res.json({ success: true });
});

// PATCH edit message
router.patch("/messages/:messageId", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const rawId = Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId;
  const messageId = parseInt(rawId, 10);
  if (isNaN(messageId)) { res.status(400).json({ error: "Invalid message ID" }); return; }

  const [msg] = await db.select().from(messagesTable).where(eq(messagesTable.id, messageId));
  if (!msg) { res.status(404).json({ error: "Message not found" }); return; }
  if (msg.senderId !== userId) { res.status(403).json({ error: "Not authorized" }); return; }
  if (msg.isDeleted) { res.status(403).json({ error: "Cannot edit deleted message" }); return; }

  const { content } = req.body as { content: string };
  if (!content?.trim()) { res.status(400).json({ error: "Content required" }); return; }

  await db.update(messagesTable)
    .set({ content: content.trim(), editedAt: new Date() })
    .where(eq(messagesTable.id, messageId));

  const fullMessage = await buildMessage(messageId, userId);
  io.to(`conversation:${msg.conversationId}`).emit("message_edited", fullMessage);
  res.json(fullMessage);
});

// DELETE message — hard delete
router.delete("/messages/:messageId", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const rawId = Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId;
  const messageId = parseInt(rawId, 10);
  if (isNaN(messageId)) { res.status(400).json({ error: "Invalid message ID" }); return; }

  const [msg] = await db.select().from(messagesTable).where(eq(messagesTable.id, messageId));
  if (!msg) { res.status(404).json({ error: "Message not found" }); return; }

  if (msg.senderId !== userId) {
    const [requestingUser] = await db.select({ isAdmin: usersTable.isAdmin }).from(usersTable).where(eq(usersTable.id, userId));
    if (!requestingUser?.isAdmin) { res.status(403).json({ error: "Not authorized" }); return; }
  }

  const conversationId = msg.conversationId;

  await db.delete(reactionsTable).where(eq(reactionsTable.messageId, messageId));
  await db.delete(messagesTable).where(eq(messagesTable.id, messageId));

  io.to(`conversation:${conversationId}`).emit("message_deleted", { messageId, conversationId });
  res.json({ success: true });
});

// POST pin/unpin message
router.post("/messages/:messageId/pin", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId;
  const messageId = parseInt(rawId, 10);
  if (isNaN(messageId)) { res.status(400).json({ error: "Invalid message ID" }); return; }

  const [msg] = await db.select().from(messagesTable).where(eq(messagesTable.id, messageId));
  if (!msg) { res.status(404).json({ error: "Message not found" }); return; }

  const existingPin = await db.select().from(conversationPinsTable)
    .where(and(eq(conversationPinsTable.conversationId, msg.conversationId), eq(conversationPinsTable.messageId, messageId)));

  let action: 'pinned' | 'unpinned';
  if (existingPin.length > 0) {
    await db.delete(conversationPinsTable)
      .where(and(eq(conversationPinsTable.conversationId, msg.conversationId), eq(conversationPinsTable.messageId, messageId)));
    action = 'unpinned';
  } else {
    await db.insert(conversationPinsTable).values({ conversationId: msg.conversationId, messageId }).onConflictDoNothing();
    action = 'pinned';
  }

  const allPins = await db.select().from(conversationPinsTable)
    .where(eq(conversationPinsTable.conversationId, msg.conversationId))
    .orderBy(conversationPinsTable.pinnedAt);

  const pinnedMessageIds = allPins.map(p => p.messageId);

  io.to(`conversation:${msg.conversationId}`).emit("message_pinned", {
    conversationId: msg.conversationId,
    pinnedMessageIds,
    messageId,
    action,
  });

  res.json({ success: true, pinnedMessageIds });
});

// GET reads — who has read a message
router.get("/messages/:messageId/reads", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const rawId = Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId;
  const messageId = parseInt(rawId, 10);
  if (isNaN(messageId)) { res.status(400).json({ error: "Invalid message ID" }); return; }

  const [msg] = await db.select().from(messagesTable).where(eq(messagesTable.id, messageId));
  if (!msg) { res.status(404).json({ error: "Message not found" }); return; }

  const [participation] = await db.select().from(conversationParticipantsTable).where(and(
    eq(conversationParticipantsTable.conversationId, msg.conversationId),
    eq(conversationParticipantsTable.userId, userId),
  ));
  if (!participation) { res.status(403).json({ error: "Forbidden" }); return; }

  const readers = await db.select({
    userId: conversationParticipantsTable.userId,
    lastReadAt: conversationParticipantsTable.lastReadAt,
  }).from(conversationParticipantsTable).where(and(
    eq(conversationParticipantsTable.conversationId, msg.conversationId),
    ne(conversationParticipantsTable.userId, msg.senderId),
    gte(conversationParticipantsTable.lastReadAt, msg.createdAt),
  ));

  // Deduplicate by userId — keep most recent lastReadAt per user
  const uniqueByUser = Object.values(
    readers.reduce<Record<number, { userId: number; lastReadAt: Date | null }>>((acc, r) => {
      if (!acc[r.userId] || (r.lastReadAt && (!acc[r.userId].lastReadAt || r.lastReadAt > acc[r.userId].lastReadAt!))) {
        acc[r.userId] = r;
      }
      return acc;
    }, {})
  );

  const readerUserIds = uniqueByUser.map(r => r.userId);
  const readerUsers = readerUserIds.length > 0
    ? await db.select().from(usersTable).where(inArray(usersTable.id, readerUserIds))
    : [];
  const userMap = Object.fromEntries(readerUsers.map(u => [u.id, u]));

  const result = uniqueByUser.map(r => ({
    id: r.userId,
    displayName: userMap[r.userId]?.displayName ?? 'User',
    username: userMap[r.userId]?.username ?? '',
    avatar: userMap[r.userId]?.avatar ?? null,
    readAt: r.lastReadAt?.toISOString() ?? null,
  }));

  res.json({ count: result.length, readers: result });
});

// POST reactions
router.post("/messages/:messageId/reactions", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const rawId = Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId;
  const messageId = parseInt(rawId, 10);
  if (isNaN(messageId)) { res.status(400).json({ error: "Invalid message ID" }); return; }

  const { emoji } = req.body as { emoji: string };
  if (!emoji) { res.status(400).json({ error: "emoji is required" }); return; }

  const [existing] = await db.select().from(reactionsTable).where(and(
    eq(reactionsTable.messageId, messageId),
    eq(reactionsTable.userId, userId),
    eq(reactionsTable.emoji, emoji)
  ));

  if (existing) {
    await db.delete(reactionsTable).where(eq(reactionsTable.id, existing.id));
  } else {
    await db.insert(reactionsTable).values({ messageId, userId, emoji });
  }

  const fullMessage = await buildMessage(messageId, userId);
  if (!fullMessage) { res.status(404).json({ error: "Message not found" }); return; }

  io.to(`conversation:${fullMessage.conversationId}`).emit("message_reaction", fullMessage);
  res.json(fullMessage);
});

export default router;
