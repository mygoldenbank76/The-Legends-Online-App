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
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  ArrowLeft, Loader2, Send, Paperclip, Smile,
  Reply, Pin, Pencil, Trash2, Languages, X, Check, PinOff,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '😡', '🔥'];
const PICKER_EMOJIS = ['😀','😂','🤣','😊','😍','🥰','😘','😋','😎','🤩','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫','🥱','😴','😌','😛','😜','😝','🤤','😒','😓','😔','😕','🙃','🤑','😲','☹️','🙁','😖','😞','😟','😤','😢','😭','😦','😧','😨','😩','🤯','😬','😰','😱','🥵','🥶','😳','🤪','😵','😡','😠','🤬','😷','🤒','🤕','🤢','🤮','🤧','😇','🥳','🥺','🤠','🤡','🤥','🤫','🤭','🧐','🤓','😈','👿','👹','👺','💀','👻','👽','👾','🤖'];

type Msg = {
  id: number;
  conversationId: number;
  senderId: number;
  sender?: { id: number; displayName: string; avatar?: string | null };
  content?: string | null;
  imageUrl?: string | null;
  linkPreview?: { url: string; title?: string | null; description?: string | null; image?: string | null } | null;
  replyTo?: Msg | null;
  editedAt?: string | null;
  isDeleted?: boolean;
  reactions: Array<{ id: number; messageId: number; userId: number; emoji: string }>;
  createdAt: string;
};

type ChatAreaProps = { conversationId: number; onBack?: () => void };
type CtxMenu = { msgId: number } | null;
type TranslateEntry = { msgId: number; text: string };

