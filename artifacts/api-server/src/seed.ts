import { db, usersTable, conversationsTable, conversationParticipantsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { hashPassword } from "./lib/auth";

const GROUPS = [
  "Discussion générale",
  "Hash Delight",
  "Weed Lounge",
  "Extracts Porn",
  "Food Cosmic",
  "Blends Info",
  "Divertissement",
];

const SEED_USERS = [
  { username: "goldenvibe", displayName: "Golden Vibe", password: "GoldenVibe2025!", isAdmin: true as boolean },
  { username: "alice", displayName: "Alice", password: "password123", isAdmin: false as boolean },
  { username: "bob", displayName: "Bob", password: "password123", isAdmin: false as boolean },
];

export async function runSeed() {
  try {
    // 1. Ensure seed users exist
    const userIds: number[] = [];
    for (const u of SEED_USERS) {
      let [existing] = await db.select().from(usersTable).where(eq(usersTable.username, u.username));
      if (!existing) {
        const hash = await hashPassword(u.password);
        const [created] = await db.insert(usersTable).values({
          username: u.username,
          displayName: u.displayName,
          passwordHash: hash,
          isAdmin: u.isAdmin ?? false,
        }).returning();
        existing = created;
        console.log(`[seed] Created user: ${u.username}`);
      } else {
        // Sync isAdmin for existing seed users
        await db.update(usersTable).set({ isAdmin: u.isAdmin ?? false }).where(eq(usersTable.username, u.username));
      }
      userIds.push(existing.id);
    }

    // 2. Ensure all 7 groups exist (idempotent)
    for (const groupName of GROUPS) {
      const existing = await db.select().from(conversationsTable)
        .where(and(
          eq(conversationsTable.type, "group"),
          eq(conversationsTable.name, groupName)
        ));

      let groupId: number;
      if (existing.length === 0) {
        const [conv] = await db.insert(conversationsTable).values({
          type: "group",
          name: groupName,
        }).returning();
        groupId = conv.id;
        console.log(`[seed] Created group: ${groupName}`);
      } else {
        groupId = existing[0].id;
      }

      // Add ALL existing users as participants (idempotent — covers new registrations too)
      const allUsers = await db.select({ id: usersTable.id }).from(usersTable);
      for (const { id: userId } of allUsers) {
        await db.insert(conversationParticipantsTable).values({
          conversationId: groupId,
          userId,
        }).onConflictDoNothing();
      }
    }

    console.log("[seed] Seed complete");
  } catch (err) {
    console.error("[seed] Error during seed:", err);
  }
}
