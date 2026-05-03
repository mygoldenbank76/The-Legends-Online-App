import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { verifyToken, isConversationMember } from "./lib/auth";
import { db, messagesTable, conversationParticipantsTable, usersTable } from "@workspace/db";
import { eq, and, ne, gt } from "drizzle-orm";
import { notifyIncomingCall } from "./lib/pushNotifications";

const app: Express = express();
export const httpServer = createServer(app);

export const io = new SocketIOServer(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  path: "/socket.io",
});

// userId -> Set of socketIds (to emit to a specific user)
export const userSockets = new Map<number, Set<string>>();
// conversationId -> (userId -> number of *sockets* this user has actively
// viewing the room). A user counts as "present" when their count > 0, so
// closing one tab while another is still open does NOT remove them.
const roomPresence = new Map<number, Map<number, number>>();
// Helper for other modules (e.g. read receipts) — returns the set of userIds
// currently present in a conversation room.
export function getRoomMembers(conversationId: number): Set<number> {
  const m = roomPresence.get(conversationId);
  return m ? new Set(m.keys()) : new Set();
}

// ── Call tracking (for WhatsApp-style call log bubbles) ──────────────────────
type ActiveCall = {
  conversationId: number;
  callerId: number;
  calleeId: number;
  isVideo: boolean;
  startedAt: number;
  answeredAt?: number;
  missedTimer?: NodeJS.Timeout;
};
const activeCalls = new Map<string, ActiveCall>();
const callKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
const RING_TIMEOUT_MS = 45_000;

function formatUserBasic(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id, username: u.username, displayName: u.displayName,
    avatar: u.avatar, bio: u.bio || null, isOnline: u.isOnline,
    lastSeen: u.lastSeen?.toISOString() || null,
    createdAt: u.createdAt.toISOString(),
  };
}

async function logCallMessage(opts: {
  conversationId: number;
  senderId: number; // always the caller
  callType: 'audio' | 'video';
  callStatus: 'answered' | 'missed' | 'declined';
  callDuration?: number;
}) {
  try {
    const [msg] = await db.insert(messagesTable).values({
      conversationId: opts.conversationId,
      senderId: opts.senderId,
      callType: opts.callType,
      callStatus: opts.callStatus,
      callDuration: opts.callDuration ?? null,
    }).returning();

    const [sender] = await db.select().from(usersTable).where(eq(usersTable.id, opts.senderId));

    const payload = {
      id: msg.id,
      conversationId: msg.conversationId,
      senderId: msg.senderId,
      sender: sender ? formatUserBasic(sender) : undefined,
      content: null,
      imageUrl: null,
      mediaAlbum: null,
      audioUrl: null,
      audioDuration: null,
      poll: null,
      linkPreview: null,
      replyTo: null,
      editedAt: null,
      isDeleted: false,
      callType: msg.callType,
      callStatus: msg.callStatus,
      callDuration: msg.callDuration,
      reactions: [],
      createdAt: msg.createdAt.toISOString(),
    };
    io.to(`conversation:${opts.conversationId}`).emit("new_message", payload);
  } catch (err) {
    logger.error({ err }, "Failed to log call message");
  }
}

// Authenticate socket connections
io.use((socket, next) => {
  const token = socket.handshake.auth?.token as string | undefined;
  if (token) {
    const payload = verifyToken(token);
    if (payload) socket.data.userId = payload.userId;
  }
  next();
});

