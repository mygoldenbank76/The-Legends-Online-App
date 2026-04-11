import { Router, type IRouter } from "express";
import {
  db, usersTable, messagesTable, reactionsTable,
  conversationParticipantsTable, conversationsTable,
  pollsTable, pollOptionsTable, conversationPinsTable,
} from "@workspace/db";
import { eq, and, lt, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { formatUser } from "./users";
import { extractFirstUrl, fetchLinkPreview } from "../lib/linkPreview";
import { io } from "../app";
import { buildPoll } from "./polls";

const router: IRouter = Router();

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
  audioUrl?: string | null;
  audioDuration?: number | null;
  poll?: any;
  linkPreview: { url: string; title?: string; description?: string; image?: string } | null;
  replyTo: any;
  editedAt: string | null;
  isDeleted: boolean;
  reactions: Array<{ id: number; messageId: number; userId: number; emoji: string; user?: ReturnType<typeof formatUser>; createdAt: string }>;
  createdAt: string;
};

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

  const formatted = msgs.map(m => {
    const replyMsg = m.replyToId ? replyMsgMap[m.replyToId] : null;
    const replyTo = replyMsg ? {
      id: replyMsg.id,
      conversationId: replyMsg.conversationId,
      senderId: replyMsg.senderId,
      sender: replySenderMap[replyMsg.senderId] ? formatUser(replySenderMap[replyMsg.senderId]) : undefined,
      content: replyMsg.isDeleted ? null : replyMsg.content,
      imageUrl: replyMsg.isDeleted ? null : replyMsg.imageUrl,
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
      audioUrl: m.isDeleted ? null : m.audioUrl,
      audioDuration: m.isDeleted ? null : m.audioDuration,
      poll: m.isDeleted ? null : (m.pollId ? pollsData[m.pollId] || null : null),
      linkPreview: m.isDeleted ? null : (m.linkPreview as { url: string; title?: string; description?: string; image?: string } | null),
      replyTo,
      editedAt: m.editedAt ? m.editedAt.toISOString() : null,
      isDeleted: m.isDeleted,
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
  const rawId = Array.isArray(req.params.conversationId) ? req.params.conversationId[0] : req.params.conversationId;
  const conversationId = parseInt(rawId, 10);
  if (isNaN(conversationId)) { res.status(400).json({ error: "Invalid conversation ID" }); return; }

  const { content, imageUrl, audioUrl, audioDuration, replyToId, poll } = req.body as {
    content?: string;
    imageUrl?: string;
    audioUrl?: string;
    audioDuration?: number;
    replyToId?: number;
    poll?: {
      question: string;
      options: string[];
      isAnonymous?: boolean;
      isMultipleChoice?: boolean;
      isQuiz?: boolean;
    };
  };

  if (content == null && imageUrl == null && audioUrl == null && poll == null) {
    res.status(400).json({ error: "Message must have content, imageUrl, audioUrl, or poll" });
    return;
  }

  let linkPreview = null;
  if (content) {
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
    audioUrl: audioUrl ?? null,
    audioDuration: audioDuration ?? null,
    pollId: pollId ?? null,
    linkPreview: linkPreview ?? null,
    replyToId: replyToId ?? null,
  }).returning();

  await db.update(conversationsTable).set({ updatedAt: new Date() }).where(eq(conversationsTable.id, conversationId));

  const fullMessage = await buildMessage(msg.id, userId);
  io.to(`conversation:${conversationId}`).emit("new_message", fullMessage);
  res.status(201).json(fullMessage);
});

// POST mark conversation read
router.post("/conversations/:conversationId/read", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const rawId = Array.isArray(req.params.conversationId) ? req.params.conversationId[0] : req.params.conversationId;
  const conversationId = parseInt(rawId, 10);
  if (isNaN(conversationId)) { res.status(400).json({ error: "Invalid conversation ID" }); return; }

  await db.update(conversationParticipantsTable)
    .set({ lastReadAt: new Date() })
    .where(and(eq(conversationParticipantsTable.conversationId, conversationId), eq(conversationParticipantsTable.userId, userId)));

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
  if (msg.senderId !== userId) { res.status(403).json({ error: "Not authorized" }); return; }

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
