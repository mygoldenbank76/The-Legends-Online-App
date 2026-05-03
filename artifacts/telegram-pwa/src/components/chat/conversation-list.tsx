import { useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { CachedImg } from './cached-img';
import { isDocumentUrl, isDocumentMessage } from './file-card';
import {
  useListConversations,
  getListConversationsQueryKey,
  getGetConversationQueryKey,
  getListMessagesQueryKey,
  listMessages,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import type { Locale } from 'date-fns';
import { fr, enUS, es, ar, pt, de } from 'date-fns/locale';
import { Trash2, Phone, Video as VideoIcon } from 'lucide-react';
import { useCall } from '@/lib/call-context';
import { cn } from '@/lib/utils';
import { getAuthHeaders } from '@/lib/auth-fetch';

import { usePreferences } from '@/lib/preferences-context';
import { translateGroupName } from '@/lib/i18n';
import { preloadMedia, prewarmMessageMedia } from '@/lib/media-cache';
import { useSocket } from '@/lib/socket-context';

const dateFnsLocaleMap: Record<string, Locale> = {
  fr, en: enUS, es, ar, pt, de,
};

/**
 * Convertit le contenu riche en texte plat pour l'aperçu dans la liste.
 * Supprime toute la syntaxe markdown et extrait le label des liens.
 * → [Banger](https://...) devient "Banger"
 * → **texte** devient "texte"
 * Les URLs nues sont conservées telles quelles (le cas "message = URL
 * pure" est intercepté en amont et rendu sous la forme "a partagé un
 * lien" via les phrases d'action localisées).
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
    .trim();
}

// Detect a message whose entire content is a single URL (after stripping
// markdown link syntax). These get the "a partagé un lien" action phrase
// in the conversation list.
const URL_ONLY_RE = /^https?:\/\/\S+$/i;
const MARKDOWN_URL_ONLY_RE = /^\[[^\]]+\]\(https?:\/\/\S+\)$/i;
function isLinkOnlyContent(content: string): boolean {
  const trimmed = content.trim();
  return URL_ONLY_RE.test(trimmed) || MARKDOWN_URL_ONLY_RE.test(trimmed);
}

const VIDEO_EXT_RE = /\.(mp4|webm|mov|avi|mkv|m4v)(\?|$)/i;
const GIF_RE = /\.gif(\?|$)|tenor\.com|giphy\.com|media\.tenor\./i;

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
  // Dès que la liste charge, on pré-charge les messages des 5 premières convs
  // en arrière-plan ET les blobs de leurs médias. Résultat : premier tap
  // instantané, et les photos/audios sont déjà décodés en RAM avant l'entrée
  // dans la conversation — plus aucun rectangle vide qui se remplit.
  useEffect(() => {
    if (!allConvs.length) return;
    const top5 = allConvs.slice(0, 5);
    top5.forEach((conv, idx) => {
      const key = getListMessagesQueryKey(conv.id);
      const state = queryClient.getQueryState(key);
      const isStale = !state?.dataUpdatedAt || Date.now() - state.dataUpdatedAt > 1000 * 60 * 5;
      const cachedData = queryClient.getQueryData(key) as readonly any[] | undefined;
      // Delay chaque prefetch pour ne pas bloquer le thread, mais on garde
      // l'ordre (la 1ʳᵉ conv est warmée en premier — c'est celle que
      // l'utilisateur ouvre le plus souvent).
      setTimeout(() => {
        if (isStale) {
          queryClient
            .prefetchQuery({
              queryKey: key,
              queryFn: () => listMessages(conv.id),
              staleTime: 1000 * 60 * 5,
            })
            .then(() => {
              const fresh = queryClient.getQueryData(key) as readonly any[] | undefined;
              if (fresh?.length) prewarmMessageMedia(fresh);
            });
        } else if (cachedData?.length) {
          // JSON déjà frais — on warme quand même les blobs au cas où le
          // cache RAM aurait été vidé (rechargement de la page, eviction).
          prewarmMessageMedia(cachedData);
        }
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
      if (lm?.imageUrl
          && !lm.imageUrl.match(/\.(mp4|webm|mov|avi|mkv)$/i)
          && !isDocumentMessage(lm)) {
        preloadMedia(lm.imageUrl);
      }
      // Voice notes from the last message — pre-warm so opening the conv
      // can start playback instantly without re-streaming.
      if (lm?.audioUrl) {
        preloadMedia(lm.audioUrl);
      }
      // Preload avatar pour les DMs
      if (conv.otherUser?.avatar) {
        preloadMedia(conv.otherUser.avatar);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allConvs.length]);

  // ── Optimisation 4 : prefetch messages + médias dès le pointerDown ──
  // Le doigt commence à appuyer → on démarre le chargement des messages
  // immédiatement, ET on pré-décode tous les blobs photo/audio dans le cache
  // RAM. Quand le doigt se lève (~100-200 ms plus tard) puis que la
  // conversation s'ouvre, les <CachedImg> trouvent déjà leur blob en mémoire
  // et peignent les photos sur la toute première frame — fini les rectangles
  // vides qui se remplissent un par un.
  const prefetchMessages = useCallback((convId: number) => {
    const key = getListMessagesQueryKey(convId);
    const state = queryClient.getQueryState(key);
    const isStale = !state?.dataUpdatedAt || Date.now() - state.dataUpdatedAt > 1000 * 60 * 5;
    if (isStale) {
      queryClient
        .prefetchQuery({
          queryKey: key,
          queryFn: () => listMessages(convId),
          staleTime: 1000 * 60 * 5,
        })
        .then(() => {
          const fresh = queryClient.getQueryData(key) as readonly any[] | undefined;
          if (fresh?.length) prewarmMessageMedia(fresh);
        });
    } else {
      // Données fraîches : warmer immédiatement les blobs (le JSON est en
      // cache mais le cache RAM des images peut avoir été vidé par
      // l'éviction FIFO ou un hard-reload).
      const cachedData = queryClient.getQueryData(key) as readonly any[] | undefined;
      if (cachedData?.length) prewarmMessageMedia(cachedData);
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
    // Always preventDefault on tap to suppress the synthesised click that
    // Android dispatches ~30 ms later — without this, the ghost click lands
    // inside the freshly-mounted ChatArea (on a link or media inside the
    // first visible message) and triggers an unwanted navigation.
    e.preventDefault();
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
      <div
        className="flex-1 overflow-y-auto py-1 px-3 scroll-container"
        style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        {isLoading && conversations.length === 0 && (
          <div className="flex flex-col gap-1 pt-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-3 rounded-xl animate-pulse">
                <div className="w-12 h-12 rounded-full bg-foreground/10 flex-shrink-0" />
                <div className="flex-1 flex flex-col gap-2">
                  <div className="h-3.5 rounded-full bg-foreground/10" style={{ width: `${55 + (i % 3) * 15}%` }} />
                  <div className="h-2.5 rounded-full bg-foreground/5" style={{ width: `${40 + (i % 4) * 10}%` }} />
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
                    'w-full flex items-center gap-3 px-0 py-3 rounded-[14px] transition-colors text-left select-none',
                    isActive
                      ? 'gradient-primary-soft border border-primary/35 glow-primary-sm'
                      : isRevealed
                      ? 'bg-red-500/8 border border-red-500/20'
                      : 'hover:bg-foreground/[0.04]'
                  )}
                >
                  {/* Avatar — gradient ring when unread, glow when active */}
                  <div className={cn(
                    'relative flex-shrink-0',
                    conv.unreadCount > 0 && !isActive && 'avatar-ring-unread'
                  )}>
                    <div
                      className={cn(
                        'w-11 h-11 rounded-xl flex items-center justify-center text-sm font-bold overflow-hidden',
                        isActive
                          ? 'gradient-primary text-white shadow-[0_4px_14px_-2px_hsl(263_90%_65%/0.55)]'
                          : 'bg-foreground/10 text-muted-foreground'
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
                      ) : (() => {
                          // Action-phrase preview: every non-text last
                          // message ("a envoyé une photo", "a créé un
                          // sondage", "a partagé un lien", …) instead
                          // of the previous icon+noun mini-thumbnail
                          // pattern. Plain text still wins when the
                          // message has actual prose content; URLs are
                          // intercepted only when the entire message
                          // body is a single link.
                          const lmAny = lastMsg as any;
                          const lmUrl: string | undefined = lastMsg?.imageUrl ?? undefined;
                          const lmAlbumFirstRaw: unknown = Array.isArray(lmAny?.mediaAlbum) && lmAny.mediaAlbum.length > 0
                            ? lmAny.mediaAlbum[0]
                            : undefined;
                          // Album items may be bare URL strings (legacy)
                          // or {url, w, h, lqip, thumbnailUrl} objects.
                          // Normalise here so the lastMessage thumbnail
                          // resolves either form.
                          const lmAlbumFirst: string | undefined = typeof lmAlbumFirstRaw === 'string'
                            ? lmAlbumFirstRaw
                            : (lmAlbumFirstRaw && typeof lmAlbumFirstRaw === 'object' && 'url' in lmAlbumFirstRaw
                              ? (lmAlbumFirstRaw as { url?: string }).url
                              : undefined);
                          const mediaUrl = lmUrl ?? lmAlbumFirst;
                          // Content-aware document detector — image-typed
                          // files sent via the Document picker still get
                          // the "fichier" phrase, not "photo".
                          const isDoc = isDocumentMessage(lastMsg ?? undefined);

                          // Resolve the action label. The text content
                          // takes priority when present and is NOT a
                          // bare URL (since a URL alone reads better as
                          // "a partagé un lien" than as raw text).
                          let actionLabel: string | null = null;
                          if (lastMsg) {
                            if (lmAny.callType) {
                              actionLabel = lmAny.callStatus === 'missed'
                                ? (lmAny.callType === 'video' ? 'Appel vidéo manqué' : 'Appel vocal manqué')
                                : (lmAny.callType === 'video' ? 'Appel vidéo' : 'Appel vocal');
                            } else if (isDoc) {
                              actionLabel = t.conversations.file;
                            } else if (lmAny.pollId) {
                              actionLabel = t.conversations.poll;
                            } else if (lmAny.audioUrl) {
                              actionLabel = t.conversations.voiceMessage;
                            } else if (lastMsg.content && !isLinkOnlyContent(lastMsg.content)) {
                              actionLabel = plainPreview(lastMsg.content);
                            } else if (lastMsg.content && isLinkOnlyContent(lastMsg.content)) {
                              actionLabel = t.conversations.link;
                            } else if (mediaUrl) {
                              if (GIF_RE.test(mediaUrl)) actionLabel = t.conversations.gif;
                              else if (VIDEO_EXT_RE.test(mediaUrl)) actionLabel = t.conversations.video;
                              else actionLabel = t.conversations.photo;
                            }
                          }

                          return (
                            <div className="flex items-center gap-1.5 min-w-0 flex-1" style={{ pointerEvents: 'none' }}>
                              <p className="text-xs text-muted-foreground truncate min-w-0">
                                {lastMsg ? (
                                  <>
                                    {lastMsg.senderId === user.id && (
                                      <span className="text-primary/70 mr-1">{t.conversations.you}:</span>
                                    )}
                                    {actionLabel ?? ''}
                                  </>
                                ) : (
                                  <span className="italic">{t.conversations.noMessage}</span>
                                )}
                              </p>
                            </div>
                          );
                        })()}
                      {conv.unreadCount > 0 && (
                        <span className="flex-shrink-0 gradient-primary text-white text-[10px] font-bold rounded-full min-w-5 h-5 flex items-center justify-center px-1.5 pulse-glow">
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
