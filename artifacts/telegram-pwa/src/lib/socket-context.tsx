import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './auth-context';
import { useQueryClient } from '@tanstack/react-query';
import { getListMessagesQueryKey, getListConversationsQueryKey, getGetConversationQueryKey } from '@workspace/api-client-react';

export type TypingUser = {
  userId: number;
  displayName: string;
  conversationId: number;
};

export type PresenceEntry = {
  isOnline: boolean;
  lastSeen?: number; // Unix ms
};

type SocketContextType = {
  socket: Socket | null;
  joinConversation: (conversationId: number) => void;
  leaveConversation: (conversationId: number) => void;
  emitTyping: (conversationId: number, isTyping: boolean) => void;
  typingUsers: TypingUser[];
  presenceMap: Map<number, PresenceEntry>;
};

// Minimal shape of a message delivered by socket (matches server FormattedMessage)
type SocketMsg = {
  id: number;
  conversationId: number;
  senderId: number;
  content: string | null;
  imageUrl: string | null;
  audioUrl?: string | null;
  audioDuration?: number | null;
  poll?: any;
  linkPreview: any;
  replyTo: any;
  editedAt: string | null;
  isDeleted: boolean;
  status?: string;
  reactions: any[];
  createdAt: string;
  sender?: any;
};

const SocketContext = createContext<SocketContextType | undefined>(undefined);

// Module-level ref tracking the currently open conversation, so the socket
// doesn't increment unreadCount for messages the user is actively reading.
export const activeConversationIdRef = { current: null as number | null };