io.on("connection", async (socket) => {
  const userId: number | undefined = socket.data.userId;
  logger.info({ socketId: socket.id, userId }, "Socket connected");

  if (userId) {
    if (!userSockets.has(userId)) userSockets.set(userId, new Set());
    userSockets.get(userId)!.add(socket.id);

    // Fetch display name for typing indicator
    try {
      const [user] = await db.select({ displayName: usersTable.displayName })
        .from(usersTable).where(eq(usersTable.id, userId));
      socket.data.displayName = user?.displayName ?? "Quelqu'un";
    } catch { socket.data.displayName = "Quelqu'un"; }

    // Auto-join ALL conversation rooms for this user on connect.
    // This ensures new_message events are received for every conversation,
    // not only those the user has explicitly opened in the UI.
    try {
      const userConvs = await db
        .select({ conversationId: conversationParticipantsTable.conversationId })
        .from(conversationParticipantsTable)
        .where(eq(conversationParticipantsTable.userId, userId));
      const convIds = userConvs.map(c => c.conversationId);
      // Store for use in disconnect handler
      socket.data.conversationIds = convIds;
      for (const conversationId of convIds) {
        socket.join(`conversation:${conversationId}`);
        // Notify everyone in this conversation that this user is online
        socket.to(`conversation:${conversationId}`).emit('user_online', { userId });
      }
    } catch { /* non-critical — manual join_conversation still works as fallback */ }
  }

  // ── WebRTC signaling relay ────────────────────────────────────────────────
  socket.on("call_offer", async ({ targetUserId, offer, fromName, fromAvatar, conversationId, isVideo }: { targetUserId: number; offer: RTCSessionDescriptionInit; fromName: string; fromAvatar?: string; conversationId: number; isVideo: boolean }) => {
    if (!userId) return;
    // SECURITY: both caller and callee must be participants of the
    // conversation. Without this, an authenticated attacker could spam
    // call offers (with a fake conversationId or arbitrary targetUserId)
    // at any other user, including users they have no relationship with.
    try {
      const [callerOk, calleeOk] = await Promise.all([
        isConversationMember(userId, conversationId),
        isConversationMember(targetUserId, conversationId),
      ]);
      if (!callerOk || !calleeOk) {
        logger.warn({ userId, targetUserId, conversationId }, "Rejected call_offer — not both participants");
        return;
      }
    } catch (err) {
      logger.error({ err }, "call_offer membership check failed");
      return;
    }
    const targetSockets = userSockets.get(targetUserId);
    if (targetSockets) {
      for (const sid of targetSockets) {
        io.to(sid).emit("call_offer", { fromUserId: userId, fromName, fromAvatar, offer, conversationId, isVideo });
      }
    }
    // Track active call for logging
    const key = callKey(userId, targetUserId);
    // Clear any stale entry from previous call
    const stale = activeCalls.get(key);
    if (stale?.missedTimer) clearTimeout(stale.missedTimer);
    const call: ActiveCall = {
      conversationId, callerId: userId, calleeId: targetUserId,
      isVideo, startedAt: Date.now(),
    };
    call.missedTimer = setTimeout(() => {
      const c = activeCalls.get(key);
      if (c && !c.answeredAt) {
        // Ringing timed out → log as missed
        logCallMessage({
          conversationId: c.conversationId, senderId: c.callerId,
          callType: c.isVideo ? 'video' : 'audio', callStatus: 'missed',
        });
        activeCalls.delete(key);
      }
    }, RING_TIMEOUT_MS);
    activeCalls.set(key, call);
    // Also push a notification in case the app is in background / screen is off
    try {
      await notifyIncomingCall({ targetUserId, callerName: fromName, callerAvatar: fromAvatar, conversationId, isVideo });
    } catch { /* non-critical */ }
  });

  socket.on("call_answer", ({ targetUserId, answer }: { targetUserId: number; answer: RTCSessionDescriptionInit }) => {
    if (!userId) return;
    // SECURITY: only forward signaling that corresponds to an active
    // call set up via call_offer (which is membership-checked). This
    // prevents injecting fake answers/ICE into unrelated peers.
    if (!activeCalls.has(callKey(userId, targetUserId))) return;
    const targetSockets = userSockets.get(targetUserId);
    if (targetSockets) {
      for (const sid of targetSockets) {
        io.to(sid).emit("call_answer", { fromUserId: userId, answer });
      }
    }
    // Mark the call as answered (callee picked up)
    const key = callKey(userId, targetUserId);
    const call = activeCalls.get(key);
    if (call) {
      call.answeredAt = Date.now();
      if (call.missedTimer) { clearTimeout(call.missedTimer); call.missedTimer = undefined; }
    }
  });

  socket.on("call_ice_candidate", ({ targetUserId, candidate }: { targetUserId: number; candidate: RTCIceCandidateInit }) => {
    if (!userId) return;
    // SECURITY: see call_answer.
    if (!activeCalls.has(callKey(userId, targetUserId))) return;
    const targetSockets = userSockets.get(targetUserId);
    if (targetSockets) {
      for (const sid of targetSockets) {
        io.to(sid).emit("call_ice_candidate", { fromUserId: userId, candidate });
      }
    }
  });

  socket.on("call_end", ({ targetUserId }: { targetUserId: number }) => {
    if (!userId) return;
    // SECURITY: see call_answer.
    if (!activeCalls.has(callKey(userId, targetUserId))) return;
    const targetSockets = userSockets.get(targetUserId);
    if (targetSockets) {
      for (const sid of targetSockets) {
        io.to(sid).emit("call_ended", { fromUserId: userId });
      }
    }
    // Log the call result
    const key = callKey(userId, targetUserId);
    const call = activeCalls.get(key);
    if (call) {
      if (call.missedTimer) clearTimeout(call.missedTimer);
      if (call.answeredAt) {
        const duration = Math.round((Date.now() - call.answeredAt) / 1000);
        logCallMessage({
          conversationId: call.conversationId, senderId: call.callerId,
          callType: call.isVideo ? 'video' : 'audio',
          callStatus: 'answered', callDuration: duration,
        });
      } else {
        // Caller hung up before callee answered → missed
        logCallMessage({
          conversationId: call.conversationId, senderId: call.callerId,
          callType: call.isVideo ? 'video' : 'audio', callStatus: 'missed',
        });
      }
      activeCalls.delete(key);
    }
  });

  socket.on("call_reject", ({ targetUserId }: { targetUserId: number }) => {
    if (!userId) return;
    // SECURITY: see call_answer.
    if (!activeCalls.has(callKey(userId, targetUserId))) return;
    const targetSockets = userSockets.get(targetUserId);
    if (targetSockets) {
      for (const sid of targetSockets) {
        io.to(sid).emit("call_rejected", { fromUserId: userId });
      }
    }
    // Callee declined → log declined (caller is sender)
    const key = callKey(userId, targetUserId);
    const call = activeCalls.get(key);
    if (call) {
      if (call.missedTimer) clearTimeout(call.missedTimer);
      logCallMessage({
        conversationId: call.conversationId, senderId: call.callerId,
        callType: call.isVideo ? 'video' : 'audio', callStatus: 'declined',
      });
      activeCalls.delete(key);
    }
  });

  socket.on("join_conversation", async (conversationId: number, ack?: (roster: number[]) => void) => {
    if (!userId) {
      if (typeof ack === "function") ack([]);
      return;
    }

    // ── Authorization: only participants may join the room and see the roster ──
    try {
      const membership = await db
        .select({ userId: conversationParticipantsTable.userId })
        .from(conversationParticipantsTable)
        .where(and(
          eq(conversationParticipantsTable.conversationId, conversationId),
          eq(conversationParticipantsTable.userId, userId),
        ))
        .limit(1);
      if (membership.length === 0) {
        logger.warn({ userId, conversationId }, "Rejected join_conversation — not a participant");
        if (typeof ack === "function") ack([]);
        return;
      }
    } catch (err) {
      logger.error({ err, userId, conversationId }, "Membership check failed");
      if (typeof ack === "function") ack([]);
      return;
    }

    socket.join(`conversation:${conversationId}`);
    logger.info({ socketId: socket.id, conversationId }, "Joined conversation room");

    // Track which rooms THIS specific socket has joined, for clean disconnect handling
    if (!socket.data.joinedRooms) socket.data.joinedRooms = new Set<number>();
    const joinedRooms: Set<number> = socket.data.joinedRooms;
    const isNewJoinForThisSocket = !joinedRooms.has(conversationId);
    joinedRooms.add(conversationId);

    // Per-user socket count: a user is "present" while count > 0
    if (!roomPresence.has(conversationId)) roomPresence.set(conversationId, new Map());
    const userMap = roomPresence.get(conversationId)!;
    const prevCount = userMap.get(userId) ?? 0;

    if (isNewJoinForThisSocket) {
      userMap.set(userId, prevCount + 1);
      // Only broadcast on the 0 -> 1 transition (first tab opens this room)
      if (prevCount === 0) {
        socket.to(`conversation:${conversationId}`).emit('user_joined_room', { conversationId, userId });
      }
    }

    // Reply to the joining client with the current roster (includes self)
    if (typeof ack === "function") ack([...userMap.keys()]);

    // Notify senders of recent messages that their messages have been delivered
    try {
      const recentMsgs = await db.select({ senderId: messagesTable.senderId })
        .from(messagesTable)
        .where(and(
          eq(messagesTable.conversationId, conversationId),
          ne(messagesTable.senderId, userId),
        ))
        .limit(60);

      const senderIds = [...new Set(recentMsgs.map(m => m.senderId))];
      for (const senderId of senderIds) {
        const senderSocketIds = userSockets.get(senderId);
        if (senderSocketIds) {
          for (const socketId of senderSocketIds) {
            io.to(socketId).emit("messages_delivered", { conversationId, deliveredTo: userId });
          }
        }
      }
    } catch { /* non-critical */ }
  });

  socket.on("leave_conversation", (conversationId: number) => {
    socket.leave(`conversation:${conversationId}`);
    if (!userId) return;
    const joinedRooms: Set<number> | undefined = socket.data.joinedRooms;
    if (!joinedRooms || !joinedRooms.has(conversationId)) return;
    joinedRooms.delete(conversationId);

    const userMap = roomPresence.get(conversationId);
    if (!userMap) return;
    const prevCount = userMap.get(userId) ?? 0;
    if (prevCount <= 1) {
      userMap.delete(userId);
      socket.to(`conversation:${conversationId}`).emit('user_left_room', { conversationId, userId });
      if (userMap.size === 0) roomPresence.delete(conversationId);
    } else {
      userMap.set(userId, prevCount - 1);
    }
  });

  // Typing indicator — emit directly to all member sockets (bypasses room state issues)
  socket.on("typing", async ({ conversationId, isTyping }: { conversationId: number; isTyping: boolean }) => {
    if (!userId) return;
    // SECURITY: only members of the conversation may broadcast typing.
    // Without this, any authenticated user could spam typing indicators
    // into any conversation by passing an arbitrary conversationId.
    if (!(await isConversationMember(userId, conversationId))) return;
    const payload = {
      userId,
      displayName: socket.data.displayName ?? "...",
      conversationId,
      isTyping,
    };
    try {
      const members = await db
        .select({ userId: conversationParticipantsTable.userId })
        .from(conversationParticipantsTable)
        .where(eq(conversationParticipantsTable.conversationId, conversationId));

      for (const member of members) {
        if (member.userId === userId) continue; // don't echo back to sender
        const sockets = userSockets.get(member.userId);
        if (sockets) {
          for (const sid of sockets) {
            io.to(sid).emit("typing", payload);
          }
        }
      }
    } catch {
      // Fallback to room broadcast if DB query fails
      socket.to(`conversation:${conversationId}`).emit("typing", payload);
    }
  });

  socket.on("disconnect", () => {
    logger.info({ socketId: socket.id }, "Socket disconnected");
    if (userId) {
      userSockets.get(userId)?.delete(socket.id);
      const isStillConnected = (userSockets.get(userId)?.size ?? 0) > 0;
      if (!isStillConnected) {
        userSockets.delete(userId);
        // Broadcast offline to all conversation rooms
        const convIds: number[] = socket.data.conversationIds ?? [];
        for (const conversationId of convIds) {
          io.to(`conversation:${conversationId}`).emit('user_offline', { userId, lastSeen: Date.now() });
        }
      }
      // Decrement room presence counts ONLY for rooms this specific socket joined.
      // If another tab/socket of the same user is still viewing a room, the user
      // remains "present" and no broadcast is fired.
      const joinedRooms: Set<number> | undefined = socket.data.joinedRooms;
      if (joinedRooms) {
        for (const convId of joinedRooms) {
          const userMap = roomPresence.get(convId);
          if (!userMap) continue;
          const prevCount = userMap.get(userId) ?? 0;
          if (prevCount <= 1) {
            userMap.delete(userId);
            io.to(`conversation:${convId}`).emit('user_left_room', { conversationId: convId, userId });
            if (userMap.size === 0) roomPresence.delete(convId);
          } else {
            userMap.set(userId, prevCount - 1);
          }
        }
      }
    }
  });
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
