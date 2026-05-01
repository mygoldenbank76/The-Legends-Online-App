import { Router, type IRouter } from "express";
import { db, usersTable, contactsTable } from "@workspace/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

function formatUser(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar,
    bio: user.bio || null,
    isOnline: user.isOnline,
    lastSeen: user.lastSeen?.toISOString() || null,
    createdAt: user.createdAt.toISOString(),
  };
}

// GET /contacts — list current user's contacts (sorted by most recently added)
router.get("/contacts", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;

  const rows = await db
    .select()
    .from(contactsTable)
    .where(eq(contactsTable.ownerId, userId))
    .orderBy(desc(contactsTable.addedAt));

  if (rows.length === 0) {
    res.json([]);
    return;
  }

  const ids = rows.map((r) => r.contactUserId);
  const users = await db.select().from(usersTable).where(inArray(usersTable.id, ids));
  const byId = new Map(users.map((u) => [u.id, u]));
  res.json(rows.map((r) => byId.get(r.contactUserId)).filter((u) => u !== undefined).map(formatUser));
});

// POST /contacts — add a contact by username
const addContactSchema = z.object({
  username: z.string().min(1).max(64),
});

router.post("/contacts", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;

  const parsed = addContactSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }

  const username = parsed.data.username.trim();
  if (!username) {
    res.status(400).json({ error: "Identifiant requis" });
    return;
  }

  const [target] = await db.select().from(usersTable).where(eq(usersTable.username, username));
  if (!target) {
    res.status(404).json({ error: "Utilisateur introuvable" });
    return;
  }

  if (target.id === userId) {
    res.status(400).json({ error: "Vous ne pouvez pas vous ajouter vous-même" });
    return;
  }

  // Idempotent, concurrency-safe insert. .returning() yields the row when
  // newly inserted and an empty array when the conflict clause skipped it.
  const inserted = await db
    .insert(contactsTable)
    .values({ ownerId: userId, contactUserId: target.id })
    .onConflictDoNothing()
    .returning();

  res.status(inserted.length > 0 ? 201 : 200).json(formatUser(target));
});

// DELETE /contacts/:userId — remove a contact
router.delete("/contacts/:userId", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const targetId = parseInt(req.params.userId, 10);
  if (isNaN(targetId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  await db
    .delete(contactsTable)
    .where(and(eq(contactsTable.ownerId, userId), eq(contactsTable.contactUserId, targetId)));

  res.json({ success: true });
});

export default router;
