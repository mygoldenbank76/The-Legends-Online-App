import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, ilike, and, ne, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { signMediaUrl } from "../lib/mediaSigning";

const router: IRouter = Router();

function formatUser(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    // SECURITY: avatars uploaded via /api/uploads/image are stored as
    // /api/uploads/gcs/... URLs and require a signed token to fetch.
    // Profile-photo data: URLs and external URLs pass through unchanged.
    avatar: signMediaUrl(user.avatar),
    bio: user.bio || null,
    isOnline: user.isOnline,
    lastSeen: user.lastSeen?.toISOString() || null,
    createdAt: user.createdAt.toISOString(),
  };
}

// Live count of every registered user. Public (no auth) so the home
// header pill can render before the auth context is hydrated, and so
// the count animates correctly on the very first frame after login.
router.get("/users/count", async (_req, res): Promise<void> => {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usersTable);
  res.json({ count: row?.count ?? 0 });
});

router.get("/users/search", requireAuth, async (req, res): Promise<void> => {
  const q = req.query.q as string;
  if (!q || q.trim().length === 0) { res.json([]); return; }
  const users = await db.select().from(usersTable).where(ilike(usersTable.username, `%${q}%`)).limit(20);
  res.json(users.map(formatUser));
});

router.patch("/users/:userId/status", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  const userId = parseInt(rawId, 10);
  if (isNaN(userId)) { res.status(400).json({ error: "Invalid user ID" }); return; }

  const { isOnline } = req.body;
  if (typeof isOnline !== "boolean") { res.status(400).json({ error: "isOnline must be a boolean" }); return; }

  const [user] = await db.update(usersTable)
    .set({ isOnline, lastSeen: isOnline ? undefined : new Date() })
    .where(eq(usersTable.id, userId))
    .returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json(formatUser(user));
});

// ─── Update own profile ────────────────────────────────────────────────────────
router.patch("/users/me/profile", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).userId as number;
  const { displayName, username, bio, avatar } = req.body as {
    displayName?: string;
    username?: string;
    bio?: string;
    avatar?: string;
  };

  const updates: Partial<typeof usersTable.$inferInsert> = {};

  if (displayName !== undefined) {
    const trimmed = displayName.trim();
    if (trimmed.length === 0 || trimmed.length > 50) {
      res.status(400).json({ error: "Nom affiché invalide (1–50 caractères)" });
      return;
    }
    updates.displayName = trimmed;
  }

  if (username !== undefined) {
    const trimmed = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(trimmed)) {
      res.status(400).json({ error: "Identifiant invalide (3–20 caractères, lettres, chiffres et _ uniquement)" });
      return;
    }
    // Check uniqueness
    const [existing] = await db.select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.username, trimmed), ne(usersTable.id, userId)));
    if (existing) {
      res.status(409).json({ error: "Cet identifiant est déjà utilisé" });
      return;
    }
    updates.username = trimmed;
  }

  if (bio !== undefined) {
    const trimmed = bio.trim();
    if (trimmed.length > 160) {
      res.status(400).json({ error: "Bio trop longue (max 160 caractères)" });
      return;
    }
    updates.bio = trimmed || null;
  }

  if (avatar !== undefined) {
    // Accept base64 data URL or null to remove
    if (avatar !== null && !avatar.startsWith("data:image/")) {
      res.status(400).json({ error: "Format d'image invalide" });
      return;
    }
    updates.avatar = avatar || null;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Aucune modification fournie" });
    return;
  }

  const [user] = await db.update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, userId))
    .returning();

  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  res.json({
    ...formatUser(user),
    isAdmin: user.isAdmin,
    isBanned: user.isBanned,
  });
});

export { formatUser };
export default router;
