import * as oidc from "openid-client";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable, conversationsTable, conversationParticipantsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { hashPassword, verifyPassword, signToken, requireAuth, getOidcConfig } from "../lib/auth";
import { RegisterBody, LoginBody } from "@workspace/api-zod";

const router: IRouter = Router();

function formatUser(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar,
    isOnline: user.isOnline,
    isAdmin: user.isAdmin,
    isBanned: user.isBanned,
    lastSeen: user.lastSeen?.toISOString() || null,
    createdAt: user.createdAt.toISOString(),
  };
}

function getOrigin(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers["host"] || "localhost";
  return `${proto}://${host}`;
}

function setOidcCookie(res: Response, name: string, value: string) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60 * 1000,
  });
}

function getSafeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

async function findOrCreateReplitUser(claims: Record<string, unknown>) {
  const replitId = claims.sub as string;

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.replitId, replitId));
  if (existing) {
    await db.update(usersTable).set({
      displayName: `${claims.first_name || ""} ${claims.last_name || ""}`.trim() || existing.displayName,
      avatar: (claims.profile_image_url || claims.picture || existing.avatar) as string | null,
      isOnline: true,
    }).where(eq(usersTable.id, existing.id));
    return existing;
  }

  const firstName = (claims.first_name as string) || "";
  const lastName = (claims.last_name as string) || "";
  const displayName = `${firstName} ${lastName}`.trim() || "User";
  const baseUsername = `user_${replitId.replace(/[^a-zA-Z0-9]/g, "").substring(0, 16)}`;
  let username = baseUsername;
  let attempt = 0;
  while (true) {
    const [conflict] = await db.select().from(usersTable).where(eq(usersTable.username, username));
    if (!conflict) break;
    attempt++;
    username = `${baseUsername}_${attempt}`;
  }

  const [user] = await db.insert(usersTable).values({
    username,
    displayName,
    passwordHash: null,
    replitId,
    avatar: (claims.profile_image_url || claims.picture || null) as string | null,
    isOnline: true,
  }).returning();

  try {
    const groups = await db.select().from(conversationsTable).where(eq(conversationsTable.type, "group"));
    for (const group of groups) {
      await db.insert(conversationParticipantsTable).values({
        conversationId: group.id,
        userId: user.id,
      }).onConflictDoNothing();
    }
  } catch (_) {}

  return user;
}

router.get("/login", async (req: Request, res: Response) => {
  try {
    const config = await getOidcConfig();
    const callbackUrl = `${getOrigin(req)}/api/callback`;
    const returnTo = getSafeReturnTo(req.query.returnTo);

    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);

    const redirectTo = oidc.buildAuthorizationUrl(config, {
      redirect_uri: callbackUrl,
      scope: "openid email profile offline_access",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      prompt: "login consent",
      state,
      nonce,
    });

    setOidcCookie(res, "oidc_code_verifier", codeVerifier);
    setOidcCookie(res, "oidc_nonce", nonce);
    setOidcCookie(res, "oidc_state", state);
    setOidcCookie(res, "oidc_return_to", returnTo);

    res.redirect(redirectTo.href);
  } catch (err) {
    res.redirect("/");
  }
});

router.get("/callback", async (req: Request, res: Response) => {
  try {
    const config = await getOidcConfig();
    const callbackUrl = `${getOrigin(req)}/api/callback`;

    const codeVerifier = req.cookies?.oidc_code_verifier;
    const nonce = req.cookies?.oidc_nonce;
    const expectedState = req.cookies?.oidc_state;
    const returnTo = getSafeReturnTo(req.cookies?.oidc_return_to);

    res.clearCookie("oidc_code_verifier", { path: "/" });
    res.clearCookie("oidc_nonce", { path: "/" });
    res.clearCookie("oidc_state", { path: "/" });
    res.clearCookie("oidc_return_to", { path: "/" });

    if (!codeVerifier || !expectedState) {
      res.redirect("/login");
      return;
    }

    const currentUrl = new URL(
      `${callbackUrl}?${new URL(req.url, `http://${req.headers.host}`).searchParams}`,
    );

    const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedNonce: nonce,
      expectedState,
      idTokenExpected: true,
    });

    const claims = tokens.claims();
    if (!claims) {
      res.redirect("/login");
      return;
    }

    const user = await findOrCreateReplitUser(claims as unknown as Record<string, unknown>);
    const token = signToken(user.id);

    res.redirect(`${returnTo}?auth_token=${encodeURIComponent(token)}`);
  } catch (err) {
    res.redirect("/login");
  }
});

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { username, displayName, password, avatar } = parsed.data;

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.username, username));
  if (existing) {
    res.status(409).json({ error: "Username already taken" });
    return;
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(usersTable).values({
    username,
    displayName,
    passwordHash,
    avatar: avatar ?? null,
    isOnline: true,
  }).returning();

  try {
    const groups = await db.select().from(conversationsTable).where(eq(conversationsTable.type, "group"));
    for (const group of groups) {
      await db.insert(conversationParticipantsTable).values({
        conversationId: group.id,
        userId: user.id,
      }).onConflictDoNothing();
    }
  } catch (_) {}

  const token = signToken(user.id);
  res.status(201).json({ user: formatUser(user), token });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { username, password } = parsed.data;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username));
  if (!user || !user.passwordHash) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  await db.update(usersTable).set({ isOnline: true }).where(eq(usersTable.id, user.id));

  const token = signToken(user.id);
  res.json({ user: formatUser({ ...user, isOnline: true }), token });
});

router.post("/auth/logout", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  await db.update(usersTable).set({ isOnline: false, lastSeen: new Date() }).where(eq(usersTable.id, userId));
  res.json({ success: true });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  res.json(formatUser(user));
});

export default router;
