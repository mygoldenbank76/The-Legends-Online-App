import { Router, type IRouter } from "express";
import { db, usersTable, conversationsTable, conversationParticipantsTable, messagesTable, reactionsTable } from "@workspace/db";
import { eq, and, inArray, desc, sql, ne } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { formatUser } from "./users";

const router: IRouter = Router();

async function getMessagesWithDetails(messageIds: number[]) {
  if (messageIds.length === 0) return [];
  const msgs = await db.select().from(messagesTable).where(inArray(messagesTable.id, messageIds));
  const senderIds = [...new Set(msgs.map(m => m.senderId))];
  const senders = senderIds.length > 0
    ? await db.select().from(usersTable).where(inArray(usersTable.id, senderIds))
    : [];
  const senderMap = Object.fromEntries(senders.map(s => [s.id, s]));

  const reactions = await db.select().from(reactionsTable).where(inArray(reactionsTable.messageId, messageIds));
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

  return msgs.map(m => ({
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    sender: senderMap[m.senderId] ? formatUser(senderMap[m.senderId]) : undefined,
    content: m.isDeleted ? null : m.content,
    imageUrl: m.isDeleted ? null : m.imageUrl,
    audioUrl: m.isDeleted ? null : m.audioUrl,
    audioDuration: m.isDeleted ? null : m.audioDuration,
    pollId: m.isDeleted ? null : m.pollId,
    isDeleted: m.isDeleted,
    linkPreview: m.isDeleted ? null : (m.linkPreview as { url: string; title?: string; description?: string; image?: string } | null),
    reactions: m.isDeleted ? [] : (reactionsByMessage[m.id] || []).map(r => ({
      id: r.id,
      messageId: r.messageId,
      userId: r.userId,
      emoji: r.emoji,
      user: reactionUserMap[r.userId] ? formatUser(reactionUserMap[r.userId]) : undefined,
      createdAt: r.createdAt.toISOString(),
    })),
    createdAt: m.createdAt.toISOString(),
  }));
}

router.get("/conversations", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;

  const participations = await db.select()
    .from(conversationParticipantsTable)
    .where(eq(conversationParticipantsTable.userId, userId));

  if (participations.length === 0) {
    res.json([]);
    return;
  }

  const conversationIds = participations.map(p => p.conversationId);
  const conversations = await db.select().from(conversationsTable).where(inArray(conversationsTable.id, conversationIds));

  const results = await Promise.all(conversations.map(async (conv) => {
    const allParticipants = await db.select()
      .from(conversationParticipantsTable)
      .where(eq(conversationParticipantsTable.conversationId, conv.id));

    const participantUsers = await db.select()
      .from(usersTable)
      .where(inArray(usersTable.id, allParticipants.map(p => p.userId)));

    const otherParticipant = participantUsers.find(u => u.id !== userId);

    const [lastMessage] = await db.select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, conv.id))
      .orderBy(desc(messagesTable.createdAt))
      .limit(1);

    const myParticipation = participations.find(p => p.conversationId === conv.id);
    const lastReadAt = myParticipation?.lastReadAt;

    const unreadCountResult = await db.select({ count: sql<number>`count(*)::int` })
      .from(messagesTable)
      .where(and(
        eq(messagesTable.conversationId, conv.id),
        lastReadAt ? sql`${messagesTable.createdAt} > ${lastReadAt}` : sql`true`,
        ne(messagesTable.senderId, userId)
      ));

    const unreadCount = unreadCountResult[0]?.count ?? 0;

    let lastMessageFormatted = undefined;
    if (lastMessage) {
      const [formattedMsg] = await getMessagesWithDetails([lastMessage.id]);
      lastMessageFormatted = formattedMsg;
    }

    return {
      id: conv.id,
      type: conv.type,
      name: conv.name,
      otherUser: otherParticipant ? formatUser(otherParticipant) : undefined,
      lastMessage: lastMessageFormatted,
      unreadCount,
      updatedAt: conv.updatedAt.toISOString(),
    };
  }));

  results.sort((a, b) => {
    const aTime = a.lastMessage?.createdAt || a.updatedAt;
    const bTime = b.lastMessage?.createdAt || b.updatedAt;
    return bTime.localeCompare(aTime);
  });

  res.json(results);
});

router.post("/conversations", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const { userId: targetUserId } = req.body as { userId: number };

  if (!targetUserId || typeof targetUserId !== "number") {
    res.status(400).json({ error: "userId is required" });
    return;
  }

  const myConversations = await db.select()
    .from(conversationParticipantsTable)
    .where(eq(conversationParticipantsTable.userId, userId));

  const myConvIds = myConversations.map(p => p.conversationId);

  if (myConvIds.length > 0) {
    const targetConversations = await db.select()
      .from(conversationParticipantsTable)
      .where(and(
        eq(conversationParticipantsTable.userId, targetUserId),
        inArray(conversationParticipantsTable.conversationId, myConvIds)
      ));

    if (targetConversations.length > 0) {
      const existingConvId = targetConversations[0].conversationId;
      const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, existingConvId));
      if (conv && conv.type === "direct") {
        const participants = await db.select()
          .from(conversationParticipantsTable)
          .where(eq(conversationParticipantsTable.conversationId, conv.id));
        const participantUsers = await db.select()
          .from(usersTable)
          .where(inArray(usersTable.id, participants.map(p => p.userId)));
        res.json({ ...conv, participants: participantUsers.map(formatUser), createdAt: conv.createdAt.toISOString() });
        return;
      }
    }
  }

  const [newConv] = await db.insert(conversationsTable).values({ type: "direct" }).returning();
  await db.insert(conversationParticipantsTable).values([
    { conversationId: newConv.id, userId },
    { conversationId: newConv.id, userId: targetUserId },
  ]);

  const participantUsers = await db.select()
    .from(usersTable)
    .where(inArray(usersTable.id, [userId, targetUserId]));

  res.json({ ...newConv, participants: participantUsers.map(formatUser), createdAt: newConv.createdAt.toISOString() });
});

router.get("/conversations/:conversationId", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.conversationId) ? req.params.conversationId[0] : req.params.conversationId;
  const conversationId = parseInt(rawId, 10);
  if (isNaN(conversationId)) {
    res.status(400).json({ error: "Invalid conversation ID" });
    return;
  }

  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId));
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const participants = await db.select()
    .from(conversationParticipantsTable)
    .where(eq(conversationParticipantsTable.conversationId, conversationId));

  const participantUsers = await db.select()
    .from(usersTable)
    .where(inArray(usersTable.id, participants.map(p => p.userId)));

  res.json({
    ...conv,
    participants: participantUsers.map(formatUser),
    createdAt: conv.createdAt.toISOString(),
  });
});

export default router;
export { getMessagesWithDetails };