export function SocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [presenceMap, setPresenceMap] = useState<Map<number, PresenceEntry>>(new Map());
  const typingTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!user) {
      if (socket) { socket.disconnect(); setSocket(null); }
      return;
    }

    const token = localStorage.getItem('telechat_token');
    const basePath = import.meta.env.BASE_URL || '/';
    const newSocket = io(basePath === '/' ? '' : basePath.replace(/\/$/, ''), {
      auth: { token },
      transports: ['websocket', 'polling'],
      path: '/socket.io',
    });

    // ── Inject a message directly into the cache (no round-trip refetch) ──
    const injectMessage = (msg: SocketMsg) => {
      const convId = msg.conversationId;
      const key = getListMessagesQueryKey(convId);
      const existing = queryClient.getQueryData(key);

      if (Array.isArray(existing)) {
        queryClient.setQueryData(key, (old: SocketMsg[]) => {
          if (!Array.isArray(old)) return old;
          if (old.some(m => m.id === msg.id)) return old; // dedup
          return [...old, msg];
        });
      } else {
        // Cache doesn't exist yet (conversation never opened) — fall back to invalidation
        queryClient.invalidateQueries({ queryKey: key });
      }

      // ── Directly update the conversation list cache (instant, no refetch) ──
      const listKey = getListConversationsQueryKey();
      const listData = queryClient.getQueryData<any[]>(listKey);
      if (Array.isArray(listData)) {
        queryClient.setQueryData(listKey, (old: any[]) => {
          if (!Array.isArray(old)) return old;
          const updated = old.map(conv => {
            if (conv.id !== convId) return conv;
            return {
              ...conv,
              lastMessage: msg,
              updatedAt: msg.createdAt,
              // Increment unread only if: message is from someone else AND
              // this conversation is not currently open by the user
              unreadCount: msg.senderId !== user?.id && activeConversationIdRef.current !== convId
                ? (conv.unreadCount ?? 0) + 1
                : conv.unreadCount,
            };
          });
          // Re-sort by most recent message
          return [...updated].sort((a, b) => {
            const aT = a.lastMessage?.createdAt ?? a.updatedAt ?? '';
            const bT = b.lastMessage?.createdAt ?? b.updatedAt ?? '';
            return bT.localeCompare(aT);
          });
        });
      } else {
        // List not in cache yet — fall back to invalidation
        queryClient.invalidateQueries({ queryKey: listKey });
      }
    };

    // ── Invalidate helper (for events where we don't have the full payload) ──
    const invalidateMessages = (conversationId: number) => {
      queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(conversationId) });
      queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
    };

    newSocket.on('connect', () => console.log('Socket connected:', newSocket.id));
    newSocket.on('connect_error', (err) => console.warn('Socket error:', err.message));

    // new_message carries the full FormattedMessage — inject directly, no refetch
    newSocket.on('new_message', (msg: SocketMsg) => {
      injectMessage(msg);
    });

    // For reactions/edits/deletes we still refetch (smaller payloads, less frequent)
    newSocket.on('message_reaction', (msg: { conversationId: number }) => {
      invalidateMessages(msg.conversationId);
    });
    newSocket.on('message_edited', (msg: { conversationId: number }) => {
      invalidateMessages(msg.conversationId);
    });
    newSocket.on('message_deleted', (msg: { conversationId: number }) => {
      invalidateMessages(msg.conversationId);
    });
    newSocket.on('message_pinned', (data: { conversationId: number }) => {
      queryClient.invalidateQueries({ queryKey: getGetConversationQueryKey(data.conversationId) });
      queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(data.conversationId) });
    });
    newSocket.on('user_status', () => {
      queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
    });
    newSocket.on('poll_updated', (data: { messageId: number; conversationId: number }) => {
      invalidateMessages(data.conversationId);
    });

    // ── Read receipts ────────────────────────────────────────────────────────
    newSocket.on('messages_read', (data: { conversationId: number }) => {
      invalidateMessages(data.conversationId);
    });
    newSocket.on('messages_delivered', (data: { conversationId: number }) => {
      invalidateMessages(data.conversationId);
    });

    // ── Typing indicator ─────────────────────────────────────────────────────
    newSocket.on('typing', (data: { userId: number; displayName: string; conversationId: number; isTyping: boolean }) => {
      const key = `${data.userId}-${data.conversationId}`;

      const existing = typingTimeouts.current.get(key);
      if (existing) clearTimeout(existing);

      if (data.isTyping) {
        setTypingUsers(prev => {
          const filtered = prev.filter(u => !(u.userId === data.userId && u.conversationId === data.conversationId));
          return [...filtered, { userId: data.userId, displayName: data.displayName, conversationId: data.conversationId }];
        });
        const tid = setTimeout(() => {
          setTypingUsers(prev => prev.filter(u => !(u.userId === data.userId && u.conversationId === data.conversationId)));
          typingTimeouts.current.delete(key);
        }, 4000);
        typingTimeouts.current.set(key, tid);
      } else {
        setTypingUsers(prev => prev.filter(u => !(u.userId === data.userId && u.conversationId === data.conversationId)));
      }
    });

    // ── Real-time presence ───────────────────────────────────────────────────
    newSocket.on('user_online', ({ userId }: { userId: number }) => {
      setPresenceMap(prev => {
        const next = new Map(prev);
        next.set(userId, { isOnline: true });
        return next;
      });
    });

    newSocket.on('user_offline', ({ userId, lastSeen }: { userId: number; lastSeen: number }) => {
      setPresenceMap(prev => {
        const next = new Map(prev);
        next.set(userId, { isOnline: false, lastSeen });
        return next;
      });
    });

    setSocket(newSocket);
    return () => { newSocket.disconnect(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, queryClient]);

  const joinConversation = (conversationId: number) => {
    socket?.emit('join_conversation', conversationId);
  };

  const leaveConversation = (conversationId: number) => {
    socket?.emit('leave_conversation', conversationId);
  };

  const emitTyping = (conversationId: number, isTyping: boolean) => {
    socket?.emit('typing', { conversationId, isTyping });
  };

  return (
    <SocketContext.Provider value={{ socket, joinConversation, leaveConversation, emitTyping, typingUsers, presenceMap }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) throw new Error('useSocket must be used within a SocketProvider');
  return context;
}
