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
