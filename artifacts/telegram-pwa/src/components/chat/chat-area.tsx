import { useEffect, useRef, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  useListMessages, useGetConversation, useSendMessage,
  useMarkConversationRead, useAddReaction, useUploadImage,
  useEditMessage, useDeleteMessage, usePinMessage,
  getListMessagesQueryKey, getListConversationsQueryKey, getGetConversationQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { useSocket } from '@/lib/socket-context';
import { usePreferences } from '@/lib/preferences-context';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  ArrowLeft, Loader2, Send, Plus, Smile,
  Reply, Pin, Pencil, Trash2, Languages, X, Check, PinOff, MoreVertical,
  Mic, Copy,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AttachmentSheet } from './attachment-sheet';
import { PollCreator } from './poll-creator';
import { PollMessage } from './poll-message';
import { AudioPlayer } from './audio-player';
import { VoiceRecorder } from './voice-recorder';
import { GroupInfoSheet } from './group-info-sheet';
import { UserProfileSheet } from './user-profile-sheet';

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
  linkPreview?: { url: string; title?: string | null; description?: string | null; image?: string | null } | null;
  replyTo?: Msg | null;
  editedAt?: string | null;
  isDeleted?: boolean;
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
  const { socket, joinConversation } = useSocket();
  const queryClient = useQueryClient();
  const { translateLanguage, t: uiT } = usePreferences();

  const { data: rawMessages, isLoading } = useListMessages(conversationId);
  const { data: conversation } = useGetConversation(conversationId);
  const markRead = useMarkConversationRead();
  const sendMsg = useSendMessage();
  const addReaction = useAddReaction();
  const uploadImage = useUploadImage();
  const editMsg = useEditMessage();
  const deleteMsg = useDeleteMessage();
  const pinMsg = usePinMessage();

  const messages = (rawMessages as Msg[] | undefined)?.filter(m => !m.isDeleted);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);
  const isSwiping = useRef(false);

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

  // New UI states
  const [attachmentSheetOpen, setAttachmentSheetOpen] = useState(false);
  const [pollCreatorOpen, setPollCreatorOpen] = useState(false);
  const [groupInfoOpen, setGroupInfoOpen] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [pinnedIdx, setPinnedIdx] = useState(0);

  // Poll votes viewer state
  const [pollVotes, setPollVotes] = useState<{ optionText: string; voters: { id: number; displayName: string }[] }[] | null>(null);

  // User profile sheet (click on avatar/name in group)
  const [profileUser, setProfileUser] = useState<{ id: number; displayName: string; username?: string; avatar?: string | null; bio?: string | null } | null>(null);

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
  const scrollBottom = useCallback((delay = 0) => {
    setTimeout(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, delay);
  }, []);

  useEffect(() => {
    const count = messages?.length ?? 0;
    if (count !== prevMsgCount) { setPrevMsgCount(count); scrollBottom(50); }
  }, [messages, prevMsgCount, scrollBottom]);

  useEffect(() => { scrollBottom(120); }, [conversationId, scrollBottom]);

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
    try {
      await sendMsg.mutateAsync({ conversationId, data: { content: trimmed, replyToId: replyId } });
      invalidate(); scrollBottom(80);
    } catch { setContent(trimmed); }
    finally { setSending(false); }
  }, [content, sending, editState, replyTo, conversationId, sendMsg, editMsg, invalidate, scrollBottom]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
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
      await sendMsg.mutateAsync({ conversationId, data: { imageUrl: res.url, replyToId: replyTo?.id } });
      setReplyTo(null); invalidate(); scrollBottom(80);
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
      await sendMsg.mutateAsync({ conversationId, data: { content: `📎 ${name || 'Document'}`, imageUrl: url, replyToId: replyTo?.id } });
      setReplyTo(null); invalidate(); scrollBottom(80);
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
      await sendMsg.mutateAsync({ conversationId, data: { audioUrl: url, audioDuration: Math.round(duration), replyToId: replyTo?.id } as any });
      setReplyTo(null);
      setVoiceActive(false);
      invalidate(); scrollBottom(80);
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
      await sendMsg.mutateAsync({ conversationId, data: { poll } as any });
      invalidate(); scrollBottom(80);
    } catch (err) { console.error(err); }
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
        if (res.status === 403) {
          // Poll is anonymous — shouldn't show "Voir les votes" but just in case
          setPollVotes([]);
        }
        return;
      }
      const data = await res.json();
      if (Array.isArray(data)) setPollVotes(data);
    } catch (err) { console.error(err); }
  }, [authFetch]);

  // ── Context menu ──────────────────────────────────────────
  const openCtxMenu = (e: React.MouseEvent | { clientX: number; clientY: number }, msg: Msg) => {
    if ('preventDefault' in e) (e as React.MouseEvent).preventDefault();
    setCtxMenu({ msgId: msg.id });
    setDeleteConfirm(null);
  };

  const closeCtx = () => { setCtxMenu(null); setDeleteConfirm(null); };

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
    longPressTimer.current = setTimeout(() => {
      if (!isSwiping.current) openCtxMenu({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY }, msg);
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
    if (dx > 60 && isSwiping.current) { setReplyTo(msg); setEditState(null); }
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
  const title = conversation?.name || conversation?.participants?.find((p: any) => p.id !== user?.id)?.displayName || 'Chat';
  const avatarUrl = conversation?.type === 'direct' ? conversation?.participants?.find((p: any) => p.id !== user?.id)?.avatar : undefined;
  const otherUser = conversation?.participants?.find((p: any) => p.id !== user?.id) as any;
  const isOnline = otherUser?.isOnline;
  const lastSeen = otherUser?.lastSeen
    ? `vu ${format(new Date(otherUser.lastSeen), 'HH:mm', { locale: fr })}`
    : 'hors ligne';

  const isGroup = conversation?.type === 'group';
  const memberCount = (conversation as any)?.participants?.length ?? 0;

  const ctxMsg = messages?.find(m => m.id === ctxMenu?.msgId);
  const isMineCtx = ctxMsg?.senderId === user?.id;

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
              : (isOnline ? 'en ligne' : lastSeen)}
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
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 pt-4 pb-2 bg-background">
        {isLoading && (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        )}
        <div className="flex flex-col gap-0.5 pb-2">
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
            const msgTime = format(new Date(msg.createdAt), 'HH:mm', { locale: fr });
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
                          if (conversation?.type === 'group' && msg.sender) setProfileUser(msg.sender);
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
                        if (msg.sender) setProfileUser(msg.sender);
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
                      <div className="mb-2 -mx-1 -mt-1 overflow-hidden rounded-xl">
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
                      <AudioPlayer url={msg.audioUrl!} duration={msg.audioDuration} isMine={isMine} />
                    )}

                    {/* Poll */}
                    {isPoll && msg.poll && (
                      <PollMessage
                        poll={msg.poll}
                        isMine={isMine}
                        onVote={handlePollVote}
                        onViewVotes={handleViewVotes}
                      />
                    )}

                    {/* Text */}
                    {msg.content && !isPoll && (
                      <div className="whitespace-pre-wrap break-words leading-snug">{msg.content}</div>
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
                      <div className={`mt-2 rounded-lg p-2 text-xs border overflow-hidden
                        ${isMine ? 'bg-black/10 border-primary-foreground/20' : 'bg-background border-border'}`}>
                        {msg.linkPreview.image && <img src={msg.linkPreview.image} alt="preview" className="w-full h-20 object-cover rounded mb-1.5" />}
                        {msg.linkPreview.title && <div className="font-semibold truncate">{msg.linkPreview.title}</div>}
                        {msg.linkPreview.description && <div className="line-clamp-2 opacity-80 mt-0.5">{msg.linkPreview.description}</div>}
                      </div>
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
                              className={`rounded-full px-1.5 py-0.5 text-xs flex items-center gap-0.5 transition-colors
                                ${hasReacted(emoji)
                                  ? (isMine ? 'bg-white/20 text-white border border-white/30' : 'bg-primary/20 border border-primary/40 text-primary')
                                  : (isMine ? 'bg-white/10 border border-white/20 text-primary-foreground/80' : 'bg-black/10 border border-border text-foreground hover:bg-black/20')}`}
                            >
                              <span>{emoji}</span>
                              <span className="font-bold text-[10px]">{count as number}</span>
                            </button>
                          ))}
                        </div>
                      ) : <div />}

                      {/* Time + edited */}
                      <div className={`text-[10px] flex items-center gap-1 flex-shrink-0 ${isMine ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
                        {msg.editedAt && <span className="italic opacity-80">modifié</span>}
                        <span>{msgTime}</span>
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
          <p className="flex-1 text-xs text-primary font-medium truncate">Modifier · {editState.orig}</p>
          <button onClick={() => { setEditState(null); setContent(''); }} className="text-muted-foreground hover:text-foreground p-1 flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Input bar — Base44 style ── */}
      <div className="flex-shrink-0 px-3 py-3 glass border-t border-border/50">
        <div className="flex items-end gap-2">
          {/* + Attachment button */}
          {!voiceActive && (
            <button
              onClick={() => setAttachmentSheetOpen(true)}
              disabled={uploadingImg}
              className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary/20 border border-primary/30 hover:bg-primary/30 text-primary transition-colors flex items-center justify-center mb-0.5"
            >
              {uploadingImg ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
            </button>
          )}

          {/* Voice recorder — replaces input when active */}
          {voiceActive ? (
            <VoiceRecorder
              onSend={handleVoiceSend}
              onCancel={() => setVoiceActive(false)}
            />
          ) : (
            <>
              {/* Text input */}
              <div className="flex-1 glass rounded-2xl border border-border/50 focus-within:border-primary/40 transition-colors flex items-end">
                <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                  <PopoverTrigger asChild>
                    <button className="flex-shrink-0 p-2.5 mb-0.5 text-muted-foreground hover:text-foreground transition-colors">
                      <Smile className="w-5 h-5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-2 glass-strong border-border/50" align="start" side="top">
                    <div className="grid grid-cols-8 gap-0.5">
                      {PICKER_EMOJIS.map(e => (
                        <button key={e} onClick={() => { setContent(p => p + e); setEmojiOpen(false); }}
                          className="text-xl hover:bg-white/10 rounded p-1 transition-colors leading-none">{e}</button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={editState ? uiT.chat.editPlaceholder : uiT.chat.placeholder}
                  className="min-h-[40px] max-h-[120px] border-0 focus-visible:ring-0 resize-none py-2.5 px-0 bg-transparent shadow-none text-sm"
                  rows={1}
                />
              </div>

              {/* Send or Mic */}
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
            className="fixed inset-0 z-[500] flex items-end justify-center pb-4 px-4"
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
              {/* Reactions */}
              <div className="glass-strong rounded-2xl mb-2 flex justify-around items-center p-3">
                {REACTION_EMOJIS.map(emoji => (
                  <button key={emoji} onClick={() => handleReaction(ctxMenu.msgId, emoji)}
                    className="text-2xl hover:scale-125 active:scale-110 transition-transform">{emoji}</button>
                ))}
              </div>

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

                {isMineCtx && (
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
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Poll votes viewer ── */}
      <AnimatePresence>
        {pollVotes && (
          <motion.div
            className="fixed inset-0 z-[500] flex items-end justify-center"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setPollVotes(null)}
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div
              className="relative w-full max-w-lg"
              initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="glass-strong rounded-t-3xl max-h-[70vh] overflow-y-auto">
                <div className="flex items-center justify-between p-4 sticky top-0 glass-strong">
                  <h3 className="font-bold text-foreground">Résultats du vote</h3>
                  <button onClick={() => setPollVotes(null)} className="text-muted-foreground hover:text-foreground p-1">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="px-4 pb-6 space-y-4">
                  {pollVotes.map((opt, i) => (
                    <div key={i}>
                      <p className="text-sm font-semibold text-foreground mb-2">{opt.optionText}</p>
                      {opt.voters.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Aucun vote</p>
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
