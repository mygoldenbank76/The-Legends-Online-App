import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  useListMessages, useGetConversation, useSendMessage,
  useMarkConversationRead, useAddReaction, useUploadImage,
  useEditMessage, useDeleteMessage, usePinMessage,
  getListMessagesQueryKey, getListConversationsQueryKey, getGetConversationQueryKey,
  listMessages,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { useSocket } from '@/lib/socket-context';
import { usePreferences } from '@/lib/preferences-context';
import { translateGroupName } from '@/lib/i18n';
import { getAuthHeaders } from '@/lib/auth-fetch';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  ArrowLeft, Loader2, Send, Plus, Smile,
  Reply, Pin, Pencil, Trash2, Languages, X, Check, PinOff, MoreVertical,
  Mic, Copy, Heart, CheckCheck,
} from 'lucide-react';
import { format } from 'date-fns';
import { AttachmentSheet } from './attachment-sheet';
import { PollCreator } from './poll-creator';
import { PollMessage } from './poll-message';
import { AudioPlayer } from './audio-player';
import { VoiceRecorder } from './voice-recorder';
import { GroupInfoSheet } from './group-info-sheet';
import { UserProfileSheet } from './user-profile-sheet';
import { LinkPreviewCard } from './link-preview';
import { FormattingToolbar } from './formatting-toolbar';
import { RichText, applyFormat } from './rich-text';
import type { FormatType } from './rich-text';
import { GifPicker } from './gif-picker';
import type { GifResult } from './gif-picker';

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '😡', '🔥'];
const PICKER_EMOJIS = ['😀','😂','🤣','😊','😍','🥰','😘','😋','😎','🤩','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫','🥱','😴','😌','😛','😜','😝','🤤','😒','😓','😔','😕','🙃','🤑','😲','☹️','🙁','😖','😞','😟','😤','😢','😭','😦','😧','😨','😩','🤯','😬','😰','😱','🥵','🥶','😳','🤪','😵','😡','😠','🤬','😷','🤒','🤕','🤢','🤮','🤧','😇','🥳','🥺','🤠','🤡','🤥','🤫','🤭','🧐','🤓','😈','👿','👹','👺','💀','👻','👽','👾','🤖'];

type PollOption = {
  id: number;
  text: string;
  voteCount: number;
  percentage: number;
  voters: number[];
};

type Poll = {
  id: number;
  question: string;
  isAnonymous: boolean;
  isMultipleChoice: boolean;
  isQuiz: boolean;
  totalVotes: number;
  userVotedOptionIds: number[];
  options: PollOption[];
};

type Msg = {
  id: number;
  conversationId: number;
  senderId: number;
  sender?: { id: number; displayName: string; username?: string; avatar?: string | null; bio?: string | null };
  content?: string | null;
  imageUrl?: string | null;
  audioUrl?: string | null;
  audioDuration?: number | null;
  poll?: Poll | null;
  linkPreview?: { url: string; title?: string | null; description?: string | null; image?: string | null; platform?: string | null; embedUrl?: string | null; siteName?: string | null } | null;
  replyTo?: Msg | null;
  editedAt?: string | null;
  isDeleted?: boolean;
  status?: 'sent' | 'delivered' | 'read';
  reactions: Array<{ id: number; messageId: number; userId: number; emoji: string }>;
  createdAt: string;
};

type ChatAreaProps = { conversationId: number; onBack?: () => void; onOpenConversation?: (convId: number) => void };
type CtxMenu = { msgId: number } | null;
type TranslateEntry = { msgId: number; text: string };

