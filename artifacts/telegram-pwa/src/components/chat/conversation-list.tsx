import { useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { CachedImg } from './cached-img';
import {
  useListConversations,
  getListConversationsQueryKey,
  getGetConversationQueryKey,
  getListMessagesQueryKey,
  listMessages,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { fr, enUS, es, ar, pt, de } from 'date-fns/locale';
import { Trash2, Phone, Video as VideoIcon } from 'lucide-react';
import { useCall } from '@/lib/call-context';
import { cn } from '@/lib/utils';
import { UserSearch } from './user-search';
import { getAuthHeaders } from '@/lib/auth-fetch';

import { usePreferences } from '@/lib/preferences-context';
import { translateGroupName } from '@/lib/i18n';
import { preloadMedia } from '@/lib/media-cache';
import { useSocket } from '@/lib/socket-context';

const dateFnsLocaleMap: Record<string, Locale> = {
  fr, en: enUS, es, ar, pt, de,
};

/**
 * Convertit le contenu riche en texte plat pour l'aperçu dans la liste.
 * Supprime toute la syntaxe markdown et extrait le label des liens.
 * → [Banger](https://...) devient "Banger"
 * → **texte** devient "texte"
 * → https://... devient "🔗 Lien"
 */
function plainPreview(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')              // [label](url) → label
    .replace(/\*\*([^*]+)\*\*/g, '$1')                     // **bold**
    .replace(/\*([^*]+)\*/g, '$1')                          // *italic*
    .replace(/__([^_]+)__/g, '$1')                          // __underline__
    .replace(/~~([^~]+)~~/g, '$1')                          // ~~strike~~
    .replace(/\|\|([^|]+)\|\|/g, '$1')                     // ||spoiler||
    .replace(/`([^`]+)`/g, '$1')                            // `code`
    .replace(/https?:\/\/\S+/g, '🔗 Lien')                // URLs seules → "🔗 Lien"
    .trim();
}

const SWIPE_REVEAL_PX = -72;
const LONG_PRESS_MS = 450;

type Props = {
  filterType: 'group' | 'direct' | 'all';
  activeConvId?: number;
  onSelectConv: (id: number) => void;
  user: { id: number; displayName: string };
};

export function ConversationList({ filterType, activeConvId, onSelectConv, user }: Props) {
  const { data: allConvs = [], isLoading } = useListConversations();
  const queryClient = useQueryClient();
  const { t, appLanguage } = usePreferences();
  const { presenceMap } = useSocket();
  const { callState, maximize } = useCall();
  const activeCallConvId = (callState.status === 'active' || callState.status === 'outgoing' || callState.status === 'incoming')
    ? callState.conversationId
    : undefined;
  const [openId, setOpenId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const didLongPress = useRef(false);

  // ── Optimisation 1 : pré-peupler le cache getConversation dès que la liste arrive ──
  // Affichage INSTANTANÉ du titre/avatar dès l'ouverture d'une conversation.
  // Les données complètes (participants…) sont rechargées en arrière-plan.
  useEffect(() => {
    if (!allConvs.length) return;
    allConvs.forEach(summary => {
      const key = getGetConversationQueryKey(summary.id);
      const state = queryClient.getQueryState(key);
      // Si on a déjà des données fraîches ET des participants complets, on garde
      const hasFullData = (state?.data as any)?.participants?.length > 0;
      if (hasFullData) return;
      // Pré-remplir le cache avec les données de la liste pour affichage immédiat
      queryClient.setQueryData(key, {
        id: summary.id,
        type: summary.type,
        name: summary.name ?? null,
        pinnedMessageId: summary.pinnedMessageId ?? null,
        // DMs: inclure otherUser comme participant
        // Groupes: tableau vide — les participants complets viendront du vrai fetch
        participants: summary.otherUser ? [summary.otherUser] : [],
        createdAt: summary.updatedAt,
      });
      // Marquer immédiatement comme périmé → background refetch dès qu'un composant
      // s'abonne, sans bloquer l'affichage (stale-while-revalidate)
      queryClient.invalidateQueries({ queryKey: key });
    });
  }, [allConvs, queryClient]);

  // ── Optimisation 2 : prefetch auto des 5 conversations les plus récentes ──
  // Dès que la liste charge, on pré-charge les messages des 5 premières convs en
  // arrière-plan. Résultat : premier tap toujours instantané, même sans avoir touché.
  useEffect(() => {
    if (!allConvs.length) return;
    const top5 = allConvs.slice(0, 5);
    top5.forEach((conv, idx) => {
      const key = getListMessagesQueryKey(conv.id);
      const state = queryClient.getQueryState(key);
      const isStale = !state?.dataUpdatedAt || Date.now() - state.dataUpdatedAt > 1000 * 60 * 5;
      if (!isStale) return;
      // Delay chaque prefetch pour ne pas bloquer le thread
      setTimeout(() => {
        queryClient.prefetchQuery({
          queryKey: key,
          queryFn: () => listMessages(conv.id),
          staleTime: 1000 * 60 * 5,
        });
      }, idx * 300);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allConvs.length > 0]);

  // ── Optimisation 3 : preload média des derniers messages visibles ──
  // Dès que la liste charge, les images des derniers messages sont mises en cache RAM.
  // Résultat : ouvrir une conversation = images déjà prêtes, affichage 0ms.
  useEffect(() => {
    if (!allConvs.length) return;
    allConvs.forEach(conv => {
      const lm = (conv as any).lastMessage;
      if (lm?.imageUrl && !lm.imageUrl.match(/\.(mp4|webm|mov|avi|mkv)$/i)) {
        preloadMedia(lm.imageUrl);
      }
      // Preload avatar pour les DMs
      if (conv.otherUser?.avatar) {
        preloadMedia(conv.otherUser.avatar);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allConvs.length]);

  // ── Optimisation 4 : prefetch messages dès le pointerDown ──
  // Le doigt commence à appuyer → on démarre le chargement des messages immédiatement.
  // Quand le doigt se lève (~100-200ms plus tard), les messages sont déjà en cache.
  const prefetchMessages = useCallback((convId: number) => {
    const key = getListMessagesQueryKey(convId);
    const state = queryClient.getQueryState(key);
    // Prefetch seulement si le cache est vide ou périmé (> 5 min)
    const isStale = !state?.dataUpdatedAt || Date.now() - state.dataUpdatedAt > 1000 * 60 * 5;
    if (isStale) {
      queryClient.prefetchQuery({
        queryKey: key,
        queryFn: () => listMessages(convId),
        staleTime: 1000 * 60 * 5,
      });
    }
  }, [queryClient]);

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
    // Lancer le prefetch des messages immédiatement — avant que le doigt se lève
    prefetchMessages(convId);
    pointerStart.current = { x: e.clientX, y: e.clientY };
    didLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true;
      setOpenId(convId);
    }, LONG_PRESS_MS);
  }, [openId, prefetchMessages]);

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

      <div className="flex-1 overflow-y-auto py-1 px-2 scroll-container">
        {isLoading && conversations.length === 0 && (
          <div className="flex flex-col gap-1 pt-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-3 rounded-xl animate-pulse">
                <div className="w-12 h-12 rounded-full bg-white/8 flex-shrink-0" />
                <div className="flex-1 flex flex-col gap-2">
                  <div className="h-3.5 rounded-full bg-white/8" style={{ width: `${55 + (i % 3) * 15}%` }} />
                  <div className="h-2.5 rounded-full bg-white/5" style={{ width: `${40 + (i % 4) * 10}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {!isLoading && conversations.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-2">
            <p className="text-sm">{t.conversations.noConversation}</p>
            <p className="text-xs">{t.conversations.noConversationDesc}</p>
          </div>
        )}

        {conversations.map((conv, i) => {
          const isGroup = conv.type === 'group';
          const rawTitle = conv.name || conv.otherUser?.displayName || 'Unknown';
          const title = isGroup ? translateGroupName(rawTitle, appLanguage) : rawTitle;
          const initials = title.substring(0, 1).toUpperCase();
          const avatarUrl = isGroup ? undefined : conv.otherUser?.avatar;
          const lastMsg = conv.lastMessage;
          const isActive = activeConvId === conv.id;
          const otherUserId = conv.otherUser?.id;
          const livePresence = otherUserId ? presenceMap.get(otherUserId) : undefined;
          const isOnline = !isGroup && (livePresence ? livePresence.isOnline : conv.otherUser?.isOnline);
          const isRevealed = openId === conv.id && !isGroup;
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
                        <CachedImg src={avatarUrl} alt={title} className="w-full h-full object-cover" />
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
                          {formatDistanceToNow(new Date(lastMsg.createdAt), { addSuffix: false, locale: dateFnsLocaleMap[appLanguage] ?? fr })}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-1">
                      {/* pointer-events: none → empêche Chrome mobile d'ouvrir les URLs auto-détectées */}
                      {activeCallConvId === conv.id ? (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); maximize(); }}
                          className="flex items-center gap-1 text-xs text-green-400 font-medium truncate min-w-0 focus:outline-none"
                        >
                          {callState.isVideo
                            ? <VideoIcon className="w-3.5 h-3.5 flex-shrink-0" />
                            : <Phone className="w-3.5 h-3.5 flex-shrink-0" />}
                          <span className="truncate">
                            {callState.isVideo ? 'Appel vidéo' : 'Appel vocal'}
                            <span className="text-muted-foreground"> · Appel en cours</span>
                          </span>
                        </button>
                      ) : (
                        <p className="text-xs text-muted-foreground truncate" style={{ pointerEvents: 'none' }}>
                          {lastMsg ? (
                            <>
                              {lastMsg.senderId === user.id && (
                                <span className="text-primary/70 mr-1">{t.conversations.you}:</span>
                              )}
                              {(lastMsg as any).callType ? (
                                (lastMsg as any).callStatus === 'missed'
                                  ? ((lastMsg as any).callType === 'video' ? '📹 Appel vidéo manqué' : '📞 Appel vocal manqué')
                                  : ((lastMsg as any).callType === 'video' ? '📹 Appel vidéo' : '📞 Appel vocal')
                              ) : lastMsg.content
                                ? plainPreview(lastMsg.content)
                                : (lastMsg as any).audioUrl
                                ? t.conversations.voiceMessage
                                : (lastMsg as any).pollId
                                ? t.conversations.poll
                                : lastMsg.imageUrl
                                ? t.conversations.image
                                : ''}
                            </>
                          ) : (
                            <span className="italic">{t.conversations.noMessage}</span>
                          )}
                        </p>
                      )}
                      {conv.unreadCount > 0 && (
                        <span className="flex-shrink-0 bg-primary text-primary-foreground text-[10px] font-bold rounded-full min-w-5 h-5 flex items-center justify-center px-1.5">
                          {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>

                </motion.div>
              </motion.div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
