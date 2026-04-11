import { useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useListConversations, getListConversationsQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { UserSearch } from './user-search';
import { getAuthHeaders } from '@/lib/auth-fetch';

const SWIPE_REVEAL_PX = -72;
const LONG_PRESS_MS = 450;

type Props = {
  filterType: 'group' | 'direct' | 'all';
  activeConvId?: number;
  onSelectConv: (id: number) => void;
  user: { id: number; displayName: string };
};

export function ConversationList({ filterType, activeConvId, onSelectConv, user }: Props) {
  const { data: allConvs = [] } = useListConversations();
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const didLongPress = useRef(false);

  const conversations = filterType === 'all'
    ? allConvs
    : allConvs.filter(c =>
        filterType === 'group' ? c.type === 'group' : c.type === 'direct'
      );

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent, convId: number) => {
    if (openId && openId !== convId) {
      setOpenId(null);
      return;
    }
    pointerStart.current = { x: e.clientX, y: e.clientY };
    didLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true;
      setOpenId(convId);
    }, LONG_PRESS_MS);
  }, [openId]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!pointerStart.current) return;
    const dx = Math.abs(e.clientX - pointerStart.current.x);
    const dy = Math.abs(e.clientY - pointerStart.current.y);
    if (dx > 8 || dy > 8) clearLongPress();
  }, [clearLongPress]);

  const handlePointerUp = useCallback((e: React.PointerEvent, convId: number) => {
    clearLongPress();
    if (didLongPress.current) {
      e.preventDefault();
      return;
    }
    if (openId === convId) {
      setOpenId(null);
      return;
    }
    if (openId) {
      setOpenId(null);
      return;
    }
    onSelectConv(convId);
  }, [clearLongPress, openId, onSelectConv]);

  const handleDelete = useCallback(async (convId: number) => {
    setDeletingId(convId);
    try {
      await fetch(`/api/conversations/${convId}`, {
        method: 'DELETE',
        headers: getAuthHeaders() as Record<string, string>,
      });
      setOpenId(null);
      queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
    } catch {
      // ignore
    } finally {
      setDeletingId(null);
    }
  }, [queryClient]);

  return (
    <div
      className="flex flex-col h-full"
      onClick={() => { if (openId) setOpenId(null); }}
    >
      <div className="flex-shrink-0 px-3 py-2">
        <UserSearch onSelectUser={onSelectConv} />
      </div>

      <div className="flex-1 overflow-y-auto py-1 px-2 no-scrollbar">
        {conversations.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-2">
            <p className="text-sm">Aucune conversation</p>
            <p className="text-xs">Utilise la recherche pour démarrer</p>
          </div>
        )}

        {conversations.map((conv, i) => {
          const isGroup = conv.type === 'group';
          const title = conv.name || conv.otherUser?.displayName || 'Unknown';
          const initials = title.substring(0, 1).toUpperCase();
          const avatarUrl = isGroup ? undefined : conv.otherUser?.avatar;
          const lastMsg = conv.lastMessage;
          const isActive = activeConvId === conv.id;
          const isOnline = !isGroup && conv.otherUser?.isOnline;
          const isRevealed = openId === conv.id;
          const isDeleting = deletingId === conv.id;

          return (
            <div key={conv.id} className="relative mb-1 rounded-xl overflow-hidden">
              {/* Trash button — revealed behind the row */}
              <div className="absolute inset-y-0 right-0 flex items-center justify-end pr-2 z-0">
                <motion.button
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: isRevealed ? 1 : 0, scale: isRevealed ? 1 : 0.7 }}
                  transition={{ type: 'spring', damping: 20, stiffness: 300 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(conv.id);
                  }}
                  disabled={isDeleting}
                  className="w-12 h-12 rounded-xl bg-red-500/90 flex items-center justify-center shadow-lg active:scale-95 transition-transform"
                  aria-label="Supprimer la conversation"
                >
                  {isDeleting
                    ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    : <Trash2 className="w-5 h-5 text-white" />
                  }
                </motion.button>
              </div>

              {/* Conversation row */}
              <motion.div
                animate={{ x: isRevealed ? SWIPE_REVEAL_PX : 0 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="relative z-10"
                onPointerDown={(e) => handlePointerDown(e, conv.id)}
                onPointerMove={handlePointerMove}
                onPointerUp={(e) => handlePointerUp(e, conv.id)}
                onPointerCancel={clearLongPress}
                style={{ touchAction: 'pan-y' }}
              >
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03, duration: 0.2 }}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors text-left select-none',
                    isActive
                      ? 'bg-primary/15 border border-primary/20'
                      : isRevealed
                      ? 'bg-red-500/8 border border-red-500/20'
                      : 'hover:bg-white/5 border border-transparent'
                  )}
                >
                  {/* Avatar */}
                  <div className="relative flex-shrink-0">
                    <div
                      className={cn(
                        'w-11 h-11 rounded-xl flex items-center justify-center text-sm font-bold overflow-hidden',
                        isActive ? 'bg-primary/25 text-primary' : 'bg-white/8 text-muted-foreground'
                      )}
                    >
                      {avatarUrl ? (
                        <img src={avatarUrl} alt={title} className="w-full h-full object-cover" />
                      ) : (
                        initials
                      )}
                    </div>
                    {isOnline && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-background rounded-full" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <p className={cn(
                        'text-sm font-semibold truncate',
                        isActive ? 'text-foreground' : 'text-foreground/90'
                      )}>
                        {title}
                      </p>
                      {lastMsg && (
                        <span className="text-[10px] text-muted-foreground flex-shrink-0">
                          {formatDistanceToNow(new Date(lastMsg.createdAt), { addSuffix: false, locale: fr })}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-1">
                      <p className="text-xs text-muted-foreground truncate">
                        {lastMsg ? (
                          <>
                            {lastMsg.senderId === user.id && (
                              <span className="text-primary/70 mr-1">Vous:</span>
                            )}
                            {lastMsg.content
                              ? lastMsg.content
                              : (lastMsg as any).audioUrl
                              ? '🎤 Message vocal'
                              : (lastMsg as any).pollId
                              ? '📊 Sondage'
                              : lastMsg.imageUrl
                              ? '📷 Image'
                              : ''}
                          </>
                        ) : (
                          <span className="italic">Aucun message</span>
                        )}
                      </p>
                      {conv.unreadCount > 0 && (
                        <span className="flex-shrink-0 bg-primary text-primary-foreground text-[10px] font-bold rounded-full min-w-5 h-5 flex items-center justify-center px-1.5">
                          {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Hint when revealed */}
                  {isRevealed && (
                    <span className="text-[10px] text-red-400 flex-shrink-0 font-medium">Supprimer</span>
                  )}
                </motion.div>
              </motion.div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