async function translateText(text: string): Promise<string> {
  const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=|fr`);
  const d = await r.json();
  return d.responseData?.translatedText ?? text;
}

export function ChatArea({ conversationId, onBack }: ChatAreaProps) {
  const { user } = useAuth();
  const { socket, joinConversation } = useSocket();
  const queryClient = useQueryClient();

  const { data: rawMessages, isLoading } = useListMessages(conversationId);
  const { data: conversation } = useGetConversation(conversationId);
  const markRead = useMarkConversationRead();
  const sendMsg = useSendMessage();
  const addReaction = useAddReaction();
  const uploadImage = useUploadImage();
  const editMsg = useEditMessage();
  const deleteMsg = useDeleteMessage();
  const pinMsg = usePinMessage();

  // Filter out deleted messages from view
  const messages = (rawMessages as Msg[] | undefined)?.filter(m => !m.isDeleted);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  // ── Scroll to bottom ─────────────────────────────────────────
  const scrollBottom = useCallback((delay = 0) => {
    setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, delay);
  }, []);

  // Scroll when new messages arrive
  useEffect(() => {
    const count = messages?.length ?? 0;
    if (count !== prevMsgCount) {
      setPrevMsgCount(count);
      scrollBottom(50);
    }
  }, [messages, prevMsgCount, scrollBottom]);

  // Scroll on conversation switch
  useEffect(() => {
    scrollBottom(120);
  }, [conversationId, scrollBottom]);

  // Mark read
  useEffect(() => {
    if (conversationId && messages && messages.length > 0) {
      markRead.mutate({ conversationId });
    }
  }, [conversationId, messages?.length]);


  // ── Cache invalidation ────────────────────────────────────────
  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(conversationId) });
    queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
  }, [queryClient, conversationId]);

  // ── Send / Edit ───────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    // Edit mode
    if (editState) {
      const trimmed = content.trim();
      if (!trimmed) return;
      setContent('');
      const id = editState.id;
      setEditState(null);
      try {
        await editMsg.mutateAsync({ messageId: id, data: { content: trimmed } });
        invalidate();
      } catch (e) { console.error(e); }
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
      invalidate();
      scrollBottom(80);
    } catch { setContent(trimmed); }
    finally { setSending(false); }
  }, [content, sending, editState, replyTo, conversationId, sendMsg, editMsg, invalidate, scrollBottom]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    if (e.key === 'Escape') { setEditState(null); setReplyTo(null); setContent(''); }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploadingImg(true);
      const res = await uploadImage.mutateAsync({ data: { file } });
      await sendMsg.mutateAsync({ conversationId, data: { imageUrl: res.url, replyToId: replyTo?.id } });
      setReplyTo(null);
      invalidate();
      scrollBottom(80);
    } catch (err) { console.error(err); }
    finally { setUploadingImg(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  };

  // ── Context menu ──────────────────────────────────────────────
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
    try {
      await deleteMsg.mutateAsync({ messageId: msgId });
      invalidate();
    } catch (e) { console.error(e); }
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
    // Toggle off
    if (translations.find(t => t.msgId === msg.id)) {
      setTranslations(p => p.filter(t => t.msgId !== msg.id));
      return;
    }
    setTranslatingId(msg.id);
    try {
      const text = await translateText(msg.content);
      setTranslations(p => [...p, { msgId: msg.id, text }]);
    } catch { /* silent */ }
    finally { setTranslatingId(null); }
  };

  const handleReaction = async (msgId: number, emoji: string) => {
    closeCtx();
    try {
      await addReaction.mutateAsync({ messageId: msgId, data: { emoji } });
      invalidate();
    } catch (e) { console.error(e); }
  };

  // ── Swipe to reply (right swipe = reply, for ALL messages) ────
  const onTouchStart = (e: React.TouchEvent, msg: Msg) => {
    swipeStartX.current = e.touches[0].clientX;
    swipeStartY.current = e.touches[0].clientY;
    isSwiping.current = false;
    // Long press for context menu
    longPressTimer.current = setTimeout(() => {
      if (!isSwiping.current) {
        openCtxMenu({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY }, msg);
      }
    }, 500);
  };

  const onTouchMove = (e: React.TouchEvent, msgId: number) => {
    const dx = e.touches[0].clientX - swipeStartX.current;
    const dy = Math.abs(e.touches[0].clientY - swipeStartY.current);

    // If primarily vertical, let native scroll handle it
    if (dy > 15 && dy > Math.abs(dx)) {
      if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
      return;
    }

    // Rightward swipe only
    if (dx > 8) {
      isSwiping.current = true;
      if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
      const clamped = Math.min(dx, 80);
      setSwipingId(msgId);
      setSwipeOffsets(p => ({ ...p, [msgId]: clamped }));
    }
  };

  const onTouchEnd = (e: React.TouchEvent, msg: Msg) => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    const dx = e.changedTouches[0].clientX - swipeStartX.current;
    if (dx > 60 && isSwiping.current) {
      setReplyTo(msg);
      setEditState(null);
    }
    isSwiping.current = false;
    setSwipingId(null);
    setSwipeOffsets(p => ({ ...p, [msg.id]: 0 }));
  };

  // ── Derived ───────────────────────────────────────────────────
  const pinnedMsgId = (conversation as { pinnedMessageId?: number | null } | undefined)?.pinnedMessageId;
  const pinnedMsg = rawMessages?.find(m => m.id === pinnedMsgId) as Msg | undefined;
  const title = conversation?.name || conversation?.participants?.find(p => p.id !== user?.id)?.displayName || 'Chat';
  const avatarUrl = conversation?.type === 'direct' ? conversation?.participants?.find(p => p.id !== user?.id)?.avatar : undefined;
  const otherUser = conversation?.participants?.find(p => p.id !== user?.id);
  const isOnline = otherUser?.isOnline;
  const lastSeen = otherUser?.lastSeen
    ? `vu ${formatDistanceToNow(new Date(otherUser.lastSeen), { addSuffix: true })}`
    : 'hors ligne';

  const ctxMsg = messages?.find(m => m.id === ctxMenu?.msgId);
  const isMineCtx = ctxMsg?.senderId === user?.id;

  // ── Render ────────────────────────────────────────────────────
  return (
    // FIX 1: Strict flex-col, header & input flex-shrink-0, messages flex-1 min-h-0
    <div className="flex flex-col h-full w-full overflow-hidden">

      {/* ── Header (sticky) ── */}
      <div className="flex-shrink-0 h-14 border-b border-border bg-sidebar flex items-center px-4 z-10 shadow-sm">
        {onBack && (
          <Button variant="ghost" size="icon" onClick={onBack} className="mr-2 -ml-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        )}
        <Avatar className="w-9 h-9 mr-3">
          <AvatarImage src={avatarUrl || ''} />
          <AvatarFallback className="bg-primary/20 text-primary">{title.substring(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="flex flex-col flex-1 min-w-0">
          <span className="font-medium text-sm leading-tight text-foreground truncate">{title}</span>
          <span className={`text-xs leading-tight ${isOnline ? 'text-primary' : 'text-muted-foreground'}`}>
            {isOnline ? 'en ligne' : lastSeen}
          </span>
        </div>
      </div>

      {/* ── Pinned message banner (sticky) ── */}
      {pinnedMsg && !pinnedMsg.isDeleted && (
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-primary/10 border-b border-primary/20 text-xs">
          <Pin className="w-3 h-3 text-primary flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-primary font-medium">Message épinglé · </span>
            <span className="text-muted-foreground truncate">{pinnedMsg.content || '📷 Image'}</span>
          </div>
          <button onClick={() => handlePin(pinnedMsg)} className="text-muted-foreground hover:text-foreground p-1">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* ── Messages (scrollable zone) ── */}
      {/* FIX 1: min-h-0 is critical for flex-1 to actually shrink inside a flex container */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-3 pt-4 pb-2 bg-background"
      >
        {isLoading && (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
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
            const isPinned = pinnedMsgId === msg.id;

            return (
              <div
                key={msg.id}
                className={`flex items-end gap-2 ${isMine ? 'justify-end' : 'justify-start'} ${isSameAuthor ? 'mt-0.5' : 'mt-3'}`}
              >
                {/* Avatar (others only) */}
                {!isMine && (
                  <div className="w-7 flex-shrink-0 self-end mb-1">
                    {!isSameAuthor ? (
                      <Avatar className="w-7 h-7">
                        <AvatarImage src={msg.sender?.avatar || ''} />
                        <AvatarFallback className="bg-primary/20 text-primary text-[10px]">
                          {(msg.sender?.displayName || '?').substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    ) : <div className="w-7" />}
                  </div>
                )}

                {/* Swipe reply arrow — appears to the left of the bubble always */}
                <div
                  className="flex items-center self-center"
                  style={{
                    opacity: Math.max(0, Math.min((swipeOffset - 20) / 40, 1)),
                    width: swipeOffset > 0 ? 24 : 0,
                    transition: swipingId === msg.id ? 'none' : 'all 0.2s ease-out',
                    overflow: 'hidden',
                  }}
                >
                  <Reply className="w-4 h-4 text-primary flex-shrink-0" />
                </div>

                {/* Bubble wrapper — swipes right for ALL messages */}
                <div
                  className={`max-w-[75%] relative ${hasReactions ? 'mb-5' : ''}`}
                  style={{
                    transform: `translateX(${swipeOffset}px)`,
                    transition: swipingId === msg.id ? 'none' : 'transform 0.2s ease-out',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                  }}
                  onContextMenu={(e) => openCtxMenu(e, msg)}
                  onTouchStart={(e) => onTouchStart(e, msg)}
                  onTouchMove={(e) => onTouchMove(e, msg.id)}
                  onTouchEnd={(e) => onTouchEnd(e, msg)}
                >
                  {/* Pinned label */}
                  {isPinned && (
                    <div className={`flex items-center gap-0.5 mb-0.5 text-[10px] text-primary ${isMine ? 'justify-end' : 'justify-start'}`}>
                      <Pin className="w-2.5 h-2.5" /><span>épinglé</span>
                    </div>
                  )}

                  {/* ── Bubble ── */}
                  <div
                    className={`rounded-2xl px-3 py-2 text-sm shadow-sm
                      ${isMine
                        ? 'bg-primary text-primary-foreground rounded-br-sm'
                        : 'bg-card text-card-foreground border border-border rounded-bl-sm'
                      }`}
                  >
                    {/* FIX 2: Reply preview INSIDE the bubble, style WhatsApp */}
                    {msg.replyTo && (
                      <div
                        className={`mb-2 rounded-lg overflow-hidden border-l-[3px] border-primary pl-2 pr-2 py-1 text-xs
                          ${isMine ? 'bg-black/10' : 'bg-background/60'}`}
                      >
                        <p className="font-semibold text-primary text-[11px] mb-0.5 truncate">
                          {msg.replyTo.senderId === user?.id ? 'Vous' : msg.replyTo.sender?.displayName}
                        </p>
                        <p className={`truncate ${isMine ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                          {msg.replyTo.content || '📷 Image'}
                        </p>
                      </div>
                    )}

                    {/* Image */}
                    {msg.imageUrl && (
                      <div className="mb-2 -mx-1 -mt-1 overflow-hidden rounded-xl">
                        <img src={msg.imageUrl} alt="attached" className="max-w-full max-h-64 object-cover rounded-xl" />
                      </div>
                    )}

                    {/* Text content */}
                    {msg.content && (
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

                    {/* Time + edited */}
                    <div className={`text-[10px] mt-1 flex items-center justify-end gap-1 ${isMine ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
                      {msg.editedAt && <span className="italic opacity-80">modifié</span>}
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>

                  {/* Reactions row */}
                  {hasReactions && (
                    <div className={`absolute -bottom-5 flex gap-1 ${isMine ? 'right-0' : 'left-0'}`}>
                      {Object.entries(reactionCounts).map(([emoji, count]) => (
                        <button
                          key={emoji}
                          onClick={(e) => { e.stopPropagation(); handleReaction(msg.id, emoji); }}
                          className={`rounded-full px-1.5 py-0.5 text-xs flex items-center gap-1 shadow border transition-colors
                            ${hasReacted(emoji)
                              ? 'bg-primary/20 border-primary/40 text-primary'
                              : 'bg-card border-border text-foreground hover:bg-muted'}`}
                        >
                          <span>{emoji}</span>
                          {(count as number) > 1 && <span className="font-medium text-[10px]">{count as number}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Reply bar (sticky, above input) ── */}
      {replyTo && (
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-sidebar border-t border-primary/20">
          <Reply className="w-4 h-4 text-primary flex-shrink-0" />
          <div className="flex-1 min-w-0 border-l-2 border-primary pl-2">
            <p className="text-[11px] text-primary font-semibold truncate">
              {replyTo.senderId === user?.id ? 'Vous' : replyTo.sender?.displayName}
            </p>
            <p className="text-xs text-muted-foreground truncate">{replyTo.content || '📷 Image'}</p>
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

      {/* ── Input bar (sticky) ── */}
      <div className="flex-shrink-0 px-3 py-2.5 bg-sidebar border-t border-border">
        <div className="flex items-end gap-2 max-w-4xl mx-auto">
          <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />

          <Button variant="ghost" size="icon"
            onClick={() => fileInputRef.current?.click()} disabled={uploadingImg}
            className="flex-shrink-0 text-muted-foreground hover:text-foreground mb-0.5"
          >
            {uploadingImg ? <Loader2 className="w-5 h-5 animate-spin" /> : <Paperclip className="w-5 h-5" />}
          </Button>

          <div className="flex-1 bg-input rounded-2xl border border-border focus-within:border-primary/50 flex items-end transition-colors">
            <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="flex-shrink-0 mb-0.5 text-muted-foreground hover:text-foreground">
                  <Smile className="w-5 h-5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-2" align="start" side="top">
                <div className="grid grid-cols-8 gap-1">
                  {PICKER_EMOJIS.map(e => (
                    <button key={e} onClick={() => { setContent(p => p + e); setEmojiOpen(false); }}
                      className="text-xl hover:bg-muted rounded p-1 transition-colors leading-none">{e}</button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={editState ? 'Modifier…' : 'Message'}
              className="min-h-[40px] max-h-[120px] border-0 focus-visible:ring-0 resize-none py-2.5 px-1 bg-transparent shadow-none text-sm"
              rows={1}
            />
          </div>

          <Button size="icon" onClick={handleSend}
            disabled={(!content.trim() && !uploadingImg) || sending}
            className="flex-shrink-0 rounded-full w-10 h-10 bg-primary hover:bg-primary/90 text-primary-foreground shadow-md mb-0.5 active:scale-95 transition-all"
          >
            {sending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : editState ? <Check className="w-4 h-4" /> : <Send className="w-4 h-4 ml-0.5" />}
          </Button>
        </div>
      </div>

      {/* ── Context Menu — Base44 bottom-sheet style ── */}
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
            {/* Blur overlay */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

            {/* Menu card — slides up from bottom */}
            <motion.div
              className="relative w-full max-w-sm"
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Emoji reactions row */}
              <div className="glass-strong rounded-2xl mb-2 flex justify-around items-center p-3">
                {REACTION_EMOJIS.map(emoji => (
                  <button
                    key={emoji}
                    onClick={() => handleReaction(ctxMenu.msgId, emoji)}
                    className="text-2xl hover:scale-125 active:scale-110 transition-transform"
                  >{emoji}</button>
                ))}
              </div>

              {/* Actions */}
              <div className="glass-strong rounded-2xl overflow-hidden">
                <SheetItem
                  icon={<Reply size={18} />}
                  label="Répondre"
                  onClick={() => ctxMsg && handleReply(ctxMsg)}
                />

                {ctxMsg.content && (
                  <SheetItem
                    icon={translatingId === ctxMenu.msgId
                      ? <Loader2 size={18} className="animate-spin" />
                      : <Languages size={18} />}
                    label={translations.find(t => t.msgId === ctxMenu.msgId) ? 'Masquer traduction' : 'Traduire'}
                    onClick={() => ctxMsg && handleTranslate(ctxMsg)}
                    divider
                  />
                )}

                <SheetItem
                  icon={pinnedMsgId === ctxMenu.msgId ? <PinOff size={18} /> : <Pin size={18} />}
                  label={pinnedMsgId === ctxMenu.msgId ? 'Désépingler' : 'Épingler'}
                  onClick={() => ctxMsg && handlePin(ctxMsg)}
                  divider
                />

                {isMineCtx && ctxMsg.content && (
                  <SheetItem
                    icon={<Pencil size={18} />}
                    label="Modifier"
                    onClick={() => ctxMsg && handleEdit(ctxMsg)}
                    divider
                  />
                )}

                {isMineCtx && (
                  deleteConfirm === ctxMenu.msgId ? (
                    <div
                      className="flex items-center gap-3 px-4 py-3.5 border-t border-white/5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="text-sm text-red-400 flex-1">Confirmer la suppression ?</span>
                      <button
                        onClick={() => handleDeleteConfirm(ctxMenu.msgId)}
                        className="text-xs font-semibold bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg transition-colors"
                      >Oui</button>
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >Non</button>
                    </div>
                  ) : (
                    <SheetItem
                      icon={<Trash2 size={18} className="text-red-400" />}
                      label="Supprimer"
                      labelCls="text-red-400"
                      onClick={() => setDeleteConfirm(ctxMenu.msgId)}
                      divider
                    />
                  )
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SheetItem({
  icon, label, onClick, labelCls = '', divider = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  labelCls?: string;
  divider?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 w-full px-4 py-3.5 hover:bg-white/8 active:bg-white/10 transition-all text-left ${divider ? 'border-t border-white/5' : ''}`}
    >
      <span className="text-muted-foreground flex-shrink-0">{icon}</span>
      <span className={`text-sm font-medium ${labelCls}`}>{label}</span>
    </button>
  );
}
