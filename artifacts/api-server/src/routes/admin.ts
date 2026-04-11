import { Router, type IRouter } from "express";
import {
  db, usersTable, conversationParticipantsTable, messagesTable,
  reactionsTable, pollVotesTable, conversationsTable,
} from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireAuth, hashPassword } from "../lib/auth";
import { io } from "../app";

const router: IRouter = Router();

async function requireAdmin(req: any, res: any, next: any): Promise<void> {
  const userId = (req as any).userId;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user || !user.isAdmin) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

function formatAdminUser(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar,
    isOnline: user.isOnline,
    isBanned: user.isBanned,
    isAdmin: user.isAdmin,
    hasReplit: !!user.replitId,
    hasPassword: !!user.passwordHash,
    lastSeen: user.lastSeen?.toISOString() || null,
    createdAt: user.createdAt.toISOString(),
  };
}

// ─── User list ───────────────────────────────────────────────────────────────
router.get("/admin/users", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const users = await db.select().from(usersTable).orderBy(desc(usersTable.createdAt));
  res.json(users.map(formatAdminUser));
});

// ─── User details ────────────────────────────────────────────────────────────
router.get("/admin/users/:id/details", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt(req.params.id, 10);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, targetId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({
    ...formatAdminUser(user),
    replitId: user.replitId || null,
  });
});

// ─── Change password ─────────────────────────────────────────────────────────
router.patch("/admin/users/:id/password", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt(req.params.id, 10);
  const { newPassword } = req.body as { newPassword?: string };
  if (!newPassword || newPassword.trim().length < 4) {
    res.status(400).json({ error: "Mot de passe trop court (min 4 caractères)" });
    return;
  }
  const hashed = await hashPassword(newPassword.trim());
  const [user] = await db.update(usersTable)
    .set({ passwordHash: hashed })
    .where(eq(usersTable.id, targetId))
    .returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ success: true });
});

// ─── Ban / Unban ──────────────────────────────────────────────────────────────
router.patch("/admin/users/:id/ban", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt(req.params.id, 10);
  if (targetId === (req as any).userId) { res.status(400).json({ error: "Cannot ban yourself" }); return; }
  const [user] = await db.update(usersTable)
    .set({ isBanned: true, isOnline: false, lastSeen: new Date() })
    .where(eq(usersTable.id, targetId))
    .returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  io.to(`user:${targetId}`).emit("banned");
  res.json(formatAdminUser(user));
});

router.patch("/admin/users/:id/unban", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt(req.params.id, 10);
  const [user] = await db.update(usersTable)
    .set({ isBanned: false })
    .where(eq(usersTable.id, targetId))
    .returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json(formatAdminUser(user));
});

// ─── Promote / Demote ────────────────────────────────────────────────────────
router.patch("/admin/users/:id/promote", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt(req.params.id, 10);
  const [user] = await db.update(usersTable).set({ isAdmin: true }).where(eq(usersTable.id, targetId)).returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json(formatAdminUser(user));
});

router.patch("/admin/users/:id/demote", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt(req.params.id, 10);
  if (targetId === (req as any).userId) { res.status(400).json({ error: "Cannot demote yourself" }); return; }
  const [user] = await db.update(usersTable).set({ isAdmin: false }).where(eq(usersTable.id, targetId)).returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json(formatAdminUser(user));
});

// ─── Send DM to user (as admin) ───────────────────────────────────────────────
router.post("/admin/users/:id/dm", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const adminId = (req as any).userId;
  const targetId = parseInt(req.params.id, 10);
  const { content } = req.body as { content?: string };
  if (!content?.trim()) { res.status(400).json({ error: "Message vide" }); return; }
  if (targetId === adminId) { res.status(400).json({ error: "Cannot DM yourself" }); return; }

  const adminConvs = await db.select().from(conversationParticipantsTable).where(eq(conversationParticipantsTable.userId, adminId));
  const adminConvIds = adminConvs.map(p => p.conversationId);
  let conversationId: number | null = null;

  if (adminConvIds.length > 0) {
    const targetConvs = await db.select().from(conversationParticipantsTable)
      .where(and(eq(conversationParticipantsTable.userId, targetId), inArray(conversationParticipantsTable.conversationId, adminConvIds)));
    for (const tc of targetConvs) {
      const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, tc.conversationId));
      if (conv?.type === "direct") { conversationId = conv.id; break; }
    }
  }

  if (!conversationId) {
    const [newConv] = await db.insert(conversationsTable).values({ type: "direct" }).returning();
    await db.insert(conversationParticipantsTable).values([
      { conversationId: newConv.id, userId: adminId },
      { conversationId: newConv.id, userId: targetId },
    ]);
    conversationId = newConv.id;
  }

  const [msg] = await db.insert(messagesTable).values({
    conversationId,
    senderId: adminId,
    content: content.trim(),
  }).returning();

  io.to(`conversation:${conversationId}`).emit("new_message", { conversationId, messageId: msg.id });
  res.json({ success: true, conversationId, messageId: msg.id });
});

