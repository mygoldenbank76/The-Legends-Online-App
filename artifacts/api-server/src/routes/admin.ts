import { Router, type IRouter } from "express";
import { db, usersTable, conversationParticipantsTable, messagesTable, reactionsTable, pollVotesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

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
    lastSeen: user.lastSeen?.toISOString() || null,
    createdAt: user.createdAt.toISOString(),
  };
}

router.get("/admin/users", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const users = await db.select().from(usersTable).orderBy(desc(usersTable.createdAt));
  res.json(users.map(formatAdminUser));
});

router.patch("/admin/users/:id/ban", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt(req.params.id, 10);
  if (targetId === (req as any).userId) {
    res.status(400).json({ error: "Cannot ban yourself" });
    return;
  }
  const [user] = await db.update(usersTable)
    .set({ isBanned: true, isOnline: false, lastSeen: new Date() })
    .where(eq(usersTable.id, targetId))
    .returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
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

router.patch("/admin/users/:id/promote", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt(req.params.id, 10);
  const [user] = await db.update(usersTable)
    .set({ isAdmin: true })
    .where(eq(usersTable.id, targetId))
    .returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json(formatAdminUser(user));
});

router.patch("/admin/users/:id/demote", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt(req.params.id, 10);
  if (targetId === (req as any).userId) {
    res.status(400).json({ error: "Cannot demote yourself" });
    return;
  }
  const [user] = await db.update(usersTable)
    .set({ isAdmin: false })
    .where(eq(usersTable.id, targetId))
    .returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json(formatAdminUser(user));
});

router.delete("/admin/users/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt(req.params.id, 10);
  if (targetId === (req as any).userId) {
    res.status(400).json({ error: "Cannot delete yourself" });
    return;
  }
  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, targetId));
  if (!target) { res.status(404).json({ error: "User not found" }); return; }

  try {
    // Delete related records in correct order to avoid FK issues
    await db.delete(reactionsTable).where(eq(reactionsTable.userId, targetId));
    await db.delete(pollVotesTable).where(eq(pollVotesTable.userId, targetId));
    await db.delete(conversationParticipantsTable).where(eq(conversationParticipantsTable.userId, targetId));
    // Soft-delete messages (preserve conversation history)
    await db.update(messagesTable)
      .set({ isDeleted: true, content: null })
      .where(eq(messagesTable.senderId, targetId));
    await db.delete(usersTable).where(eq(usersTable.id, targetId));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Erreur lors de la suppression: " + (err?.message || "inconnue") });
  }
});

export default router;
