import webpush from "web-push";
import { db, pushSubscriptionsTable, usersTable, conversationParticipantsTable } from "@workspace/db";
import { eq, and, ne, inArray } from "drizzle-orm";
import { logger } from "./logger";

// Initialise web-push with VAPID keys
const VAPID_PUBLIC = process.env["VAPID_PUBLIC_KEY"]!;
const VAPID_PRIVATE = process.env["VAPID_PRIVATE_KEY"]!;
const VAPID_EMAIL = process.env["VAPID_EMAIL"] ?? "mailto:admin@thelegendsonline.com";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
}

export { VAPID_PUBLIC };

/**
 * Send a push notification to all subscribers of a given user
 */
async function pushToUser(userId: number, payload: object): Promise<void> {
  const subs = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.userId, userId));

  const payloadStr = JSON.stringify(payload);

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payloadStr
        );
      } catch (err: any) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          // Subscription expired — remove it
          await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, sub.id));
        } else {
          logger.warn({ err, userId, endpoint: sub.endpoint }, "Push notification failed");
        }
      }
    })
  );
}

/**
 * Notify all participants of a conversation (except the sender) about a new message
 */
export async function notifyNewMessage(opts: {
  conversationId: number;
  senderId: number;
  senderName: string;
  conversationTitle: string | null;
  isGroup: boolean;
  content: string | null;
  imageUrl: string | null;
}): Promise<void> {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;

  const { conversationId, senderId, senderName, conversationTitle, isGroup, content, imageUrl } = opts;

  // Get all participants except sender
  const participants = await db
    .select({ userId: conversationParticipantsTable.userId })
    .from(conversationParticipantsTable)
    .where(
      and(
        eq(conversationParticipantsTable.conversationId, conversationId),
        ne(conversationParticipantsTable.userId, senderId)
      )
    );

  if (participants.length === 0) return;

  const title = isGroup
    ? (conversationTitle ?? "The Legends Online")
    : `The Legends Online`;

  const body = isGroup
    ? `${senderName} : ${content ? content.slice(0, 80) : imageUrl ? "📷 Photo" : "📎 Pièce jointe"}`
    : content ? content.slice(0, 100) : imageUrl ? "📷 Photo" : "📎 Pièce jointe";

  const payload = {
    title,
    body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: `conversation-${conversationId}`,
    data: { conversationId },
  };

  await Promise.all(participants.map((p) => pushToUser(p.userId, payload)));
}
