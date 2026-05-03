import { Router, type IRouter } from "express";
import { db, pushSubscriptionsTable, deviceTokensTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { VAPID_PUBLIC } from "../lib/pushNotifications";

const router: IRouter = Router();

// GET /push/vapid-key — return public VAPID key
router.get("/push/vapid-key", (_req, res) => {
  if (!VAPID_PUBLIC) {
    res.status(503).json({ error: "Push notifications not configured" });
    return;
  }
  res.json({ publicKey: VAPID_PUBLIC });
});

// POST /push/subscribe — save push subscription
router.post("/push/subscribe", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const { endpoint, keys } = req.body as {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    res.status(400).json({ error: "Invalid subscription object" });
    return;
  }

  // Upsert: if endpoint already exists for this user, update; otherwise insert
  const existing = await db
    .select({ id: pushSubscriptionsTable.id })
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.endpoint, endpoint));

  if (existing.length > 0) {
    await db
      .update(pushSubscriptionsTable)
      .set({ userId, p256dh: keys.p256dh, auth: keys.auth })
      .where(eq(pushSubscriptionsTable.id, existing[0].id));
  } else {
    await db.insert(pushSubscriptionsTable).values({
      userId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
    });
  }

  res.json({ success: true });
});

// DELETE /push/unsubscribe — remove push subscription
router.delete("/push/unsubscribe", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const { endpoint } = req.body as { endpoint: string };

  if (!endpoint) {
    res.status(400).json({ error: "endpoint required" });
    return;
  }

  await db
    .delete(pushSubscriptionsTable)
    .where(
      and(
        eq(pushSubscriptionsTable.userId, userId),
        eq(pushSubscriptionsTable.endpoint, endpoint)
      )
    );

  res.json({ success: true });
});

// POST /push/fcm-register — save an FCM device token (native APK)
router.post("/push/fcm-register", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const { token, platform } = req.body as { token: string; platform?: string };
  if (!token || typeof token !== "string" || token.length < 20 || token.length > 4096) {
    res.status(400).json({ error: "Invalid token" });
    return;
  }
  const safePlatform = (platform === "ios" || platform === "android" || platform === "web") ? platform : "android";
  const now = new Date();

  const existing = await db
    .select({ id: deviceTokensTable.id })
    .from(deviceTokensTable)
    .where(eq(deviceTokensTable.token, token));

  if (existing.length > 0) {
    await db
      .update(deviceTokensTable)
      .set({ userId, platform: safePlatform, updatedAt: now })
      .where(eq(deviceTokensTable.id, existing[0].id));
  } else {
    await db.insert(deviceTokensTable).values({
      userId, token, platform: safePlatform,
    });
  }
  res.json({ success: true });
});

// DELETE /push/fcm-unregister — remove an FCM device token
router.delete("/push/fcm-unregister", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const { token } = req.body as { token: string };
  if (!token) {
    res.status(400).json({ error: "token required" });
    return;
  }
  await db
    .delete(deviceTokensTable)
    .where(and(eq(deviceTokensTable.userId, userId), eq(deviceTokensTable.token, token)));
  res.json({ success: true });
});

export default router;