// ─── Delete user ──────────────────────────────────────────────────────────────
router.delete("/admin/users/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt(req.params.id, 10);
  if (targetId === (req as any).userId) { res.status(400).json({ error: "Cannot delete yourself" }); return; }
  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, targetId));
  if (!target) { res.status(404).json({ error: "User not found" }); return; }
  try {
    await db.delete(reactionsTable).where(eq(reactionsTable.userId, targetId));
    await db.delete(pollVotesTable).where(eq(pollVotesTable.userId, targetId));
    await db.delete(conversationParticipantsTable).where(eq(conversationParticipantsTable.userId, targetId));
    await db.update(messagesTable).set({ isDeleted: true, content: null }).where(eq(messagesTable.senderId, targetId));
    await db.delete(usersTable).where(eq(usersTable.id, targetId));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Erreur lors de la suppression: " + (err?.message || "inconnue") });
  }
});

// ─── Surveillance: all DM messages ───────────────────────────────────────────
router.get("/admin/surveillance", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const page = Math.max(1, parseInt(req.query.page as string || "1", 10));
  const search = ((req.query.search as string) || "").toLowerCase().trim();
  const PER_PAGE = 40;

  const directConvs = await db.select().from(conversationsTable).where(eq(conversationsTable.type, "direct"));
  const directConvIds = directConvs.map(c => c.id);

  if (directConvIds.length === 0) {
    res.json({ messages: [], total: 0, page, perPage: PER_PAGE });
    return;
  }

  const allMessages = await db.select().from(messagesTable)
    .where(and(inArray(messagesTable.conversationId, directConvIds), eq(messagesTable.isDeleted, false)))
    .orderBy(desc(messagesTable.createdAt))
    .limit(500);

  const senderIds = [...new Set(allMessages.map(m => m.senderId))];
  const convIds = [...new Set(allMessages.map(m => m.conversationId))];

  const participants = convIds.length > 0
    ? await db.select().from(conversationParticipantsTable).where(inArray(conversationParticipantsTable.conversationId, convIds))
    : [];

  const userIds = [...new Set([...senderIds, ...participants.map(p => p.userId)])];
  const users = userIds.length > 0
    ? await db.select({ id: usersTable.id, username: usersTable.username, displayName: usersTable.displayName })
        .from(usersTable).where(inArray(usersTable.id, userIds))
    : [];
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));

  const participantsByConv: Record<number, { id: number; username: string; displayName: string }[]> = {};
  for (const p of participants) {
    if (!participantsByConv[p.conversationId]) participantsByConv[p.conversationId] = [];
    const u = userMap[p.userId];
    if (u && !participantsByConv[p.conversationId].find(x => x.id === u.id)) {
      participantsByConv[p.conversationId].push(u);
    }
  }

  const formatted = allMessages.map(msg => ({
    id: msg.id,
    conversationId: msg.conversationId,
    content: msg.content,
    imageUrl: msg.imageUrl,
    audioUrl: !!msg.audioUrl,
    sender: userMap[msg.senderId] || null,
    participants: participantsByConv[msg.conversationId] || [],
    createdAt: msg.createdAt.toISOString(),
  }));

  const filtered = search
    ? formatted.filter(m =>
        m.content?.toLowerCase().includes(search) ||
        m.sender?.displayName.toLowerCase().includes(search) ||
        m.sender?.username.toLowerCase().includes(search) ||
        m.participants.some(p => p.displayName.toLowerCase().includes(search) || p.username.toLowerCase().includes(search))
      )
    : formatted;

  const total = filtered.length;
  const paged = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  res.json({ messages: paged, total, page, perPage: PER_PAGE });
});

export default router;
