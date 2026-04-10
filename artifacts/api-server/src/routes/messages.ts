import { Router, type IRouter } from "express";
import { db, usersTable, messagesTable, reactionsTable, conversationParticipantsTable, conversationsTable } from "@workspace/db";
import { eq, and, lt, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { formatUser } from "./users";
import { extractFirstUrl, fetchLinkPreview } from "../lib/linkPreview";
import { io } from "../app";

const router: IRouter = Router();

async function buildMessage(messageId: number): Promise<FormattedMessage | null> {
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
        isDeleted: replyMsg.isDeleted,
        reactions: [],
        createdAt: replyMsg.createdAt.toISOString(),
      };
    }
  }

  return {
    id: msg.id,
    conversationId: msg.conversationId,
    senderId: msg.senderId,
    sender: sender ? formatUser(sender) : undefined,
    content: msg.isDeleted ? null : msg.content,
    imageUrl: msg.isDeleted ? null : msg.imageUrl,
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
  linkPreview: { url: string; title?: string; description?: string; image?: string } | null;
  replyTo: FormattedMessage | null;
  editedAt: string | null;
  isDeleted: boolean;
  reactions: Array<{ id: number; messageId: number; userId: number; emoji: string; user?: ReturnType<typeof formatUser>; createdAt: string }>;
  createdAt: string;
};

// GET messages in conversation
router.get("/conversations/:conversationId/messages", requireAuth, async (req, res): Promise<void> => {
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

  // Fetch reply-to messages
  const replyToIds = msgs.map(m => m.replyToId).filter((id): id is number => id != null);
  const replyMsgs = replyToIds.length > 0 ? await db.select().from(messagesTable).where(inArray(messagesTable.id, replyToIds)) : [];
  const replySenderIds = [...new Set(replyMsgs.map(m => m.senderId))];
  const replySenders = replySenderIds.length > 0 ? await db.select().from(usersTable).where(inArray(usersTable.id, replySenderIds)) : [];
  const replySenderMap = Object.fromEntries(replySenders.map(s => [s.id, s]));
  const replyMsgMap = Object.fromEntries(replyMsgs.map(m => [m.id, m]));

  const formatted = msgs.map(m => {
    const replyMsg = m.replyToId ? replyMsgMap[m.replyToId] : null;
    const replyTo = replyMsg ? {
      id: replyMsg.id,
      conversationId: replyMsg.conversationId,
      senderId: replyMsg.senderId,
      sender: replySenderMap[replyMsg.senderId] ? formatUser(replySenderMap[replyMsg.senderId]) : undefined,
      content: replyMsg.isDeleted ? null : replyMsg.content,
      imageUrl: replyMsg.isDeleted ? null : replyMsg.imageUrl,
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

  const { content, imageUrl, replyToId } = req.body as { content?: string; imageUrl?: string; replyToId?: number };

  if (content == null && imageUrl == null) {
    res.status(400).json({ error: "Message must have content or imageUrl" });
    return;
  }

  let linkPreview = null;
  if (content) {
    const url = extractFirstUrl(content);
    if (url) linkPreview = await fetchLinkPreview(url);
  }

  const [msg] = await db.insert(messagesTable).values({
    conversationId,
    senderId: userId,
    content: content ?? null,
    imageUrl: imageUrl ?? null,
    linkPreview: linkPreview ?? null,
    replyToId: replyToId ?? null,
  }).returning();

  await db.update(conversationsTable).set({ updatedAt: new Date() }).where(eq(conversationsTable.id, conversationId));

  const fullMessage = await buildMessage(msg.id);
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

  const fullMessage = await buildMessage(messageId);
  io.to(`conversation:${msg.conversationId}`).emit("message_edited", fullMessage);
  res.json(fullMessage);
});

// DELETE message — hard delete, removes the row entirely
router.delete("/messages/:messageId", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const rawId = Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId;
  const messageId = parseInt(rawId, 10);
  if (isNaN(messageId)) { res.status(400).json({ error: "Invalid message ID" }); return; }

  const [msg] = await db.select().from(messagesTable).where(eq(messagesTable.id, messageId));
  if (!msg) { res.status(404).json({ error: "Message not found" }); return; }
  if (msg.senderId !== userId) { res.status(403).json({ error: "Not authorized" }); return; }

  const conversationId = msg.conversationId;

  // Delete reactions first, then the message
  await db.delete(reactionsTable).where(eq(reactionsTable.messageId, messageId));
  await db.delete(messagesTable).where(eq(messagesTable.id, messageId));

  // Notify all participants: message is gone
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

  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, msg.conversationId));
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }

  // Toggle: if already pinned this message, unpin it
  const newPinnedId = conv.pinnedMessageId === messageId ? null : messageId;
  await db.update(conversationsTable).set({ pinnedMessageId: newPinnedId }).where(eq(conversationsTable.id, msg.conversationId));

  io.to(`conversation:${msg.conversationId}`).emit("message_pinned", {
    conversationId: msg.conversationId,
    pinnedMessageId: newPinnedId,
    messageId,
  });

  res.json({ success: true });
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

  const fullMessage = await buildMessage(messageId);
  if (!fullMessage) { res.status(404).json({ error: "Message not found" }); return; }

  io.to(`conversation:${fullMessage.conversationId}`).emit("message_reaction", fullMessage);
  res.json(fullMessage);
});

export default router;
