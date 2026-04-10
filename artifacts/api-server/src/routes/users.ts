import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, ilike } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

function formatUser(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar,
    isOnline: user.isOnline,
    lastSeen: user.lastSeen?.toISOString() || null,
    createdAt: user.createdAt.toISOString(),
  };
}

router.get("/users/search", requireAuth, async (req, res): Promise<void> => {
  const q = req.query.q as string;
  if (!q || q.trim().length === 0) {
    res.json([]);
    return;
  }

  const users = await db.select().from(usersTable).where(ilike(usersTable.username, `%${q}%`)).limit(20);
  res.json(users.map(formatUser));
});

router.patch("/users/:userId/status", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  const userId = parseInt(rawId, 10);
  if (isNaN(userId)) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }

  const { isOnline } = req.body;
  if (typeof isOnline !== "boolean") {
    res.status(400).json({ error: "isOnline must be a boolean" });
    return;
  }

  const [user] = await db.update(usersTable)
    .set({ isOnline, lastSeen: isOnline ? undefined : new Date() })
    .where(eq(usersTable.id, userId))
    .returning();

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(formatUser(user));
});

export { formatUser };
export default router;
