import admin from "firebase-admin";
import { db, deviceTokensTable } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";
import { logger } from "./logger";

let initialized = false;
let initError: string | null = null;

function init(): boolean {
  if (initialized) return true;
  if (initError) return false;
  const raw = process.env["FIREBASE_SERVICE_ACCOUNT"];
  if (!raw) {
    initError = "missing FIREBASE_SERVICE_ACCOUNT";
    logger.warn("FCM disabled: FIREBASE_SERVICE_ACCOUNT not set");
    return false;
  }
  try {
    const credentials = JSON.parse(raw);
    admin.initializeApp({
      credential: admin.credential.cert(credentials),
    });
    initialized = true;
    logger.info({ projectId: credentials.project_id }, "FCM initialised");
    return true;
  } catch (err) {
    initError = String(err);
    logger.error({ err }, "FCM init failed");
    return false;
  }
}

export interface FcmPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  tag?: string;
  imageUrl?: string;
}

/**
 * Send an FCM notification to all device tokens belonging to the given user IDs.
 * Stale tokens (Unregistered / InvalidArgument) are pruned automatically.
 */
export async function sendFcmToUsers(userIds: number[], payload: FcmPayload): Promise<void> {
  if (!init()) return;
  if (userIds.length === 0) return;

  const rows = await db
    .select({ id: deviceTokensTable.id, token: deviceTokensTable.token })
    .from(deviceTokensTable)
    .where(inArray(deviceTokensTable.userId, userIds));

  if (rows.length === 0) return;

  const tokens = rows.map((r) => r.token);

  // Build a data-only payload so the Capacitor PushNotifications plugin can
  // display it natively even when the app is fully closed. We include
  // `notification` too so the OS draws a system notification automatically
  // when the app process is dead — this is the key to "wakes up the device
  // even when APK is closed".
  const message: admin.messaging.MulticastMessage = {
    tokens,
    notification: {
      title: payload.title,
      body: payload.body,
      ...(payload.imageUrl ? { imageUrl: payload.imageUrl } : {}),
    },
    data: {
      title: payload.title,
      body: payload.body,
      ...(payload.tag ? { tag: payload.tag } : {}),
      ...(payload.data ?? {}),
    },
    android: {
      priority: "high",
      ttl: 60_000,
      notification: {
        channelId: "messages",
        sound: "default",
        ...(payload.tag ? { tag: payload.tag } : {}),
        defaultSound: true,
        defaultVibrateTimings: true,
      },
    },
    apns: {
      headers: { "apns-priority": "10" },
      payload: { aps: { sound: "default", "mutable-content": 1 } },
    },
  };

  try {
    const resp = await admin.messaging().sendEachForMulticast(message);
    if (resp.failureCount > 0) {
      const stale: number[] = [];
      resp.responses.forEach((r, idx) => {
        if (!r.success && r.error) {
          const code = r.error.code;
          if (
            code === "messaging/registration-token-not-registered" ||
            code === "messaging/invalid-registration-token" ||
            code === "messaging/invalid-argument"
          ) {
            stale.push(rows[idx].id);
          } else {
            logger.warn({ code, msg: r.error.message }, "FCM send failure");
          }
        }
      });
      if (stale.length > 0) {
        await db.delete(deviceTokensTable).where(inArray(deviceTokensTable.id, stale));
        logger.info({ count: stale.length }, "Pruned stale FCM tokens");
      }
    }
  } catch (err) {
    logger.error({ err }, "FCM multicast send failed");
  }
}

/**
 * Remove a single token (called when client unregisters or detects revoke).
 */
export async function deleteFcmToken(userId: number, token: string): Promise<void> {
  await db
    .delete(deviceTokensTable)
    .where(eq(deviceTokensTable.token, token));
  void userId;
}
