import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { verifyToken } from "./lib/auth";
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
// conversationId -> Set of userIds currently in the room
export const roomPresence = new Map<number, Set<number>>();

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
    const targetSockets = userSockets.get(targetUserId);
    if (targetSockets) {
      for (const sid of targetSockets) {
        io.to(sid).emit("call_ice_candidate", { fromUserId: userId, candidate });
      }
    }
  });

  socket.on("call_end", ({ targetUserId }: { targetUserId: number }) => {
    if (!userId) return;
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

  socket.on("join_conversation", async (conversationId: number) => {
    socket.join(`conversation:${conversationId}`);
    logger.info({ socketId: socket.id, conversationId }, "Joined conversation room");

    if (userId) {
      if (!roomPresence.has(conversationId)) roomPresence.set(conversationId, new Set());
      roomPresence.get(conversationId)!.add(userId);

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
    }
  });

  socket.on("leave_conversation", (conversationId: number) => {
    socket.leave(`conversation:${conversationId}`);
    if (userId && roomPresence.has(conversationId)) {
      roomPresence.get(conversationId)!.delete(userId);
    }
  });

  // Typing indicator — emit directly to all member sockets (bypasses room state issues)
  socket.on("typing", async ({ conversationId, isTyping }: { conversationId: number; isTyping: boolean }) => {
    if (!userId) return;
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
      for (const members of roomPresence.values()) {
        members.delete(userId);
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
