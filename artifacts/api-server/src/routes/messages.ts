import { Router, type IRouter } from "express";
import { db, usersTable, messagesTable, reactionsTable, conversationParticipantsTable, conversationsTable } from "@workspace/db";
import { eq, and, lt, desc, inArray, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { formatUser } from "./users";
import { extractFirstUrl, fetchLinkPreview } from "../lib/linkPreview";
import { io } from "../app";

const router: IRouter = Router();

async function buildMessage(messageId: number) {
  const [msg] = await db.select().from(messagesTable).where(eq(messagesTable.id, messageId));
  if (!msg) return null;

  const [sender] = await db.select().from(usersTable).where(eq(usersTable.id, msg.senderId));
  const reactions = await db.select().from(reactionsTable).where(eq(reactionsTable.messageId, msg.id));
  const reactionUserIds = [...new Set(reactions.map(r => r.userId))];
  const reactionUsers = reactionUserIds.length > 0
    ? await db.select().from(usersTable).where(inArray(usersTable.id, reactionUserIds))
    : [];
  const reactionUserMap = Object.fromEntries(reactionUsers.map(u => [u.id, u]));

  return {
    id: msg.id,
    conversationId: msg.conversationId,
    senderId: msg.senderId,
    sender: sender ? formatUser(sender) : undefined,
    content: msg.content,
    imageUrl: msg.imageUrl,
    linkPreview: msg.linkPreview as { url: string; title?: string; description?: string; image?: string } | null,
    reactions: reactions.map(r => ({
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

router.get("/conversations/:conversationId/messages", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.conversationId) ? req.params.conversationId[0] : req.params.conversationId;
  const conversationId = parseInt(rawId, 10);
  if (isNaN(conversationId)) {
    res.status(400).json({ error: "Invalid conversation ID" });
    return;
  }

  const limit = Math.min(parseInt(req.query.limit as string || "50", 10), 100);
  const before = req.query.before ? parseInt(req.query.before as string, 10) : undefined;

  const conditions = [eq(messagesTable.conversationId, conversationId)];
  if (before && !isNaN(before)) {
    conditions.push(lt(messagesTable.id, before));
  }

  const msgs = await db.select()
    .from(messagesTable)
    .where(and(...conditions))
    .orderBy(desc(messagesTable.createdAt))
    .limit(limit);

  msgs.reverse();

  const senderIds = [...new Set(msgs.map(m => m.senderId))];
  const senders = senderIds.length > 0
    ? await db.select().from(usersTable).where(inArray(usersTable.id, senderIds))
    : [];
  const senderMap = Object.fromEntries(senders.map(s => [s.id, s]));

  const msgIds = msgs.map(m => m.id);
  const reactions = msgIds.length > 0
    ? await db.select().from(reactionsTable).where(inArray(reactionsTable.messageId, msgIds))
    : [];
  const reactionUserIds = [...new Set(reactions.map(r => r.userId))];
  const reactionUsers = reactionUserIds.length > 0
    ? await db.select().from(usersTable).where(inArray(usersTable.id, reactionUserIds))
    : [];
  const reactionUserMap = Object.fromEntries(reactionUsers.map(u => [u.id, u]));
  const reactionsByMessage: Record<number, typeof reactions> = {};
  for (const r of reactions) {
    if (!reactionsByMessage[r.messageId]) reactionsByMessage[r.messageId] = [];
    reactionsByMessage[r.messageId].push(r);
  }

  const formatted = msgs.map(m => ({
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    sender: senderMap[m.senderId] ? formatUser(senderMap[m.senderId]) : undefined,
    content: m.content,
    imageUrl: m.imageUrl,
    linkPreview: m.linkPreview as { url: string; title?: string; description?: string; image?: string } | null,
    reactions: (reactionsByMessage[m.id] || []).map(r => ({
      id: r.id,
      messageId: r.messageId,
      userId: r.userId,
      emoji: r.emoji,
      user: reactionUserMap[r.userId] ? formatUser(reactionUserMap[r.userId]) : undefined,
      createdAt: r.createdAt.toISOString(),
    })),
    createdAt: m.createdAt.toISOString(),
  }));

  res.json(formatted);
});

router.post("/conversations/:conversationId/messages", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const rawId = Array.isArray(req.params.conversationId) ? req.params.conversationId[0] : req.params.conversationId;
  const conversationId = parseInt(rawId, 10);
  if (isNaN(conversationId)) {
    res.status(400).json({ error: "Invalid conversation ID" });
    return;
  }

  const { content, imageUrl } = req.body as { content?: string; imageUrl?: string };

  if (content == null && imageUrl == null) {
    res.status(400).json({ error: "Message must have content or imageUrl" });
    return;
  }

  let linkPreview = null;
  if (content) {
    const url = extractFirstUrl(content);
    if (url) {
      linkPreview = await fetchLinkPreview(url);
    }
  }

  const [msg] = await db.insert(messagesTable).values({
    conversationId,
    senderId: userId,
    content: content ?? null,
    imageUrl: imageUrl ?? null,
    linkPreview: linkPreview ?? null,
  }).returning();

  await db.update(conversationsTable)
    .set({ updatedAt: new Date() })
    .where(eq(conversationsTable.id, conversationId));

  const fullMessage = await buildMessage(msg.id);

  io.to(`conversation:${conversationId}`).emit("new_message", fullMessage);

  res.status(201).json(fullMessage);
});

router.post("/conversations/:conversationId/read", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const rawId = Array.isArray(req.params.conversationId) ? req.params.conversationId[0] : req.params.conversationId;
  const conversationId = parseInt(rawId, 10);
  if (isNaN(conversationId)) {
    res.status(400).json({ error: "Invalid conversation ID" });
    return;
  }

  await db.update(conversationParticipantsTable)
    .set({ lastReadAt: new Date() })
    .where(and(
      eq(conversationParticipantsTable.conversationId, conversationId),
      eq(conversationParticipantsTable.userId, userId)
    ));

  res.json({ success: true });
});

router.post("/messages/:messageId/reactions", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const rawId = Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId;
  const messageId = parseInt(rawId, 10);
  if (isNaN(messageId)) {
    res.status(400).json({ error: "Invalid message ID" });
    return;
  }

  const { emoji } = req.body as { emoji: string };
  if (!emoji) {
    res.status(400).json({ error: "emoji is required" });
    return;
  }

  const [existing] = await db.select()
    .from(reactionsTable)
    .where(and(
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
  if (!fullMessage) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  io.to(`conversation:${fullMessage.conversationId}`).emit("message_reaction", fullMessage);

  res.json(fullMessage);
});

export default router;