async function translateText(text: string, targetLang: string): Promise<string> {
  const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=autodetect|${targetLang}`);
  const d = await r.json();
  const translated = d.responseData?.translatedText;
  if (!translated || translated === text || d.responseStatus !== 200) {
    throw new Error('Traduction indisponible');
  }
  return translated;
}

function SheetItem({
  icon, label, onClick, divider = false, danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  divider?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      className={`w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/5 transition-colors text-left
        ${divider ? 'border-t border-white/5' : ''}
        ${danger ? 'text-red-400' : 'text-foreground'}`}
      onClick={onClick}
    >
      <span className={danger ? 'text-red-400' : 'text-muted-foreground'}>{icon}</span>
      <span className="text-sm">{label}</span>
    </button>
  );
}

export function ChatArea({ conversationId, onBack, onOpenConversation }: ChatAreaProps) {
  const { user } = useAuth();
  const { socket, joinConversation, emitTyping, typingUsers } = useSocket();
  const queryClient = useQueryClient();
  const { translateLanguage, t: uiT, appLanguage } = usePreferences();

  const { data: rawMessages, isLoading } = useListMessages(conversationId);
  const { data: conversation } = useGetConversation(conversationId);
  const markRead = useMarkConversationRead();
  const sendMsg = useSendMessage();
  const addReaction = useAddReaction();
  const uploadImage = useUploadImage();
  const editMsg = useEditMessage();
  const deleteMsg = useDeleteMessage();
  const pinMsg = usePinMessage();

  // Refs (declared early so they can be used in callbacks below)
  const scrollRef = useRef<HTMLDivElement>(null);

  // Pagination state — older messages prepended when scrolling to top
  const [olderMessages, setOlderMessages] = useState<Msg[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const prevConvIdRef = useRef<number | null>(null);

  // Reset pagination when conversation changes
  useEffect(() => {
    if (prevConvIdRef.current !== conversationId) {
      setOlderMessages([]);
      setHasMore(true);
      setLoadingMore(false);
      prevConvIdRef.current = conversationId;
    }
  }, [conversationId]);

  // Merge: older pages first, then real-time messages, deduplicated by id
  const recentIds = new Set((rawMessages as Msg[] | undefined)?.map(m => m.id) ?? []);
  const dedupedOlder = olderMessages.filter(m => !recentIds.has(m.id));
  const allMessages = [...dedupedOlder, ...((rawMessages as Msg[] | undefined) ?? [])];
  const messages = allMessages.filter(m => !m.isDeleted);

  // Load older messages when sentinel becomes visible
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || isLoading) return;
    const oldestId = messages[0]?.id;
    if (!oldestId) return;
    setLoadingMore(true);
    try {
      const container = scrollRef.current;
      const prevScrollHeight = container?.scrollHeight ?? 0;
      const batch = await listMessages(conversationId, { before: oldestId, limit: 50 });
      if (!batch || batch.length === 0) { setHasMore(false); return; }
      if (batch.length < 50) setHasMore(false);
      setOlderMessages(prev => {
        const existingIds = new Set(prev.map(m => m.id));
        const newBatch = (batch as Msg[]).filter(m => !existingIds.has(m.id));
        return [...newBatch, ...prev];
      });
      // Restore scroll position after prepend
      requestAnimationFrame(() => {
        if (container) {
          container.scrollTop = container.scrollHeight - prevScrollHeight;
        }
      });
    } finally {
      setLoadingMore(false);
    }
  }, [conversationId, loadingMore, hasMore, isLoading, messages]);

  // IntersectionObserver on sentinel
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore(); },
      { root: scrollRef.current, threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressInputTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didTriggerMenu = useRef(false);
  const didJustSwipe = useRef(false);
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);
  const isSwiping = useRef(false);
  // Guard: timestamp when this conversation was opened — prevents ghost-touch
  // from the navigation tap immediately triggering the long-press menu
  const conversationOpenedAt = useRef<number>(Date.now());
  const typingStopTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu>(null);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [editState, setEditState] = useState<{ id: number; orig: string } | null>(null);
  const [translations, setTranslations] = useState<TranslateEntry[]>([]);
  const [translatingId, setTranslatingId] = useState<number | null>(null);
  const [swipeOffsets, setSwipeOffsets] = useState<Record<number, number>>({});
  const [swipingId, setSwipingId] = useState<number | null>(null);
  const [prevMsgCount, setPrevMsgCount] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');

  // New UI states
  const [attachmentSheetOpen, setAttachmentSheetOpen] = useState(false);
  const [pollCreatorOpen, setPollCreatorOpen] = useState(false);
  const [groupInfoOpen, setGroupInfoOpen] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [pinnedIdx, setPinnedIdx] = useState(0);

  // Poll votes viewer state
  const [pollVotes, setPollVotes] = useState<{ optionText: string; voters: { id: number; displayName: string }[] }[] | null>(null);

  // User profile sheet (click on avatar/name in group)
  const [profileUser, setProfileUser] = useState<{ id: number; displayName: string; username?: string; avatar?: string | null; bio?: string | null; isOnline?: boolean } | null>(null);

  // Context menu: reactions/views sub-panels
  type Reader = { id: number; displayName: string; username: string; avatar: string | null; readAt: string | null };
  const [ctxPanel, setCtxPanel] = useState<'reactions' | 'views' | null>(null);
  const [ctxReaders, setCtxReaders] = useState<Reader[]>([]);
  const [ctxReadersLoading, setCtxReadersLoading] = useState(false);

  // @mention state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStartIdx, setMentionStartIdx] = useState(-1);

  // ── Socket ──────────────────────────────────────────────────
  useEffect(() => {
    if (socket && conversationId) joinConversation(conversationId);
  }, [socket, conversationId, joinConversation]);

  useEffect(() => {
    if (!socket) return;
    const fn = () => joinConversation(conversationId);
    socket.on('connect', fn);
    return () => { socket.off('connect', fn); };
  }, [socket, conversationId, joinConversation]);

  // ── Scroll ─────────────────────────────────────────────────
  const [scrollReady, setScrollReady] = useState(false);
  const scrollReadyConvRef = useRef<number | null>(null);
  // During the "settle" period after initial load, images/videos are still loading
  // and their heights change — we re-scroll to bottom each time.
  const msgsWrapRef   = useRef<HTMLDivElement>(null);
  const settlingRef   = useRef(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset visibility when conversation changes
  useEffect(() => {
    setScrollReady(false);
    scrollReadyConvRef.current = null;
  }, [conversationId]);

  // Initial scroll — synchronous (before paint) to avoid flash
  useLayoutEffect(() => {
    if (!messages || messages.length === 0 || isLoading) return;
    if (scrollReadyConvRef.current === conversationId) return;
    scrollReadyConvRef.current = conversationId;
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    setScrollReady(true);
    // Start the settle period — images/videos haven't rendered yet,
    // their heights will grow as they load, pushing the bottom further down.
    // The ResizeObserver below will re-scroll to bottom on each height change.
    settlingRef.current = true;
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => { settlingRef.current = false; }, 5000);
  });

  // Re-scroll to bottom whenever the messages wrapper grows in height
  // (e.g. images/GIFs loading) — but only during the settle window.
  useEffect(() => {
    const wrap = msgsWrapRef.current;
    if (!wrap || !scrollReady) return;
    const ro = new ResizeObserver(() => {
      if (settlingRef.current && scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [scrollReady, conversationId]);

  const scrollBottom = useCallback((delay = 0) => {
    setTimeout(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, delay);
  }, []);

  // Track whether user is pinned to the bottom (updated on every scroll)
  const wasAtBottomRef = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !scrollReady) return;
    const onScroll = () => {
      wasAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollReady]);

  // When the keyboard opens (viewport shrinks), scroll to bottom if we were there before
  // Must capture wasAtBottom BEFORE the resize (that's why the ref approach is needed —
  // after resize, clientHeight has changed and the naive distance check breaks)
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let prevHeight = vv.height;

    const onViewportResize = () => {
      const newHeight = vv.height;
      const keyboardOpened = newHeight < prevHeight;
      prevHeight = newHeight;

      if (keyboardOpened && wasAtBottomRef.current) {
        // Wait for the layout to reflow (App.tsx sets #root height on same event)
        // then scroll to bottom
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          });
        });
      }
    };

    vv.addEventListener('resize', onViewportResize);
    return () => vv.removeEventListener('resize', onViewportResize);
  }, []);

  // Set to true when the LOCAL user sends something — guarantees a scroll-to-bottom
  // on the next message list update, regardless of current scroll position.
  const forceScrollRef = useRef(false);

  useEffect(() => {
    const count = messages?.length ?? 0;
    // Only auto-scroll on new messages (after initial load is done)
    if (scrollReadyConvRef.current === conversationId && count !== prevMsgCount) {
      setPrevMsgCount(count);
      const el = scrollRef.current;
      if (forceScrollRef.current) {
        // User just sent something — always scroll to bottom (Telegram behaviour)
        forceScrollRef.current = false;
        scrollBottom(30);
      } else if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
        // Someone else sent and user was near the bottom — keep them there
        scrollBottom(30);
      }
      // else: user is scrolled up reading history — don't disturb them
    } else if (count !== prevMsgCount) {
      setPrevMsgCount(count);
    }
  }, [messages, prevMsgCount, conversationId, scrollBottom]);

  // Reset ghost-touch guard whenever we open a different conversation
  useEffect(() => { conversationOpenedAt.current = Date.now(); }, [conversationId]);

  useEffect(() => {
    if (conversationId && messages && messages.length > 0) markRead.mutate({ conversationId });
  }, [conversationId, messages?.length]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(conversationId) });
    queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
  }, [queryClient, conversationId]);

  // ── Send text ─────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (editState) {
      const trimmed = content.trim();
      if (!trimmed) return;
      setContent('');
      const id = editState.id;
      setEditState(null);
      try { await editMsg.mutateAsync({ messageId: id, data: { content: trimmed } }); invalidate(); }
      catch (e) { console.error(e); }
      return;
    }
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    const replyId = replyTo?.id;
    setContent('');
    setReplyTo(null);
    setSending(true);
    // Stop typing indicator immediately on send
    if (typingStopTimeout.current) clearTimeout(typingStopTimeout.current);
    emitTyping(conversationId, false);
    try {
      forceScrollRef.current = true;
      await sendMsg.mutateAsync({ conversationId, data: { content: trimmed, replyToId: replyId } });
      invalidate();
    } catch { setContent(trimmed); forceScrollRef.current = false; }
    finally { setSending(false); }
  }, [content, sending, editState, replyTo, conversationId, sendMsg, editMsg, invalidate, scrollBottom, emitTyping]);

  // ── GIF send ──────────────────────────────────────────────
  const handleGifSelect = useCallback(async (gif: GifResult) => {
    if (sending) return;
    const replyId = replyTo?.id;
    setReplyTo(null);
    setSending(true);
    try {
      forceScrollRef.current = true;
      await sendMsg.mutateAsync({ conversationId, data: { imageUrl: gif.url, replyToId: replyId } });
      invalidate();
    } catch (e) { console.error(e); forceScrollRef.current = false; }
    finally { setSending(false); }
  }, [sending, replyTo, conversationId, sendMsg, invalidate, scrollBottom]);

  // ── @mention helpers ──────────────────────────────────────
  const participants: Array<{ id: number; displayName: string; username?: string; avatar?: string | null }> =
    (conversation as any)?.participants ?? [];

  const mentionSuggestions = mentionQuery !== null
    ? participants.filter(p =>
        p.id !== user?.id &&
        (
          p.displayName.toLowerCase().includes(mentionQuery.toLowerCase()) ||
          (p.username || '').toLowerCase().includes(mentionQuery.toLowerCase())
        )
      ).slice(0, 6)
    : [];

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setContent(value);
    if (value.trim()) setGifOpen(false);
    const cursor = e.target.selectionStart ?? value.length;
    const textBeforeCursor = value.slice(0, cursor);
    const match = textBeforeCursor.match(/@(\w*)$/);
    if (match) {
      setMentionQuery(match[1]);
      setMentionStartIdx(cursor - match[0].length);
    } else {
      setMentionQuery(null);
      setMentionStartIdx(-1);
    }
    // Typing indicator — emit start, debounce stop
    emitTyping(conversationId, true);
    if (typingStopTimeout.current) clearTimeout(typingStopTimeout.current);
    typingStopTimeout.current = setTimeout(() => { emitTyping(conversationId, false); }, 2500);
  };

  const handleMentionSelect = (p: { id: number; displayName: string; username?: string }) => {
    const name = p.username || p.displayName;
    const before = content.slice(0, mentionStartIdx);
    const after = content.slice(mentionStartIdx + 1 + (mentionQuery?.length ?? 0));
    const newContent = `${before}@${name} ${after}`;
    setContent(newContent);
    setMentionQuery(null);
    setMentionStartIdx(-1);
    setTimeout(() => {
      if (textareaRef.current) {
        const pos = before.length + name.length + 2; // @name + space
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  };

  // Render message text with @mentions highlighted
  const handleTextSelect = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    setSelectionRange(start !== end ? { start, end } : null);
  };

  // Also listen to native selectionchange for reliable mobile selection detection
  useEffect(() => {
    const onSelChange = () => {
      const ta = textareaRef.current;
      if (!ta || document.activeElement !== ta) return;
      const start = ta.selectionStart ?? 0;
      const end = ta.selectionEnd ?? 0;
      setSelectionRange(start !== end ? { start, end } : null);
    };
    document.addEventListener('selectionchange', onSelChange);
    return () => document.removeEventListener('selectionchange', onSelChange);
  }, []);

  const handleFormat = (fmt: FormatType) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = selectionRange?.start ?? ta.selectionStart ?? 0;
    const end = selectionRange?.end ?? ta.selectionEnd ?? 0;
    if (start === end) return;
    const { newText, newEnd } = applyFormat(content, start, end, fmt);
    setContent(newText);
    setSelectionRange(null);
    setTimeout(() => { ta.focus(); ta.setSelectionRange(newEnd, newEnd); }, 0);
  };

  const handleLinkRequest = () => {
    setLinkMode(true);
    setLinkUrl('');
  };

  const handleLinkConfirm = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = selectionRange?.start ?? ta.selectionStart ?? 0;
    const end = selectionRange?.end ?? ta.selectionEnd ?? 0;
    const url = linkUrl.trim()
      ? (linkUrl.startsWith('http') ? linkUrl : `https://${linkUrl}`)
      : '';
    if (start !== end && url) {
      const { newText, newEnd } = applyFormat(content, start, end, 'link', url);
      setContent(newText);
      setTimeout(() => { ta.focus(); ta.setSelectionRange(newEnd, newEnd); }, 0);
    }
    setLinkMode(false);
    setLinkUrl('');
    setSelectionRange(null);
  };

  const handleLinkCancel = () => {
    setLinkMode(false);
    setLinkUrl('');
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handleCopy = useCallback(async () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = selectionRange?.start ?? ta.selectionStart ?? 0;
    const end = selectionRange?.end ?? ta.selectionEnd ?? 0;
    if (start === end) return;
    const selected = content.slice(start, end);
    try { await navigator.clipboard.writeText(selected); } catch { /* ignore */ }
  }, [content, selectionRange]);

  const handlePaste = useCallback(async () => {
    const ta = textareaRef.current;
    if (!ta) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      const start = ta.selectionStart ?? content.length;
      const end = ta.selectionEnd ?? content.length;
      const newText = content.slice(0, start) + text + content.slice(end);
      setContent(newText);
      const newCursor = start + text.length;
      setTimeout(() => { ta.focus(); ta.setSelectionRange(newCursor, newCursor); }, 0);
    } catch { /* permission denied or no clipboard */ }
  }, [content]);

  // Intercept long-press on the input to block native Android selection toolbar
  const handleInputTouchStart = useCallback((e: React.TouchEvent) => {
    if (longPressInputTimer.current) clearTimeout(longPressInputTimer.current);
    longPressInputTimer.current = setTimeout(() => {
      // Block the contextmenu event that follows a long-press on Android
      const block = (ce: Event) => { ce.preventDefault(); ce.stopPropagation(); };
      document.addEventListener('contextmenu', block, { once: true, capture: true });
    }, 280);
  }, []);

  const handleInputTouchEnd = useCallback(() => {
    if (longPressInputTimer.current) { clearTimeout(longPressInputTimer.current); longPressInputTimer.current = null; }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionQuery !== null && mentionSuggestions.length > 0) {
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handleMentionSelect(mentionSuggestions[0]);
        return;
      }
      if (e.key === 'Escape') { setMentionQuery(null); return; }
    }
    if (e.key === 'Escape') { setEditState(null); setReplyTo(null); setContent(''); }
  };

  // ── Auth helper for manual fetch (must be before file/voice handlers) ─────
  const authFetch = useCallback((url: string, opts: RequestInit = {}) => {
    const token = localStorage.getItem('telechat_token') || '';
    return fetch(url, {
      ...opts,
      headers: {
        ...(opts.headers || {}),
        'Authorization': `Bearer ${token}`,
      },
    });
  }, []);

  // ── File handlers ──────────────────────────────────────────
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploadingImg(true);
      const res = await uploadImage.mutateAsync({ data: { file } });
      forceScrollRef.current = true;
      await sendMsg.mutateAsync({ conversationId, data: { imageUrl: res.url, replyToId: replyTo?.id } });
      setReplyTo(null); invalidate();
    } catch (err) { console.error(err); }
    finally { setUploadingImg(false); if (e.target) e.target.value = ''; }
  };

  const handleDocumentChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploadingImg(true);
      const formData = new FormData();
      formData.append('file', file);
      const res = await authFetch('/api/uploads/document', { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const { url, name } = await res.json();
      forceScrollRef.current = true;
      await sendMsg.mutateAsync({ conversationId, data: { content: `📎 ${name || 'Document'}`, imageUrl: url, replyToId: replyTo?.id } });
      setReplyTo(null); invalidate();
    } catch (err) { console.error(err); }
    finally { setUploadingImg(false); if (e.target) e.target.value = ''; }
  };

  // ── Voice message ──────────────────────────────────────────
  const handleVoiceSend = useCallback(async (audioBlob: Blob, duration: number) => {
    try {
      const formData = new FormData();
      const ext = audioBlob.type.includes('webm') ? '.webm' : audioBlob.type.includes('mp4') ? '.mp4' : '.ogg';
      formData.append('file', audioBlob, `voice${ext}`);
      const res = await authFetch('/api/uploads/audio', { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const { url } = await res.json();
      forceScrollRef.current = true;
      await sendMsg.mutateAsync({ conversationId, data: { audioUrl: url, audioDuration: Math.round(duration), replyToId: replyTo?.id } as any });
      setReplyTo(null);
      setVoiceActive(false);
      invalidate();
    } catch (err) { console.error('Voice send error:', err); throw err; }
  }, [authFetch, conversationId, sendMsg, replyTo, invalidate, scrollBottom]);

  // ── Poll creation ──────────────────────────────────────────
  const handlePollCreate = useCallback(async (poll: {
    question: string;
    options: string[];
    isAnonymous: boolean;
    isMultipleChoice: boolean;
    isQuiz: boolean;
  }) => {
    try {
      forceScrollRef.current = true;
      await sendMsg.mutateAsync({ conversationId, data: { poll } as any });
      invalidate();
    } catch (err) { console.error(err); forceScrollRef.current = false; }
  }, [conversationId, sendMsg, invalidate, scrollBottom]);

  // ── Poll vote ──────────────────────────────────────────────
  const handlePollVote = useCallback(async (pollId: number, optionIds: number[]) => {
    try {
      await authFetch(`/api/polls/${pollId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optionIds }),
      });
      invalidate();
    } catch (err) { console.error(err); throw err; }
  }, [authFetch, invalidate]);

  const handleViewVotes = useCallback(async (pollId: number) => {
    try {
      const res = await authFetch(`/api/polls/${pollId}/votes`);
      if (!res.ok) {
        if (res.status === 403) setPollVotes([]);
        return;
      }
      const data = await res.json();
      if (!Array.isArray(data)) return;

      // Translate option labels to the current app language (one call per option)
      if (data.length > 0 && appLanguage !== 'fr') {
        try {
          const translatedTexts = await Promise.all(
            data.map((o: any) => translateText(o.optionText, appLanguage))
          );
          setPollVotes(data.map((o: any, i: number) => ({
            ...o,
            optionText: translatedTexts[i] ?? o.optionText,
          })));
        } catch {
          setPollVotes(data);
        }
      } else {
        setPollVotes(data);
      }
    } catch (err) { console.error(err); }
  }, [authFetch, appLanguage]);

  // ── Context menu ──────────────────────────────────────────
  const openCtxMenu = (e: React.MouseEvent | { clientX: number; clientY: number }, msg: Msg) => {
    if ('preventDefault' in e) (e as React.MouseEvent).preventDefault();
    // Ignore any context-menu/long-press events that arrive within 900ms of opening
    // the conversation — they are ghost events from the navigation tap.
    if (Date.now() - conversationOpenedAt.current < 900) return;
    setCtxMenu({ msgId: msg.id });
    setDeleteConfirm(null);
  };

  const closeCtx = () => { setCtxMenu(null); setDeleteConfirm(null); setCtxPanel(null); setCtxReaders([]); };

  // Fetch reads when context menu opens
  useEffect(() => {
    if (!ctxMenu) { setCtxReaders([]); setCtxPanel(null); return; }
    setCtxReadersLoading(true);
    const token = localStorage.getItem('telechat_token') || '';
    fetch(`/api/messages/${ctxMenu.msgId}/reads`, { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : { readers: [] })
      .then(data => setCtxReaders(data.readers ?? []))
      .catch(() => setCtxReaders([]))
      .finally(() => setCtxReadersLoading(false));
  }, [ctxMenu?.msgId]);

  const handleReply = (msg: Msg) => { setReplyTo(msg); setEditState(null); setContent(''); closeCtx(); };
  const handleEdit = (msg: Msg) => { setEditState({ id: msg.id, orig: msg.content || '' }); setContent(msg.content || ''); setReplyTo(null); closeCtx(); };

  const handleDeleteConfirm = async (msgId: number) => {
    closeCtx();
    try { await deleteMsg.mutateAsync({ messageId: msgId }); invalidate(); }
    catch (e) { console.error(e); }
  };

  const handlePin = async (msg: Msg) => {
    closeCtx();
    try {
      await pinMsg.mutateAsync({ messageId: msg.id });
      queryClient.invalidateQueries({ queryKey: getGetConversationQueryKey(conversationId) });
      invalidate();
    } catch (e) { console.error(e); }
  };

  const handleTranslate = async (msg: Msg) => {
    closeCtx();
    if (!msg.content) return;
    if (translations.find(t => t.msgId === msg.id)) {
      setTranslations(p => p.filter(t => t.msgId !== msg.id)); return;
    }
    setTranslatingId(msg.id);
    try { const text = await translateText(msg.content, translateLanguage); setTranslations(p => [...p, { msgId: msg.id, text }]); }
    catch { }
    finally { setTranslatingId(null); }
  };

  const handleReaction = async (msgId: number, emoji: string) => {
    closeCtx();
    try { await addReaction.mutateAsync({ messageId: msgId, data: { emoji } }); invalidate(); }
    catch (e) { console.error(e); }
  };

  // ── Swipe to reply ────────────────────────────────────────
  const onTouchStart = (e: React.TouchEvent, msg: Msg) => {
    swipeStartX.current = e.touches[0].clientX;
    swipeStartY.current = e.touches[0].clientY;
    isSwiping.current = false;
    didTriggerMenu.current = false;
    didJustSwipe.current = false;
    // Guard against ghost-touch from the navigation tap that opened this conversation
    const msSinceOpen = Date.now() - conversationOpenedAt.current;
    if (msSinceOpen < 600) return;
    longPressTimer.current = setTimeout(() => {
      if (!isSwiping.current) {
        didTriggerMenu.current = true;
        openCtxMenu({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY }, msg);
      }
    }, 500);
  };

  const onTouchMove = (e: React.TouchEvent, msgId: number) => {
    const dx = e.touches[0].clientX - swipeStartX.current;
    const dy = Math.abs(e.touches[0].clientY - swipeStartY.current);
    if (dy > 15 && dy > Math.abs(dx)) {
      if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
      return;
    }
    if (dx > 8) {
      isSwiping.current = true;
      if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
      setSwipingId(msgId);
      setSwipeOffsets(p => ({ ...p, [msgId]: Math.min(dx, 80) }));
    }
  };

  const onTouchEnd = (e: React.TouchEvent, msg: Msg) => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    const dx = e.changedTouches[0].clientX - swipeStartX.current;
    if (dx > 60 && isSwiping.current) {
      setReplyTo(msg);
      setEditState(null);
      didJustSwipe.current = true;
    }
    isSwiping.current = false;
    setSwipingId(null);
    setSwipeOffsets(p => ({ ...p, [msg.id]: 0 }));
  };

  // ── Derived ───────────────────────────────────────────────
  const pinnedMessageIds: number[] = (conversation as any)?.pinnedMessageIds ?? [];
  const safePinnedIdx = pinnedMessageIds.length > 0 ? pinnedIdx % pinnedMessageIds.length : 0;
  const pinnedMsgId = pinnedMessageIds[safePinnedIdx];
  const pinnedMsg = pinnedMsgId != null ? (rawMessages?.find(m => m.id === pinnedMsgId) as Msg | undefined) : undefined;

  const scrollToPinnedMsg = (msgId: number) => {
    const el = document.getElementById(`msg-${msgId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-primary', 'ring-offset-0', 'rounded-2xl');
      setTimeout(() => el.classList.remove('ring-2', 'ring-primary', 'ring-offset-0', 'rounded-2xl'), 1500);
    }
  };

  const handlePinnedBannerClick = () => {
    if (!pinnedMessageIds.length) return;
    const currentMsgId = pinnedMessageIds[safePinnedIdx];
    scrollToPinnedMsg(currentMsgId);
    if (pinnedMessageIds.length > 1) {
      setPinnedIdx(prev => (prev + 1) % pinnedMessageIds.length);
    }
  };
  const rawTitle = conversation?.name || conversation?.participants?.find((p: any) => p.id !== user?.id)?.displayName || 'Chat';
  const title = conversation?.type === 'group' ? translateGroupName(rawTitle, appLanguage) : rawTitle;
  const avatarUrl = conversation?.type === 'direct' ? conversation?.participants?.find((p: any) => p.id !== user?.id)?.avatar : undefined;
  const otherUser = conversation?.participants?.find((p: any) => p.id !== user?.id) as any;
  const isOnline = otherUser?.isOnline;
  const lastSeen = otherUser?.lastSeen
    ? uiT.chat.lastSeen.replace('{time}', format(new Date(otherUser.lastSeen), 'HH:mm'))
    : uiT.chat.offline;

  const isGroup = conversation?.type === 'group';
  const memberCount = (conversation as any)?.participants?.length ?? 0;

  const ctxMsg = messages?.find(m => m.id === ctxMenu?.msgId);
  const isMineCtx = ctxMsg?.senderId === user?.id;
  const canDeleteCtx = isMineCtx || !!user?.isAdmin;

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* Hidden file inputs */}
      <input type="file" ref={galleryInputRef} className="hidden" accept="image/*,video/*" onChange={handleFileChange} />
      <input type="file" ref={cameraInputRef} className="hidden" accept="image/*" capture="environment" onChange={handleFileChange} />
      <input type="file" ref={documentInputRef} className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar,.7z,application/*,text/plain" onChange={handleDocumentChange} />
    <div className="absolute inset-0 flex flex-col">

      {/* ── Header ── */}
      <div className="flex-none h-14 glass border-b border-border/50 flex items-center px-3 z-10 gap-3">
        {onBack && (
          <button onClick={onBack} className="text-muted-foreground hover:text-foreground transition-colors p-1 flex-shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
          {avatarUrl
            ? <img src={avatarUrl} alt={title} className="w-full h-full rounded-xl object-cover" />
            : <span className="text-sm font-bold text-primary">{title.substring(0, 1).toUpperCase()}</span>
          }
        </div>
        <div className="flex flex-col flex-1 min-w-0">
          <span className="font-semibold text-sm leading-tight text-foreground truncate">{title}</span>
          <span className={`text-xs leading-tight ${!isGroup && isOnline ? 'text-green-400' : 'text-muted-foreground'}`}>
            {isGroup
              ? `${memberCount} membre${memberCount !== 1 ? 's' : ''}`
              : (isOnline ? uiT.chat.online : lastSeen)}
          </span>
        </div>
        <button
          onClick={() => setGroupInfoOpen(true)}
          className="text-muted-foreground hover:text-foreground transition-colors p-1 flex-shrink-0"
        >
          <MoreVertical className="w-5 h-5" />
        </button>
      </div>

      {/* ── Pinned messages ── */}
      {pinnedMessageIds.length > 0 && pinnedMsg && !pinnedMsg.isDeleted && (
        <div
          onClick={handlePinnedBannerClick}
          className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-primary/10 border-b border-primary/20 text-xs cursor-pointer hover:bg-primary/15 transition-colors"
        >
          <Pin className="w-3 h-3 text-primary flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-primary font-medium">
              Message épinglé{pinnedMessageIds.length > 1 ? ` ${safePinnedIdx + 1}/${pinnedMessageIds.length}` : ''} · 
            </span>
            <span className="text-muted-foreground"> {pinnedMsg.content || '📷 Image'}</span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); handlePin(pinnedMsg); }}
            className="text-muted-foreground hover:text-foreground p-1 flex-shrink-0"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* ── Messages ── */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 pt-4 pb-2 bg-background" style={{ visibility: scrollReady || isLoading ? 'visible' : 'hidden' }}>
        {/* Sentinel — triggers loading older messages on scroll to top */}
        <div ref={sentinelRef} className="h-1" />
        {/* Spinner while loading older messages */}
        {loadingMore && (
          <div className="flex justify-center py-3">
            <Loader2 className="w-5 h-5 animate-spin text-primary/60" />
          </div>
        )}
        {/* No-more-messages indicator */}
        {!hasMore && !isLoading && messages.length > 0 && (
          <div className="flex justify-center py-2">
            <span className="text-[10px] text-muted-foreground/50 select-none">— début de la conversation —</span>
          </div>
        )}
        {isLoading && (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        )}
        <div ref={msgsWrapRef} className="flex flex-col gap-0.5 pb-2">
          {messages?.map((msg, index) => {
            const isMine = msg.senderId === user?.id;
            const prevMsg = messages[index - 1];
            const isSameAuthor = prevMsg && prevMsg.senderId === msg.senderId;
            const reactionCounts = msg.reactions.reduce((a: Record<string, number>, r) => {
              a[r.emoji] = (a[r.emoji] || 0) + 1; return a;
            }, {});
            const hasReactions = Object.keys(reactionCounts).length > 0;
            const hasReacted = (emoji: string) => msg.reactions.some(r => r.emoji === emoji && r.userId === user?.id);
            const swipeOffset = swipeOffsets[msg.id] || 0;
            const translation = translations.find(t => t.msgId === msg.id)?.text ?? null;
            const isTranslating = translatingId === msg.id;
            const isPinned = pinnedMessageIds.includes(msg.id);
            const msgTime = format(new Date(msg.createdAt), 'HH:mm');
            const isPoll = !!msg.poll;
            const isAudio = !!msg.audioUrl;

            // Show sender name for group conversations (non-mine messages)
            const showSenderName = conversation?.type === 'group' && !isMine && !isSameAuthor;

            return (
              <div
                key={msg.id}
                id={`msg-${msg.id}`}
                className={`flex items-end gap-2 w-full ${isMine ? 'justify-end' : 'justify-start'} ${isSameAuthor ? 'mt-0.5' : 'mt-3'}`}
                style={{ userSelect: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
                onContextMenu={(e) => openCtxMenu(e, msg)}
                onClick={(e) => {
                  if (didTriggerMenu.current || didJustSwipe.current) {
                    didTriggerMenu.current = false;
                    didJustSwipe.current = false;
                    return;
                  }
                  openCtxMenu(e, msg);
                }}
                onTouchStart={(e) => onTouchStart(e, msg)}
                onTouchMove={(e) => onTouchMove(e, msg.id)}
                onTouchEnd={(e) => onTouchEnd(e, msg)}
              >
                {/* Avatar column — arrow stacked above avatar for received messages */}
                {!isMine && (
                  <div className="flex-shrink-0 self-end flex flex-col items-center mb-1" style={{ width: 28 }}>
                    {/* Swipe reply arrow — above avatar */}
                    <div
                      style={{
                        opacity: Math.max(0, Math.min((swipeOffset - 20) / 40, 1)),
                        height: swipeOffset > 0 ? 18 : 0,
                        transition: swipingId === msg.id ? 'none' : 'all 0.2s ease-out',
                        overflow: 'hidden',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Reply className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                    </div>
                    {/* Avatar */}
                    {!isSameAuthor ? (
                      <button
                        className="focus:outline-none"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (conversation?.type === 'group' && msg.sender) {
                            const participant = (conversation as any)?.participants?.find((p: any) => p.id === msg.sender?.id);
                            setProfileUser({ ...msg.sender, isOnline: participant?.isOnline ?? false });
                          }
                        }}
                      >
                        <Avatar className="w-7 h-7">
                          <AvatarImage src={msg.sender?.avatar || ''} />
                          <AvatarFallback className="bg-primary/20 text-primary text-[10px]">
                            {(msg.sender?.displayName || '?').substring(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      </button>
                    ) : <div className="w-7 h-7" />}
                  </div>
                )}

                {/* Swipe reply arrow for OWN messages (appears left of bubble) */}
                {isMine && (
                  <div
                    className="flex items-center self-center"
                    style={{
                      opacity: Math.max(0, Math.min((swipeOffset - 20) / 40, 1)),
                      width: swipeOffset > 0 ? 22 : 0,
                      transition: swipingId === msg.id ? 'none' : 'all 0.2s ease-out',
                      overflow: 'hidden',
                    }}
                  >
                    <Reply className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                  </div>
                )}

                {/* Bubble wrapper — only handles the slide animation */}
                <div
                  className="max-w-[80%] relative"
                  style={{
                    transform: `translateX(${swipeOffset}px)`,
                    transition: swipingId === msg.id ? 'none' : 'transform 0.2s ease-out',
                  }}
                >
                  {/* Pinned label */}
                  {isPinned && (
                    <div className={`flex items-center gap-0.5 mb-0.5 text-[10px] text-primary ${isMine ? 'justify-end' : 'justify-start'}`}>
                      <Pin className="w-2.5 h-2.5" /><span>épinglé</span>
                    </div>
                  )}

                  {/* Sender name (group) — clickable to view profile */}
                  {showSenderName && (
                    <button
                      className="text-[11px] text-primary font-semibold mb-0.5 ml-1 text-left hover:underline focus:outline-none"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (msg.sender) {
                          const participant = (conversation as any)?.participants?.find((p: any) => p.id === msg.sender?.id);
                          setProfileUser({ ...msg.sender, isOnline: participant?.isOnline ?? false });
                        }
                      }}
                    >
                      {msg.sender?.displayName}
                    </button>
                  )}

                  {/* ── Bubble ── */}
                  <div className={`rounded-2xl px-3 py-2 text-sm shadow-sm
                    ${isMine
                      ? 'bg-primary text-primary-foreground rounded-br-sm'
                      : 'bg-card text-card-foreground border border-border rounded-bl-sm'
                    }`}
                  >
                    {/* Reply preview inside bubble — WhatsApp style */}
                    {msg.replyTo && !msg.replyTo.isDeleted && (
                      <div
                        className={`mb-2 rounded-lg overflow-hidden flex cursor-pointer
                          ${isMine ? 'bg-black/20' : 'bg-black/8'}`}
                        style={{ background: isMine ? 'rgba(0,0,0,0.20)' : 'rgba(0,0,0,0.07)' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          const el = document.getElementById(`msg-${msg.replyTo!.id}`);
                          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }}
                      >
                        {/* Accent bar — thick, full height */}
                        <div className={`w-[3.5px] flex-shrink-0 rounded-l-sm ${isMine ? 'bg-white' : 'bg-primary'}`} />
                        {/* Content */}
                        <div className="flex-1 min-w-0 px-3 py-2">
                          <p className={`text-[11px] font-semibold leading-tight mb-[3px] truncate
                            ${isMine ? 'text-white' : 'text-primary'}`}>
                            {msg.replyTo.senderId === user?.id ? 'Vous' : msg.replyTo.sender?.displayName}
                          </p>
                          <p className={`text-[12px] leading-snug line-clamp-2
                            ${isMine ? 'text-white/75' : 'text-foreground/70'}`}>
                            {msg.replyTo.audioUrl
                              ? '🎤 Message vocal'
                              : msg.replyTo.imageUrl
                              ? (msg.replyTo.imageUrl.match(/\.(mp4|webm|mov|avi|mkv)$/i) ? '🎬 Vidéo' : '📷 Image')
                              : msg.replyTo.content || ''}
                          </p>
                        </div>
                        {/* Thumbnail if image/video */}
                        {msg.replyTo.imageUrl && !msg.replyTo.imageUrl.match(/\.(mp4|webm|mov|avi|mkv)$/i) && (
                          <img
                            src={msg.replyTo.imageUrl}
                            alt="reply"
                            className="w-14 h-14 object-cover flex-shrink-0"
                          />
                        )}
                        {msg.replyTo.imageUrl && msg.replyTo.imageUrl.match(/\.(mp4|webm|mov|avi|mkv)$/i) && (
                          <div className="w-14 h-14 flex-shrink-0 bg-black/30 flex items-center justify-center">
                            <span className="text-xl">🎬</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Image or Video */}
                    {msg.imageUrl && !isPoll && (
                      <div className="mb-2 -mx-1 -mt-1 overflow-hidden rounded-xl" onClick={(e) => e.stopPropagation()}>
                        {msg.imageUrl.match(/\.(mp4|webm|mov|avi|mkv)$/i) ? (
                          <video
                            src={msg.imageUrl}
                            controls
                            playsInline
                            className="max-w-full max-h-72 w-full rounded-xl bg-black"
                            style={{ display: 'block' }}
                          />
                        ) : (
                          <img src={msg.imageUrl} alt="attached" className="max-w-full max-h-64 object-cover rounded-xl" />
                        )}
                      </div>
                    )}

                    {/* Audio message */}
                    {isAudio && (
                      <div onClick={(e) => e.stopPropagation()}>
                        <AudioPlayer
                          url={msg.audioUrl!}
                          duration={msg.audioDuration}
                          isMine={isMine}
                          senderAvatar={!isMine ? msg.sender?.avatar : undefined}
                          senderInitials={!isMine ? (msg.sender?.displayName || '?').substring(0, 2).toUpperCase() : undefined}
                        />
                      </div>
                    )}

                    {/* Poll */}
                    {isPoll && msg.poll && (
                      <div onClick={(e) => e.stopPropagation()}>
                      <PollMessage
                        poll={msg.poll}
                        isMine={isMine}
                        onVote={handlePollVote}
                        onViewVotes={handleViewVotes}
                      />
                      </div>
                    )}

                    {/* Text */}
                    {msg.content && !isPoll && (
                      <div className="whitespace-pre-wrap break-words leading-snug">
                        <RichText text={msg.content} isMine={isMine} />
                      </div>
                    )}

                    {/* Translation */}
                    {(isTranslating || translation) && (
                      <div className={`mt-2 pt-2 border-t text-xs ${isMine ? 'border-primary-foreground/20 text-primary-foreground/75' : 'border-border text-muted-foreground'}`}>
                        <div className="flex items-center gap-1 mb-1 font-medium">
                          <Languages className="w-3 h-3" /> Traduction
                        </div>
                        {isTranslating ? <Loader2 className="w-3 h-3 animate-spin" /> : <p>{translation}</p>}
                      </div>
                    )}

                    {/* Link preview */}
                    {msg.linkPreview && (
                      <LinkPreviewCard preview={msg.linkPreview} isMine={isMine} />
                    )}

                    {/* Bottom row: reactions (left) + time (right) — inside bubble like Base44 */}
                    <div className={`flex items-end justify-between gap-2 ${isPoll ? 'mt-2' : 'mt-1.5'}`}>
                      {/* Reactions inside bubble */}
                      {hasReactions ? (
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(reactionCounts).map(([emoji, count]) => (
                            <button
                              key={emoji}
                              onClick={(e) => { e.stopPropagation(); handleReaction(msg.id, emoji); }}
                              className={`rounded-full px-1.5 py-0.5 text-xs flex items-center gap-0.5 border transition-colors
                                ${hasReacted(emoji)
                                  ? 'bg-white/25 border-white/40 text-white'
                                  : 'bg-white/10 border-white/20 text-white/80 hover:bg-white/15'}`}
                            >
                              <span>{emoji}</span>
                              <span className="font-bold text-[10px]">{count as number}</span>
                            </button>
                          ))}
                        </div>
                      ) : <div />}

                      {/* Time + edited + status */}
                      <div className={`text-[10px] flex items-center gap-1 flex-shrink-0 ${isMine ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
                        {msg.editedAt && <span className="italic opacity-80">modifié</span>}
                        <span>{msgTime}</span>
                        {isMine && (
                          <span className="flex items-center -ml-0.5">
                            {msg.status === 'read' ? (
                              // Two colored (purple/white) checks = read
                              <svg width="16" height="10" viewBox="0 0 16 10" className="text-[#a78bfa] drop-shadow-sm">
                                <path d="M1 5l3 3L11 1" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M5 5l3 3 7-7" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            ) : msg.status === 'delivered' ? (
                              // Two gray checks = delivered
                              <svg width="16" height="10" viewBox="0 0 16 10" className="opacity-70">
                                <path d="M1 5l3 3L11 1" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M5 5l3 3 7-7" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            ) : (
                              // One gray check = sent
                              <svg width="10" height="10" viewBox="0 0 10 10" className="opacity-70">
                                <path d="M1 5l3 3 5-6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Reply bar ── */}
      {replyTo && (
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-sidebar border-t border-primary/20">
          <Reply className="w-4 h-4 text-primary flex-shrink-0" />
          <div className="flex-1 min-w-0 border-l-2 border-primary pl-2">
            <p className="text-[11px] text-primary font-semibold truncate">
              {replyTo.senderId === user?.id ? 'Vous' : replyTo.sender?.displayName}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {replyTo.content || (replyTo.audioUrl ? '🎤 Message vocal' : '📷 Image')}
            </p>
          </div>
          <button onClick={() => setReplyTo(null)} className="text-muted-foreground hover:text-foreground p-1 flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Edit bar ── */}
      {editState && (
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-sidebar border-t border-primary/30">
          <Pencil className="w-4 h-4 text-primary flex-shrink-0" />
          <p className="flex-1 text-xs text-primary font-medium truncate">{uiT.chat.edit} · {editState.orig}</p>
          <button onClick={() => { setEditState(null); setContent(''); }} className="text-muted-foreground hover:text-foreground p-1 flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── @mention suggestions panel ── */}
      <AnimatePresence>
        {mentionQuery !== null && mentionSuggestions.length > 0 && (
          <motion.div
            key="mention-popup"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            className="flex-shrink-0 mx-3 mb-1 glass-strong border border-primary/30 rounded-2xl overflow-hidden shadow-xl"
          >
            {mentionSuggestions.map((p, idx) => (
              <button
                key={p.id}
                onMouseDown={(e) => { e.preventDefault(); handleMentionSelect(p); }}
                onTouchStart={(e) => { e.preventDefault(); handleMentionSelect(p); }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-primary/10 active:bg-primary/20 transition-colors text-left ${idx > 0 ? 'border-t border-white/5' : ''}`}
              >
                <Avatar className="w-8 h-8 flex-shrink-0">
                  <AvatarImage src={p.avatar || ''} />
                  <AvatarFallback className="bg-primary/20 text-primary text-xs">
                    {(p.displayName || '?').substring(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{p.displayName}</div>
                  {p.username && <div className="text-xs text-primary/70 truncate">@{p.username}</div>}
                </div>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Typing indicator ── */}
      <AnimatePresence>
        {typingUsers.filter(u => u.conversationId === conversationId).length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
            className="flex-shrink-0 px-5 py-1 flex items-center gap-2"
          >
            {/* Animated dots */}
            <div className="flex items-center gap-0.5">
              {[0, 1, 2].map(i => (
                <motion.div key={i} className="w-1.5 h-1.5 rounded-full bg-primary"
                  animate={{ y: [0, -4, 0] }}
                  transition={{ repeat: Infinity, duration: 0.8, delay: i * 0.15, ease: 'easeInOut' }}
                />
              ))}
            </div>
            <span className="text-xs text-muted-foreground italic">
              {(() => {
                const typers = typingUsers.filter(u => u.conversationId === conversationId);
                if (typers.length === 1)
                  return uiT.chat.typingOne.replace('{name}', typers[0].displayName);
                if (typers.length === 2)
                  return uiT.chat.typingTwo.replace('{a}', typers[0].displayName).replace('{b}', typers[1].displayName);
                return uiT.chat.typingMany.replace('{n}', String(typers.length));
              })()}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Input bar — Base44 style ── */}
      <div className="flex-shrink-0 glass border-t border-border/50 relative">
        {/* GIF picker — floats above the input bar */}
        <GifPicker
          open={gifOpen}
          onClose={() => setGifOpen(false)}
          onSelect={handleGifSelect}
        />

        {/* Emoji picker — same pattern as GIF picker */}
        <AnimatePresence>
          {emojiOpen && (
            <motion.div
              key="emoji-panel"
              className="absolute bottom-full left-0 right-0 mb-1 z-50"
              initial={{ opacity: 0, y: 10, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.97 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
            >
              <div className="border border-white/[0.09] rounded-2xl overflow-hidden shadow-xl mx-3 backdrop-blur-[40px]" style={{ background: 'rgba(18,24,40,0.97)' }}>
                <div className="flex items-center justify-between px-3 pt-3 pb-2">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Emojis</span>
                  <button
                    onClick={() => setEmojiOpen(false)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-8 gap-0.5 px-2 pb-3 max-h-[240px] overflow-y-auto no-scrollbar">
                  {PICKER_EMOJIS.map(e => (
                    <button key={e} onClick={() => { setContent(p => p + e); setEmojiOpen(false); }}
                      className="text-xl hover:bg-white/10 rounded p-1 transition-colors leading-none">{e}</button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {/* Formatting toolbar — shown BELOW messages, ABOVE the input row */}
        <FormattingToolbar
          visible={!voiceActive}
          hasSelection={!!selectionRange}
          linkMode={linkMode}
          linkUrl={linkUrl}
          onLinkUrlChange={setLinkUrl}
          onLinkConfirm={handleLinkConfirm}
          onLinkCancel={handleLinkCancel}
          onFormat={handleFormat}
          onLinkRequest={handleLinkRequest}
          onCopy={handleCopy}
          onPaste={handlePaste}
        />
        <div className="flex items-end gap-2 px-3 py-3">
          {/* Voice recorder — replaces entire row when active */}
          {voiceActive ? (
            <VoiceRecorder
              onSend={handleVoiceSend}
              onCancel={() => setVoiceActive(false)}
            />
          ) : (
            <>
              {/* ── Text input field ─────────────────────────────────── */}
              <div className="flex-1 glass rounded-2xl border border-border/50 focus-within:border-primary/40 transition-colors flex items-end overflow-hidden">

                {/* Left icon: GIF (idle) ↔ Emoji (typing) */}
                <AnimatePresence mode="wait" initial={false}>
                  {!(content.trim() || editState) ? (
                    /* GIF button */
                    <motion.button
                      key="gif"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -8 }}
                      transition={{ duration: 0.13 }}
                      onClick={() => setGifOpen(v => !v)}
                      className={`flex-shrink-0 ml-3 mr-3 self-center h-6 w-[38px] flex items-center justify-center rounded-full text-xs font-bold border transition-colors
                        ${gifOpen
                          ? 'bg-primary/20 border-primary text-primary'
                          : 'border-foreground/40 text-foreground/60 hover:border-primary hover:text-primary'
                        }`}
                    >
                      GIF
                    </motion.button>
                  ) : (
                    /* Emoji button */
                    <motion.button
                      key="emoji"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -8 }}
                      transition={{ duration: 0.13 }}
                      onClick={() => setEmojiOpen(v => !v)}
                      className={`flex-shrink-0 ml-3 mr-3 self-center h-6 w-[38px] flex items-center justify-center rounded-full border transition-colors
                        ${emojiOpen
                          ? 'bg-primary/20 border-primary text-primary'
                          : 'border-foreground/40 text-foreground/60 hover:border-primary hover:text-primary'
                        }`}
                    >
                      <Smile className="w-4 h-4" />
                    </motion.button>
                  )}
                </AnimatePresence>

                {/* Textarea */}
                <Textarea
                  ref={textareaRef}
                  value={content}
                  onChange={handleContentChange}
                  onKeyDown={handleKeyDown}
                  onSelect={handleTextSelect}
                  onBlur={() => { if (!linkMode) setTimeout(() => setSelectionRange(null), 150); }}
                  onContextMenu={e => e.preventDefault()}
                  onTouchStart={handleInputTouchStart}
                  onTouchEnd={handleInputTouchEnd}
                  onTouchMove={handleInputTouchEnd}
                  placeholder={editState ? uiT.chat.editPlaceholder : uiT.chat.placeholder}
                  className="flex-1 min-h-[40px] max-h-[120px] border-0 focus-visible:ring-0 resize-none py-2.5 px-0 bg-transparent shadow-none text-sm"
                  style={{ WebkitTouchCallout: 'none' } as React.CSSProperties}
                  rows={1}
                />

                {/* Right icon inside field: + attachment */}
                <button
                  onClick={() => setAttachmentSheetOpen(true)}
                  disabled={uploadingImg}
                  className="flex-shrink-0 p-2.5 mb-0.5 self-end text-muted-foreground hover:text-foreground transition-colors"
                >
                  {uploadingImg
                    ? <Loader2 className="w-5 h-5 animate-spin" />
                    : <Plus className="w-5 h-5" />}
                </button>
              </div>

              {/* ── Right action button (outside field): Mic / Send ── */}
              <AnimatePresence mode="wait">
                {content.trim() || editState ? (
                  <motion.button
                    key="send"
                    onClick={handleSend}
                    disabled={sending}
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.5, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary/20 border border-primary/30 hover:bg-primary/30 text-primary transition-colors flex items-center justify-center mb-0.5 active:scale-95"
                  >
                    {sending
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : editState ? <Check className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                  </motion.button>
                ) : (
                  <motion.button
                    key="mic"
                    onClick={() => setVoiceActive(true)}
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.5, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary/20 border border-primary/30 hover:bg-primary/30 text-primary transition-colors flex items-center justify-center mb-0.5"
                  >
                    <Mic className="w-4 h-4" />
                  </motion.button>
                )}
              </AnimatePresence>
            </>
          )}
        </div>
      </div>

      {/* ── Context Menu — bottom sheet ── */}
      <AnimatePresence>
        {ctxMenu && ctxMsg && (
          <motion.div
            key="ctx-overlay"
            className="fixed inset-0 z-[500] flex items-end sm:items-center justify-center pb-4 sm:pb-0 px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={closeCtx}
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div
              className="relative w-full max-w-sm"
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
            >
              {ctxPanel ? (
                /* ── Sub-panel: Reactions or Views ── */
                <div className="glass-strong rounded-2xl overflow-hidden">
                  {/* Back header */}
                  <button
                    onClick={() => setCtxPanel(null)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/5 border-b border-white/5 text-foreground"
                  >
                    <ArrowLeft size={18} className="text-muted-foreground" />
                    <span className="text-sm font-medium">{uiT.chat.back}</span>
                  </button>

                  {/* List */}
                  <div className="max-h-64 overflow-y-auto">
                    {ctxPanel === 'reactions' && (
                      ctxMsg.reactions.length === 0 ? (
                        <p className="text-center text-muted-foreground text-sm py-6">—</p>
                      ) : (
                        /* Group by unique user, show all emoji they reacted with */
                        Object.values(
                          ctxMsg.reactions.reduce<Record<number, { userId: number; emojis: string[] }>>((acc, r) => {
                            if (!acc[r.userId]) acc[r.userId] = { userId: r.userId, emojis: [] };
                            acc[r.userId].emojis.push(r.emoji);
                            return acc;
                          }, {})
                        ).map(({ userId, emojis }) => {
                          const reactorUser = (conversation as any)?.participants?.find((p: any) => p.id === userId);
                          const name = reactorUser?.displayName ?? `User ${userId}`;
                          const avatar = reactorUser?.avatar ?? null;
                          const initials = name.substring(0, 2).toUpperCase();
                          return (
                            <div key={userId} className="flex items-center gap-3 px-4 py-3 border-t border-white/5 first:border-0">
                              <Avatar className="w-9 h-9 flex-shrink-0">
                                <AvatarImage src={avatar || ''} />
                                <AvatarFallback className="bg-primary/20 text-primary text-xs">{initials}</AvatarFallback>
                              </Avatar>
                              <span className="flex-1 text-sm font-medium text-foreground truncate">{name}</span>
                              <span className="text-base">{emojis.join('')}</span>
                            </div>
                          );
                        })
                      )
                    )}

                    {ctxPanel === 'views' && (
                      ctxReadersLoading ? (
                        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                      ) : ctxReaders.length === 0 ? (
                        <p className="text-center text-muted-foreground text-sm py-6">—</p>
                      ) : (
                        ctxReaders.map(reader => {
                          const initials = reader.displayName.substring(0, 2).toUpperCase();
                          return (
                            <div key={reader.id} className="flex items-center gap-3 px-4 py-3 border-t border-white/5 first:border-0">
                              <Avatar className="w-9 h-9 flex-shrink-0">
                                <AvatarImage src={reader.avatar || ''} />
                                <AvatarFallback className="bg-primary/20 text-primary text-xs">{initials}</AvatarFallback>
                              </Avatar>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-foreground truncate">{reader.displayName}</p>
                                {reader.readAt && (
                                  <p className="text-[11px] text-muted-foreground">{format(new Date(reader.readAt), 'HH:mm')}</p>
                                )}
                              </div>
                              <CheckCheck size={16} className="text-primary flex-shrink-0" />
                            </div>
                          );
                        })
                      )
                    )}
                  </div>
                </div>
              ) : (
                /* ── Main menu ── */
                <>
                  {/* Emoji reaction picker */}
                  <div className="glass-strong rounded-2xl mb-2 flex justify-around items-center p-3">
                    {REACTION_EMOJIS.map(emoji => (
                      <button key={emoji} onClick={() => handleReaction(ctxMenu.msgId, emoji)}
                        className="text-2xl hover:scale-125 active:scale-110 transition-transform">{emoji}</button>
                    ))}
                  </div>

                  {/* Reactions + Views summary row */}
                  <div className="glass-strong rounded-2xl mb-2 flex divide-x divide-white/10 overflow-hidden">
                    <button
                      onClick={() => setCtxPanel('reactions')}
                      className="flex-1 flex items-center gap-2 px-4 py-3 hover:bg-white/5 transition-colors"
                    >
                      <Heart size={15} className="text-red-400 flex-shrink-0" />
                      <span className="text-sm font-medium text-foreground">{ctxMsg.reactions.length}</span>
                      <span className="text-xs text-muted-foreground truncate">{uiT.chat.reactions}</span>
                      {ctxMsg.reactions.slice(0, 3).map((r, i) => {
                        const p = (conversation as any)?.participants?.find((pp: any) => pp.id === r.userId);
                        const ini = (p?.displayName ?? '?').substring(0, 2).toUpperCase();
                        return (
                          <Avatar key={i} className="w-5 h-5 flex-shrink-0 -ml-1">
                            <AvatarImage src={p?.avatar || ''} />
                            <AvatarFallback className="bg-primary/20 text-primary text-[8px]">{ini}</AvatarFallback>
                          </Avatar>
                        );
                      })}
                    </button>
                    <button
                      onClick={() => setCtxPanel('views')}
                      className="flex-1 flex items-center gap-2 px-4 py-3 hover:bg-white/5 transition-colors"
                    >
                      <CheckCheck size={15} className="text-primary flex-shrink-0" />
                      <span className="text-sm font-medium text-foreground">{ctxReadersLoading ? '…' : ctxReaders.length}</span>
                      <span className="text-xs text-muted-foreground truncate">{uiT.chat.views}</span>
                      {ctxReaders.slice(0, 3).map((r, i) => {
                        const ini = r.displayName.substring(0, 2).toUpperCase();
                        return (
                          <Avatar key={i} className="w-5 h-5 flex-shrink-0 -ml-1">
                            <AvatarImage src={r.avatar || ''} />
                            <AvatarFallback className="bg-primary/20 text-primary text-[8px]">{ini}</AvatarFallback>
                          </Avatar>
                        );
                      })}
                    </button>
                  </div>

                  {/* Actions */}
                  <div className="glass-strong rounded-2xl overflow-hidden">
                    <SheetItem icon={<Reply size={18} />} label={uiT.chat.reply} onClick={() => ctxMsg && handleReply(ctxMsg)} />

                    {ctxMsg.content && (
                      <SheetItem
                        icon={<Copy size={18} />}
                        label={uiT.chat.copy}
                        onClick={() => {
                          if (ctxMsg?.content) {
                            navigator.clipboard.writeText(ctxMsg.content).catch(() => {});
                          }
                          closeCtx();
                        }}
                        divider
                      />
                    )}

                    {ctxMsg.content && (
                      <SheetItem
                        icon={translatingId === ctxMenu.msgId ? <Loader2 size={18} className="animate-spin" /> : <Languages size={18} />}
                        label={translations.find(t => t.msgId === ctxMenu.msgId) ? uiT.chat.hideTranslation : uiT.chat.translate}
                        onClick={() => ctxMsg && handleTranslate(ctxMsg)}
                        divider
                      />
                    )}

                    <SheetItem
                      icon={pinnedMessageIds.includes(ctxMenu.msgId) ? <PinOff size={18} /> : <Pin size={18} />}
                      label={pinnedMessageIds.includes(ctxMenu.msgId) ? uiT.chat.unpin : uiT.chat.pin}
                      onClick={() => ctxMsg && handlePin(ctxMsg)}
                      divider
                    />

                    {isMineCtx && ctxMsg.content && !ctxMsg.poll && (
                      <SheetItem icon={<Pencil size={18} />} label={uiT.chat.edit} onClick={() => ctxMsg && handleEdit(ctxMsg)} divider />
                    )}

                    {canDeleteCtx && (
                      deleteConfirm === ctxMenu.msgId ? (
                        <div className="flex items-center gap-3 px-4 py-3.5 border-t border-white/5" onClick={(e) => e.stopPropagation()}>
                          <span className="text-sm text-red-400 flex-1">{uiT.chat.confirmDelete}</span>
                          <button onClick={() => handleDeleteConfirm(ctxMenu.msgId)} className="text-xs text-red-400 font-semibold hover:text-red-300 px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20">
                            {uiT.chat.delete}
                          </button>
                          <button onClick={() => setDeleteConfirm(null)} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1">
                            {uiT.chat.cancelDelete}
                          </button>
                        </div>
                      ) : (
                        <SheetItem
                          icon={<Trash2 size={18} />}
                          label={uiT.chat.delete}
                          onClick={() => setDeleteConfirm(ctxMenu.msgId)}
                          divider
                          danger
                        />
                      )
                    )}
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Poll votes viewer ── */}
      <AnimatePresence>
        {pollVotes && (
          <motion.div
            className="fixed inset-0 z-[500] flex items-end sm:items-center justify-center sm:p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setPollVotes(null)}
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div
              className="relative w-full max-w-lg sm:max-w-md"
              initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="glass-strong rounded-t-3xl sm:rounded-3xl max-h-[70dvh] overflow-y-auto">
                <div className="flex items-center justify-between p-4 sticky top-0 glass-strong">
                  <h3 className="font-bold text-foreground">{uiT.poll.votesTitle}</h3>
                  <button onClick={() => setPollVotes(null)} className="text-muted-foreground hover:text-foreground p-1">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="px-4 pb-6 space-y-4">
                  {pollVotes.map((opt, i) => (
                    <div key={i}>
                      <p className="text-sm font-semibold text-foreground mb-2">{opt.optionText}</p>
                      {opt.voters.length === 0 ? (
                        <p className="text-xs text-muted-foreground">{uiT.poll.noVotes}</p>
                      ) : (
                        <div className="space-y-1">
                          {opt.voters.map((v: any) => (
                            <div key={v.id} className="flex items-center gap-2 glass rounded-xl px-3 py-2">
                              <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                                <span className="text-xs font-bold text-primary">{v.displayName[0].toUpperCase()}</span>
                              </div>
                              <span className="text-sm text-foreground">{v.displayName}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Attachment sheet ── */}
      <AttachmentSheet
        open={attachmentSheetOpen}
        onClose={() => setAttachmentSheetOpen(false)}
        onCamera={() => cameraInputRef.current?.click()}
        onGallery={() => galleryInputRef.current?.click()}
        onDocument={() => documentInputRef.current?.click()}
        onPoll={() => setPollCreatorOpen(true)}
      />

      {/* ── Poll creator ── */}
      <PollCreator
        open={pollCreatorOpen}
        onClose={() => setPollCreatorOpen(false)}
        onSubmit={handlePollCreate}
      />

      {/* ── Group info sheet ── */}
      {conversation && (
        <GroupInfoSheet
          open={groupInfoOpen}
          onClose={() => setGroupInfoOpen(false)}
          conversation={conversation as any}
          messages={(messages || []) as any}
        />
      )}

      {/* ── User profile sheet (click on avatar/name in group) ── */}
      {profileUser && user && (
        <UserProfileSheet
          user={profileUser}
          currentUserId={user.id}
          onClose={() => setProfileUser(null)}
          onOpenConversation={(convId) => {
            setProfileUser(null);
            onOpenConversation?.(convId);
          }}
        />
      )}
    </div>
    </div>
  );
}
