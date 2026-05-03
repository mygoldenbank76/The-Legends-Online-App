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
  // ── Per-platform delivery strategy ──────────────────────────────────────
  //
  // Android: send a DATA-ONLY message (no top-level `notification`, no
  //   `android.notification`). FcmMessagingService.java intercepts it and
  //   builds a MessagingStyle notification with InboxStyle stacking and an
  //   inline RemoteInput "Reply" action. Letting the system auto-display
  //   the notification via the `notification` field would pre-empt our
  //   custom service and we'd lose all the rich features (per-sender
  //   stacking, RemoteInput, deep link to the exact message). High
  //   priority + the data marker ensure delivery wakes the device.
  //
  // iOS: APNs needs the alert payload — we still pass title/body via aps.
  //
  // Web (browser): no special override needed; the SW push handler reads
  //   data.title / data.body the same way as before.
  const message: admin.messaging.MulticastMessage = {
    tokens,
    data: {
      title: payload.title,
      body: payload.body,
      ...(payload.tag ? { tag: payload.tag } : {}),
      ...(payload.imageUrl ? { imageUrl: payload.imageUrl } : {}),
      ...(payload.data ?? {}),
    },
    android: {
      priority: "high",
      ttl: 60_000,
      // NO `notification` key — we want our FirebaseMessagingService to
      // be the SOLE notification builder so MessagingStyle, stacking
      // and RemoteInput all work as designed.
    },
    apns: {
      headers: { "apns-priority": "10" },
      payload: {
        aps: {
          alert: { title: payload.title, body: payload.body },
          sound: "default",
          "mutable-content": 1,
          ...(payload.tag ? { "thread-id": payload.tag } : {}),
        },
      },
      ...(payload.imageUrl
        ? { fcmOptions: { imageUrl: payload.imageUrl } }
        : {}),
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
