import webpush from "web-push";
import { db, pushSubscriptionsTable, usersTable, conversationParticipantsTable } from "@workspace/db";
import { eq, and, ne, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { sendFcmToUsers } from "./fcm";

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
          payloadStr,
          { urgency: 'high', TTL: 60 }
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
 * Send an incoming call push notification to a specific user
 */
export async function notifyIncomingCall(opts: {
  targetUserId: number;
  callerName: string;
  callerAvatar?: string;
  conversationId: number;
  isVideo: boolean;
}): Promise<void> {
  const { targetUserId, callerName, conversationId, isVideo } = opts;
  const title = isVideo ? '📹 Appel vidéo entrant' : '📞 Appel entrant';
  const body = `${callerName} vous appelle — Touchez pour répondre`;
  if (VAPID_PUBLIC && VAPID_PRIVATE) {
    await pushToUser(targetUserId, {
      title, body,
      icon: '/icon-notification.png',
      badge: '/icon-badge.png',
      tag: `call-incoming-${targetUserId}`,
      data: { type: 'incoming_call', conversationId, callerName, isVideo },
    });
  }
  await sendFcmToUsers([targetUserId], {
    title, body,
    tag: `call-incoming-${targetUserId}`,
    data: {
      type: 'incoming_call',
      conversationId: String(conversationId),
      callerName,
      isVideo: isVideo ? '1' : '0',
    },
  });
}

/**
 * Notify all participants of a conversation (except the sender) about a new message
 */
export async function notifyNewMessage(opts: {
  conversationId: number;
  senderId: number;
  senderName: string;
  senderAvatar?: string | null;
  conversationTitle: string | null;
  isGroup: boolean;
  content: string | null;
  imageUrl: string | null;
  // The DB id of the message that JUST got inserted. Forwarded into the
  // FCM `data` payload so the native notification handler can build a
  // "Reply" RemoteInput action AND deep-link the user straight to this
  // exact bubble (with a flash highlight) when they tap the notification.
  messageId: number;
}): Promise<void> {
  const { conversationId, senderId, senderName, senderAvatar, conversationTitle, isGroup, content, imageUrl, messageId } = opts;

  // Get all participants except sender who have NOT muted this conversation
  const participants = await db
    .select({ userId: conversationParticipantsTable.userId })
    .from(conversationParticipantsTable)
    .where(
      and(
        eq(conversationParticipantsTable.conversationId, conversationId),
        ne(conversationParticipantsTable.userId, senderId),
        eq(conversationParticipantsTable.isMuted, false)
      )
    );

  if (participants.length === 0) return;

  const title = isGroup
    ? (conversationTitle ?? "The Legends Online")
    : senderName;

  const body = isGroup
    ? `${senderName} : ${content ? content.slice(0, 80) : imageUrl ? "📷 Photo" : "📎 Pièce jointe"}`
    : content ? content.slice(0, 100) : imageUrl ? "📷 Photo" : "📎 Pièce jointe";

  const webPushPayload = {
    title: title.slice(0, 60),
    body: body.slice(0, 120),
    icon: "/icon-notification.png",
    badge: "/icon-badge.png",
    tag: `conversation-${conversationId}`,
    data: {
      conversationId,
      isGroup,
      messageId,
      senderId,
      senderName: senderName.slice(0, 40),
    },
  };

  if (VAPID_PUBLIC && VAPID_PRIVATE) {
    await Promise.all(participants.map((p) => pushToUser(p.userId, webPushPayload)));
  }

  const fcmData: Record<string, string> = {
    type: "new_message",
    conversationId: String(conversationId),
    conversationTitle: (conversationTitle ?? "").slice(0, 60),
    isGroup: isGroup ? "1" : "0",
    messageId: String(messageId),
    senderId: String(senderId),
    senderName: senderName.slice(0, 40),
  };
  if (senderAvatar && senderAvatar.length < 300) {
    fcmData.senderAvatar = senderAvatar;
  }

  await sendFcmToUsers(
    participants.map((p) => p.userId),
    {
      title: title.slice(0, 60),
      body: body.slice(0, 120),
      tag: `conversation-${conversationId}`,
      data: fcmData,
    }
  );
}
