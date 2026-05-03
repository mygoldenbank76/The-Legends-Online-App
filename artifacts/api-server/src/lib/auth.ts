import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import * as oidcClient from "openid-client";
import { type Request, type Response, type NextFunction } from "express";

const JWT_SECRET = process.env.SESSION_SECRET || "telechat-secret-key";
const SALT_ROUNDS = 10;
export const ISSUER_URL = process.env.ISSUER_URL ?? "https://replit.com/oidc";

let oidcConfig: oidcClient.Configuration | null = null;

export async function getOidcConfig(): Promise<oidcClient.Configuration> {
  if (!oidcConfig) {
    oidcConfig = await oidcClient.discovery(
      new URL(ISSUER_URL),
      process.env.REPL_ID!,
    );
  }
  return oidcConfig;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(userId: number): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
}

export function verifyToken(token: string): { userId: number } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { userId: number };
  } catch {
    return null;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }
  (req as Request & { userId: number }).userId = payload.userId;
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversation membership guard.
//
// CRITICAL SECURITY HELPER. Every HTTP route that touches per-conversation
// data (messages list/send, mark-read, pin, react, poll vote, conversation
// detail, …) MUST gate access with this. Authentication alone (`requireAuth`)
// only proves the requester is *some* logged-in user — it does NOT prove they
// belong to the conversation they are addressing. Without this guard, any
// authenticated user could read/write any other user's 1-1 or group messages
// simply by passing an arbitrary `conversationId`.
//
// Returns `true` if the user is a participant of the conversation, `false`
// otherwise. Routes should respond with 403 and abort when this returns false.
// We deliberately do NOT distinguish 403 (not-a-member) from 404 (no such
// conversation) so a caller cannot enumerate which conversation IDs exist.
// ─────────────────────────────────────────────────────────────────────────────
export async function isConversationMember(userId: number, conversationId: number): Promise<boolean> {
  if (!Number.isFinite(userId) || !Number.isFinite(conversationId)) return false;
  const { db, conversationParticipantsTable } = await import("@workspace/db");
  const { and, eq } = await import("drizzle-orm");
  const [row] = await db
    .select({ id: conversationParticipantsTable.id })
    .from(conversationParticipantsTable)
    .where(and(
      eq(conversationParticipantsTable.conversationId, conversationId),
      eq(conversationParticipantsTable.userId, userId),
    ))
    .limit(1);
  return !!row;
}

export async function requireAuthAndNotBanned(req: Request, res: Response, next: NextFunction): Promise<void> {
  requireAuth(req, res, async () => {
    const { db, usersTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const userId = (req as Request & { userId: number }).userId;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (user?.isBanned) {
      res.status(403).json({ error: "Your account has been suspended" });
      return;
    }
    next();
  });
}
