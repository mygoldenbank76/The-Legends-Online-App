import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './auth-context';
import { useQueryClient } from '@tanstack/react-query';
import { getListMessagesQueryKey, getListConversationsQueryKey, getGetConversationQueryKey } from '@workspace/api-client-react';

type SocketContextType = {
  socket: Socket | null;
  joinConversation: (conversationId: number) => void;
  leaveConversation: (conversationId: number) => void;
};

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export function SocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [socket, setSocket] = useState<Socket | null>(null);

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

    const invalidateMessages = (conversationId: number) => {
      queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(conversationId) });
      queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
    };

    newSocket.on('connect', () => console.log('Socket connected:', newSocket.id));
    newSocket.on('connect_error', (err) => console.warn('Socket error:', err.message));

    newSocket.on('new_message', (msg: { conversationId: number }) => {
      invalidateMessages(msg.conversationId);
    });
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

    setSocket(newSocket);
    return () => { newSocket.disconnect(); };
  }, [user, queryClient]);

  const joinConversation = (conversationId: number) => {
    socket?.emit('join_conversation', conversationId);
  };

  const leaveConversation = (conversationId: number) => {
    socket?.emit('leave_conversation', conversationId);
  };

  return (
    <SocketContext.Provider value={{ socket, joinConversation, leaveConversation }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) throw new Error('useSocket must be used within a SocketProvider');
  return context;
}
