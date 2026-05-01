import { Router, type IRouter } from "express";
import { db, usersTable, conversationsTable, conversationParticipantsTable, messagesTable, reactionsTable, conversationPinsTable } from "@workspace/db";
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
      isMuted: myParticipation?.isMuted ?? false,
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
    const sharedConvIds = (await db.select()
      .from(conversationParticipantsTable)
      .where(and(
        eq(conversationParticipantsTable.userId, targetUserId),
        inArray(conversationParticipantsTable.conversationId, myConvIds)
      ))).map(p => p.conversationId);

    if (sharedConvIds.length > 0) {
      // Find the first direct conversation among all shared conversations
      const [existingDM] = await db.select()
        .from(conversationsTable)
        .where(and(
          inArray(conversationsTable.id, sharedConvIds),
          eq(conversationsTable.type, "direct")
        ))
        .limit(1);

      if (existingDM) {
        const participants = await db.select()
          .from(conversationParticipantsTable)
          .where(eq(conversationParticipantsTable.conversationId, existingDM.id));
        const participantUsers = await db.select()
          .from(usersTable)
          .where(inArray(usersTable.id, participants.map(p => p.userId)));
        res.json({ ...existingDM, participants: participantUsers.map(formatUser), createdAt: existingDM.createdAt.toISOString() });
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

router.delete("/conversations/:conversationId", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const rawId = Array.isArray(req.params.conversationId) ? req.params.conversationId[0] : req.params.conversationId;
  const conversationId = parseInt(rawId, 10);
  if (isNaN(conversationId)) {
    res.status(400).json({ error: "Invalid conversation ID" });
    return;
  }

  const [participation] = await db.select()
    .from(conversationParticipantsTable)
    .where(and(
      eq(conversationParticipantsTable.conversationId, conversationId),
      eq(conversationParticipantsTable.userId, userId)
    ));
  if (!participation) {
    res.status(403).json({ error: "Not a participant" });
    return;
  }

  await db.delete(conversationParticipantsTable)
    .where(and(
      eq(conversationParticipantsTable.conversationId, conversationId),
      eq(conversationParticipantsTable.userId, userId)
    ));

  const remaining = await db.select()
    .from(conversationParticipantsTable)
    .where(eq(conversationParticipantsTable.conversationId, conversationId));

  if (remaining.length === 0) {
    const msgIds = (await db.select({ id: messagesTable.id })
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, conversationId)))
      .map(m => m.id);
    if (msgIds.length > 0) {
      await db.delete(reactionsTable).where(inArray(reactionsTable.messageId, msgIds));
    }
    await db.delete(messagesTable).where(eq(messagesTable.conversationId, conversationId));
    await db.delete(conversationPinsTable).where(eq(conversationPinsTable.conversationId, conversationId));
    await db.delete(conversationsTable).where(eq(conversationsTable.id, conversationId));
  }

  res.json({ ok: true });
});

router.get("/conversations/:conversationId", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
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

  const pins = await db.select()
    .from(conversationPinsTable)
    .where(eq(conversationPinsTable.conversationId, conversationId))
    .orderBy(conversationPinsTable.pinnedAt);

  // isMuted for the current user
  const myParticipant = participants.find(p => p.userId === userId);
  const isMuted = myParticipant?.isMuted ?? false;

  res.json({
    ...conv,
    participants: participantUsers.map(formatUser),
    pinnedMessageIds: pins.map(p => p.messageId),
    isMuted,
    createdAt: conv.createdAt.toISOString(),
  });
});

// PATCH /conversations/:id/mute — toggle mute for current user
router.patch("/:id/mute", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const conversationId = parseInt(req.params.id, 10);
  const { muted } = req.body as { muted: boolean };

  if (typeof muted !== 'boolean') {
    res.status(400).json({ error: 'muted (boolean) required' });
    return;
  }

  const participant = await db
    .select()
    .from(conversationParticipantsTable)
    .where(
      and(
        eq(conversationParticipantsTable.conversationId, conversationId),
        eq(conversationParticipantsTable.userId, userId)
      )
    )
    .limit(1);

  if (participant.length === 0) {
    res.status(403).json({ error: 'Not a participant' });
    return;
  }

  await db
    .update(conversationParticipantsTable)
    .set({ isMuted: muted })
    .where(eq(conversationParticipantsTable.id, participant[0].id));

  res.json({ success: true, muted });
});

// POST /conversations/:conversationId/participants — add one or more users to a group
// Requires the caller to already be a participant of the group.
router.post("/conversations/:conversationId/participants", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const rawId = req.params.conversationId;
  const conversationId = parseInt(typeof rawId === "string" ? rawId : "", 10);
  if (isNaN(conversationId)) {
    res.status(400).json({ error: "Invalid conversation id" });
    return;
  }

  const rawIds = (req.body?.userIds ?? []) as unknown;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    res.status(400).json({ error: "userIds (non-empty number[]) required" });
    return;
  }
  const userIds = rawIds
    .map((v) => (typeof v === "number" ? v : parseInt(String(v), 10)))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (userIds.length === 0) {
    res.status(400).json({ error: "userIds must contain valid positive numbers" });
    return;
  }

  // Conversation must exist and be a group
  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId));
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  if (conv.type !== "group") {
    res.status(400).json({ error: "Cannot add participants to a non-group conversation" });
    return;
  }

  // Caller must already be a participant
  const myMembership = await db
    .select()
    .from(conversationParticipantsTable)
    .where(
      and(
        eq(conversationParticipantsTable.conversationId, conversationId),
        eq(conversationParticipantsTable.userId, userId),
      ),
    )
    .limit(1);
  if (myMembership.length === 0) {
    res.status(403).json({ error: "Not a participant" });
    return;
  }

  // Filter out users who are already participants
  const existing = await db
    .select({ userId: conversationParticipantsTable.userId })
    .from(conversationParticipantsTable)
    .where(
      and(
        eq(conversationParticipantsTable.conversationId, conversationId),
        inArray(conversationParticipantsTable.userId, userIds),
      ),
    );
  const existingSet = new Set(existing.map((r) => r.userId));
  const toAdd = userIds.filter((id) => !existingSet.has(id));

  // Verify the new users actually exist
  let validNewIds: number[] = [];
  if (toAdd.length > 0) {
    const validUsers = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(inArray(usersTable.id, toAdd));
    validNewIds = validUsers.map((u) => u.id);

    if (validNewIds.length > 0) {
      await db
        .insert(conversationParticipantsTable)
        .values(validNewIds.map((uid) => ({ conversationId, userId: uid })));
    }
  }

  res.json({
    added: validNewIds,
    skipped: userIds.filter((id) => existingSet.has(id)),
  });
});

export default router;
export { getMessagesWithDetails };
