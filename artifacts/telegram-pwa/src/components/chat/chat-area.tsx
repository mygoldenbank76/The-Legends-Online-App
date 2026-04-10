import { useEffect, useRef, useState, useCallback } from 'react';
import {
  useListMessages, useGetConversation, useSendMessage,
  useMarkConversationRead, useAddReaction, useUploadImage,
  useEditMessage, useDeleteMessage, usePinMessage,
  getListMessagesQueryKey, getListConversationsQueryKey, getGetConversationQueryKey
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { useSocket } from '@/lib/socket-context';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  ArrowLeft, Loader2, Send, Paperclip, Smile,
  Reply, Pin, Pencil, Trash2, Languages, X, Check, PinOff
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '😡', '🔥'];
const PICKER_EMOJIS = ['😀','😂','🤣','😊','😍','🥰','😘','😋','😎','🤩','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫','🥱','😴','😌','😛','😜','😝','🤤','😒','😓','😔','😕','🙃','🤑','😲','☹️','🙁','😖','😞','😟','😤','😢','😭','😦','😧','😨','😩','🤯','😬','😰','😱','🥵','🥶','😳','🤪','😵','😡','😠','🤬','😷','🤒','🤕','🤢','🤮','🤧','😇','🥳','🥺','🤠','🤡','🤥','🤫','🤭','🧐','🤓','😈','👿','👹','👺','💀','👻','👽','👾','🤖'];

type Message = {
  id: number;
  conversationId: number;
  senderId: number;
  sender?: { id: number; displayName: string; avatar?: string | null };
  content?: string | null;
  imageUrl?: string | null;
  linkPreview?: { url: string; title?: string | null; description?: string | null; image?: string | null } | null;
  replyTo?: Message | null;
  editedAt?: string | null;
  isDeleted?: boolean;
  reactions: Array<{ id: number; messageId: number; userId: number; emoji: string }>;
  createdAt: string;
};

type ChatAreaProps = {
  conversationId: number;
  onBack?: () => void;
};

type ContextMenuState = { messageId: number; x: number; y: number } | null;
type ReplyState = Message | null;
type EditState = { messageId: number; content: string } | null;
type TranslateState = { messageId: number; translated: string } | null;

async function translateText(text: string): Promise<string> {
  const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=|fr`);
  const data = await res.json();
  return data.responseData?.translatedText || text;
}

export function ChatArea({ conversationId, onBack }: ChatAreaProps) {
  const { user } = useAuth();
  const { socket, joinConversation } = useSocket();
  const queryClient = useQueryClient();

  const { data: messages, isLoading } = useListMessages(conversationId);
  const { data: conversation } = useGetConversation(conversationId);
  const markRead = useMarkConversationRead();
  const sendMessage = useSendMessage();
  const addReaction = useAddReaction();
  const uploadImage = useUploadImage();
  const editMessage = useEditMessage();
  const deleteMessage = useDeleteMessage();
  const pinMessage = usePinMessage();

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeStartX = useRef<number>(0);
  const swipeStartY = useRef<number>(0);
  const swipeEl = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const [content, setContent] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [replyTo, setReplyTo] = useState<ReplyState>(null);
  const [editState, setEditState] = useState<EditState>(null);
  const [translateState, setTranslateState] = useState<TranslateState>(null);
  const [translating, setTranslating] = useState<number | null>(null);
  const [swipeOffsets, setSwipeOffsets] = useState<Record<number, number>>({});
  const [swipingId, setSwipingId] = useState<number | null>(null);
  const [lastMessageCount, setLastMessageCount] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [reactionPopover, setReactionPopover] = useState<number | null>(null);

  // Join socket room
  useEffect(() => {
    if (socket && conversationId) joinConversation(conversationId);
  }, [socket, conversationId, joinConversation]);

  useEffect(() => {
    if (!socket) return;
    const handleConnect = () => joinConversation(conversationId);
    socket.on('connect', handleConnect);
    return () => { socket.off('connect', handleConnect); };
  }, [socket, conversationId, joinConversation]);

  // Auto scroll on new messages
  useEffect(() => {
    const count = messages?.length ?? 0;
    if (count !== lastMessageCount) {
      setLastMessageCount(count);
      setTimeout(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }, 50);
    }
  }, [messages, lastMessageCount]);

  useEffect(() => {
    if (messages && messages.length > 0) {
      setTimeout(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }, 100);
    }
  }, [conversationId]);

  useEffect(() => {
    if (conversationId && messages && messages.length > 0) markRead.mutate({ conversationId });
  }, [conversationId, messages?.length]);

  // Close context menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
        setDeleteConfirm(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(conversationId) });
    queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
  }, [queryClient, conversationId]);

  // ---- SEND ----
  const handleSend = useCallback(async () => {
    if (editState) {
      // Editing mode
      const trimmed = content.trim();
      if (!trimmed) return;
      setContent('');
      const id = editState.messageId;
      setEditState(null);
      try {
        await editMessage.mutateAsync({ messageId: id, data: { content: trimmed } });
        invalidate();
      } catch (e) { console.error(e); }
      return;
    }

    const trimmed = content.trim();
    if (!trimmed || isSending) return;
    setContent('');
    setIsSending(true);
    const replyId = replyTo?.id;
    setReplyTo(null);
    try {
      await sendMessage.mutateAsync({ conversationId, data: { content: trimmed, replyToId: replyId } });
      invalidate();
    } catch (e) {
      setContent(trimmed);
    } finally {
      setIsSending(false);
    }
  }, [content, isSending, editState, replyTo, conversationId, sendMessage, editMessage, invalidate]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    if (e.key === 'Escape') { setEditState(null); setReplyTo(null); setContent(''); }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploadingImage(true);
      const res = await uploadImage.mutateAsync({ data: { file } });
      await sendMessage.mutateAsync({ conversationId, data: { imageUrl: res.url, replyToId: replyTo?.id } });
      setReplyTo(null);
      invalidate();
    } catch (err) { console.error(err); }
    finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ---- CONTEXT MENU ACTIONS ----
  const openContextMenu = (e: React.MouseEvent | React.TouchEvent, msg: Message) => {
    e.preventDefault();
    setReactionPopover(null);
    let x = 0; let y = 0;
    if ('clientX' in e) { x = e.clientX; y = e.clientY; }
    else if (e.touches[0]) { x = e.touches[0].clientX; y = e.touches[0].clientY; }
    setContextMenu({ messageId: msg.id, x, y });
    setDeleteConfirm(null);
  };

  const handleReply = (msg: Message) => {
    setReplyTo(msg);
    setEditState(null);
    setContextMenu(null);
  };

  const handleEdit = (msg: Message) => {
    setEditState({ messageId: msg.id, content: msg.content || '' });
    setContent(msg.content || '');
    setReplyTo(null);
    setContextMenu(null);
  };

  const handleDeleteConfirm = async (messageId: number) => {
    setContextMenu(null);
    setDeleteConfirm(null);
    try {
      await deleteMessage.mutateAsync({ messageId });
      invalidate();
    } catch (e) { console.error(e); }
  };

  const handlePin = async (msg: Message) => {
    setContextMenu(null);
    try {
      await pinMessage.mutateAsync({ messageId: msg.id });
      queryClient.invalidateQueries({ queryKey: getGetConversationQueryKey(conversationId) });
      queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
      invalidate();
    } catch (e) { console.error(e); }
  };

  const handleTranslate = async (msg: Message) => {
    setContextMenu(null);
    if (!msg.content) return;
    if (translateState?.messageId === msg.id) { setTranslateState(null); return; }
    setTranslating(msg.id);
    try {
      const translated = await translateText(msg.content);
      setTranslateState({ messageId: msg.id, translated });
    } catch { setTranslateState(null); }
    finally { setTranslating(null); }
  };

  const handleReaction = async (messageId: number, emoji: string) => {
    setReactionPopover(null);
    setContextMenu(null);
    try {
      await addReaction.mutateAsync({ messageId, data: { emoji } });
      invalidate();
    } catch (e) { console.error(e); }
  };

  // ---- SWIPE TO REPLY ----
  const onTouchStart = (e: React.TouchEvent, msg: Message) => {
    if (msg.isDeleted) return;
    swipeStartX.current = e.touches[0].clientX;
    swipeStartY.current = e.touches[0].clientY;
    longPressTimer.current = setTimeout(() => openContextMenu(e, msg), 500);
  };

  const onTouchMove = (e: React.TouchEvent, msgId: number) => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    const dx = e.touches[0].clientX - swipeStartX.current;
    const dy = Math.abs(e.touches[0].clientY - swipeStartY.current);
    if (dy > 20) return; // vertical scroll takes precedence
    if (dx > 0) {
      const clamped = Math.min(dx, 80);
      setSwipingId(msgId);
      setSwipeOffsets(prev => ({ ...prev, [msgId]: clamped }));
    }
  };

  const onTouchEnd = (e: React.TouchEvent, msg: Message) => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    const dx = e.changedTouches[0].clientX - swipeStartX.current;
    if (dx > 60 && !msg.isDeleted) {
      setReplyTo(msg);
      setEditState(null);
    }
    setSwipingId(null);
    setSwipeOffsets(prev => ({ ...prev, [msg.id]: 0 }));
  };

  // ---- DERIVED ----
  const pinnedMsgId = (conversation as { pinnedMessageId?: number | null } | undefined)?.pinnedMessageId;
  const pinnedMsg = messages?.find(m => m.id === pinnedMsgId);
  const title = conversation?.name || conversation?.participants?.find(p => p.id !== user?.id)?.displayName || 'Chat';
  const avatarUrl = conversation?.type === 'direct' ? conversation?.participants?.find(p => p.id !== user?.id)?.avatar : undefined;
  const otherUser = conversation?.participants?.find(p => p.id !== user?.id);
  const isOnline = otherUser?.isOnline;
  const lastSeen = otherUser?.lastSeen ? `last seen ${formatDistanceToNow(new Date(otherUser.lastSeen), { addSuffix: true })}` : 'offline';

  const contextMsg = messages?.find(m => m.id === contextMenu?.messageId) as Message | undefined;
  const isMineContext = contextMsg?.senderId === user?.id;

  return (
    <div className="flex flex-col h-full w-full relative">

      {/* Header */}
      <div className="h-14 border-b border-border bg-sidebar flex items-center px-4 flex-shrink-0 z-10 shadow-sm">
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

      {/* Pinned message banner */}
      {pinnedMsg && !pinnedMsg.isDeleted && (
        <div className="flex items-center gap-2 px-4 py-2 bg-primary/10 border-b border-primary/20 text-xs">
          <Pin className="w-3 h-3 text-primary flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-primary font-medium">Message épinglé</span>
            <p className="text-muted-foreground truncate">{pinnedMsg.content || '📷 Image'}</p>
          </div>
          <button
            onClick={() => handlePin(pinnedMsg as Message)}
            className="text-muted-foreground hover:text-foreground p-1"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pt-4 pb-6 bg-background">
        {isLoading && (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        <div className="flex flex-col gap-1">
          {(messages as Message[] | undefined)?.map((msg, index) => {
            const isMine = msg.senderId === user?.id;
            const prevMsg = (messages as Message[])[index - 1];
            const isSameAuthor = prevMsg && prevMsg.senderId === msg.senderId;
            const hasReactions = Object.keys(
              msg.reactions.reduce((a: Record<string, number>, r) => { a[r.emoji] = (a[r.emoji] || 0) + 1; return a; }, {})
            ).length > 0;
            const reactionCounts = msg.reactions.reduce((a: Record<string, number>, r) => { a[r.emoji] = (a[r.emoji] || 0) + 1; return a; }, {});
            const hasReacted = (emoji: string) => msg.reactions.some(r => r.emoji === emoji && r.userId === user?.id);
            const swipeOffset = swipeOffsets[msg.id] || 0;
            const isTranslating = translating === msg.id;
            const translation = translateState?.messageId === msg.id ? translateState.translated : null;
            const isPinned = pinnedMsgId === msg.id;

            return (
              <div
                key={msg.id}
                className={`flex ${isMine ? 'justify-end' : 'justify-start'} ${isSameAuthor ? 'mt-0.5' : 'mt-3'}`}
              >
                {!isMine && (
                  <div className="w-8 flex-shrink-0 mr-2 self-end">
                    {!isSameAuthor && (
                      <Avatar className="w-8 h-8">
                        <AvatarImage src={msg.sender?.avatar || ''} />
                        <AvatarFallback className="bg-primary/20 text-primary text-xs">
                          {(msg.sender?.displayName || '?').substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    )}
                  </div>
                )}

                {/* Swipe arrow indicator */}
                {!isMine && swipingId === msg.id && swipeOffset > 20 && (
                  <div
                    className="absolute left-2 flex items-center justify-center transition-opacity"
                    style={{ opacity: Math.min(swipeOffset / 60, 1) }}
                  >
                    <Reply className="w-4 h-4 text-primary" />
                  </div>
                )}
                {isMine && swipingId === msg.id && swipeOffset > 20 && (
                  <div
                    className="absolute right-2 flex items-center justify-center transition-opacity"
                    style={{ opacity: Math.min(swipeOffset / 60, 1) }}
                  >
                    <Reply className="w-4 h-4 text-primary" />
                  </div>
                )}

                <div
                  className={`max-w-[75%] relative ${hasReactions ? 'mb-5' : ''}`}
                  style={{
                    transform: `translateX(${isMine ? -swipeOffset : swipeOffset}px)`,
                    transition: swipingId === msg.id ? 'none' : 'transform 0.2s ease-out',
                  }}
                  onContextMenu={(e) => { if (!msg.isDeleted) openContextMenu(e, msg); }}
                  onTouchStart={(e) => onTouchStart(e, msg)}
                  onTouchMove={(e) => onTouchMove(e, msg.id)}
                  onTouchEnd={(e) => onTouchEnd(e, msg)}
                >
                  {/* Pinned indicator */}
                  {isPinned && (
                    <div className={`flex items-center gap-1 mb-0.5 ${isMine ? 'justify-end' : 'justify-start'}`}>
                      <Pin className="w-2.5 h-2.5 text-primary" />
                      <span className="text-[10px] text-primary">épinglé</span>
                    </div>
                  )}

                  {/* Reply preview inside bubble */}
                  {msg.replyTo && !msg.isDeleted && (
                    <div className={`mb-1 rounded-lg px-2 py-1 text-xs border-l-2 border-primary ${isMine ? 'bg-primary/20 text-primary-foreground/80' : 'bg-muted text-muted-foreground'}`}>
                      <div className="font-medium text-primary text-[10px]">
                        {msg.replyTo.senderId === user?.id ? 'Vous' : msg.replyTo.sender?.displayName}
                      </div>
                      <div className="truncate">
                        {msg.replyTo.isDeleted ? 'Message supprimé' : (msg.replyTo.content || '📷 Image')}
                      </div>
                    </div>
                  )}

                  <div
                    className={`rounded-2xl px-3 py-2 text-sm shadow-sm select-none
                      ${msg.isDeleted
                        ? 'bg-muted text-muted-foreground italic border border-border rounded-2xl'
                        : isMine
                          ? 'bg-primary text-primary-foreground rounded-br-sm'
                          : 'bg-card text-card-foreground border border-border rounded-bl-sm'
                      }`}
                  >
                    {msg.isDeleted ? (
                      <span className="flex items-center gap-1 text-xs">
                        <Trash2 className="w-3 h-3" /> Message supprimé
                      </span>
                    ) : (
                      <>
                        {msg.imageUrl && (
                          <div className="mb-2 -mx-1 -mt-1 overflow-hidden rounded-xl">
                            <img src={msg.imageUrl} alt="attached" className="max-w-full max-h-64 object-cover rounded-xl" />
                          </div>
                        )}
                        {msg.content && <div className="whitespace-pre-wrap break-words">{msg.content}</div>}

                        {/* Translation */}
                        {(isTranslating || translation) && (
                          <div className={`mt-2 pt-2 border-t text-xs ${isMine ? 'border-primary-foreground/20 text-primary-foreground/80' : 'border-border text-muted-foreground'}`}>
                            <div className="flex items-center gap-1 mb-1">
                              <Languages className="w-3 h-3" />
                              <span className="font-medium">Traduction</span>
                            </div>
                            {isTranslating ? <Loader2 className="w-3 h-3 animate-spin" /> : <p>{translation}</p>}
                          </div>
                        )}

                        {msg.linkPreview && (
                          <div className={`mt-2 rounded-lg p-2 text-xs border overflow-hidden ${isMine ? 'bg-primary-foreground/10 border-primary-foreground/20' : 'bg-background border-border'}`}>
                            {msg.linkPreview.image && <img src={msg.linkPreview.image} alt="preview" className="w-full h-24 object-cover rounded mb-2" />}
                            {msg.linkPreview.title && <div className="font-semibold truncate mb-1">{msg.linkPreview.title}</div>}
                            {msg.linkPreview.description && <div className="line-clamp-2 opacity-80">{msg.linkPreview.description}</div>}
                          </div>
                        )}

                        <div className={`text-[10px] mt-1 flex items-center justify-end gap-1 ${isMine ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                          {msg.editedAt && <span className="italic">modifié</span>}
                          {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Reactions */}
                  {hasReactions && !msg.isDeleted && (
                    <div className={`absolute -bottom-5 flex gap-1 ${isMine ? 'right-0' : 'left-0'}`}>
                      {Object.entries(reactionCounts).map(([emoji, count]) => (
                        <Popover key={emoji} open={reactionPopover === msg.id} onOpenChange={(o) => setReactionPopover(o ? msg.id : null)}>
                          <PopoverTrigger asChild>
                            <div
                              onClick={(e) => { e.stopPropagation(); handleReaction(msg.id, emoji); }}
                              className={`rounded-full px-1.5 py-0.5 text-xs flex items-center gap-1 shadow border cursor-pointer transition-colors
                                ${hasReacted(emoji) ? 'bg-primary/20 border-primary/30 text-primary' : 'bg-card border-border text-foreground hover:bg-muted'}`}
                            >
                              <span>{emoji}</span>
                              {(count as number) > 1 && <span className="font-medium text-[10px]">{count as number}</span>}
                            </div>
                          </PopoverTrigger>
                        </Popover>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Reply preview bar */}
      {replyTo && (
        <div className="flex items-center gap-2 px-4 py-2 bg-sidebar border-t border-border">
          <Reply className="w-4 h-4 text-primary flex-shrink-0" />
          <div className="flex-1 min-w-0 border-l-2 border-primary pl-2">
            <p className="text-xs text-primary font-medium">
              {replyTo.senderId === user?.id ? 'Vous' : replyTo.sender?.displayName}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {replyTo.content || '📷 Image'}
            </p>
          </div>
          <button onClick={() => setReplyTo(null)} className="text-muted-foreground hover:text-foreground p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Edit mode bar */}
      {editState && (
        <div className="flex items-center gap-2 px-4 py-2 bg-sidebar border-t border-primary/30">
          <Pencil className="w-4 h-4 text-primary flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-primary font-medium">Modifier le message</p>
          </div>
          <button onClick={() => { setEditState(null); setContent(''); }} className="text-muted-foreground hover:text-foreground p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Input bar */}
      <div className="p-3 bg-sidebar border-t border-border flex-shrink-0 z-10">
        <div className="flex items-end gap-2 max-w-4xl mx-auto">
          <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
          <Button
            variant="ghost" size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingImage}
            className="flex-shrink-0 text-muted-foreground hover:text-foreground mb-0.5"
          >
            {uploadingImage ? <Loader2 className="w-5 h-5 animate-spin" /> : <Paperclip className="w-5 h-5" />}
          </Button>

          <div className="flex-1 bg-input rounded-2xl border border-border focus-within:border-primary/50 flex items-end transition-colors">
            <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="flex-shrink-0 mb-0.5 text-muted-foreground hover:text-foreground">
                  <Smile className="w-5 h-5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-2" align="start" side="top">
                <div className="grid grid-cols-8 gap-1">
                  {PICKER_EMOJIS.map(emoji => (
                    <button
                      key={emoji}
                      onClick={() => { setContent(p => p + emoji); setEmojiPickerOpen(false); }}
                      className="text-xl hover:bg-muted rounded p-1 transition-colors leading-none"
                    >{emoji}</button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={editState ? 'Modifier le message…' : 'Message'}
              className="min-h-[40px] max-h-[120px] border-0 focus-visible:ring-0 resize-none py-2.5 px-1 bg-transparent shadow-none text-sm"
              rows={1}
            />
          </div>

          <Button
            size="icon"
            onClick={handleSend}
            disabled={(!content.trim() && !uploadingImage) || isSending}
            className="flex-shrink-0 rounded-full w-10 h-10 bg-primary hover:bg-primary/90 text-primary-foreground shadow-md mb-0.5 transition-all active:scale-95"
          >
            {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : editState ? <Check className="w-4 h-4" /> : <Send className="w-4 h-4 ml-0.5" />}
          </Button>
        </div>
      </div>

      {/* Context Menu (dark Telegram style) */}
      {contextMenu && contextMsg && (
        <div className="fixed inset-0 z-50" onClick={() => { setContextMenu(null); setDeleteConfirm(null); }}>
          {/* Emoji reaction strip */}
          <div
            ref={contextMenuRef}
            className="fixed z-50 flex flex-col overflow-hidden rounded-2xl shadow-2xl bg-[#212d3b] border border-white/10"
            style={{
              left: Math.min(contextMenu.x, window.innerWidth - 220),
              top: Math.min(contextMenu.y - 60, window.innerHeight - 320),
              minWidth: 200,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Reaction strip */}
            <div className="flex items-center gap-1 px-3 py-2 border-b border-white/10 bg-[#1a2433]">
              {REACTION_EMOJIS.map(emoji => (
                <button
                  key={emoji}
                  onClick={() => handleReaction(contextMenu.messageId, emoji)}
                  className="text-xl hover:scale-125 transition-transform p-0.5 rounded"
                >
                  {emoji}
                </button>
              ))}
            </div>

            {/* Menu items */}
            <div className="py-1">
              <ContextMenuItem icon={<Reply className="w-4 h-4" />} label="Répondre" onClick={() => contextMsg && handleReply(contextMsg)} />
              {contextMsg.content && !contextMsg.isDeleted && (
                <ContextMenuItem
                  icon={isTranslatingCtx(translating, contextMenu.messageId) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Languages className="w-4 h-4" />}
                  label={translateState?.messageId === contextMenu.messageId ? 'Masquer la traduction' : 'Traduire'}
                  onClick={() => contextMsg && handleTranslate(contextMsg)}
                />
              )}
              <ContextMenuItem
                icon={pinnedMsgId === contextMenu.messageId ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
                label={pinnedMsgId === contextMenu.messageId ? 'Désépingler' : 'Épingler'}
                onClick={() => contextMsg && handlePin(contextMsg)}
              />
              {isMineContext && !contextMsg.isDeleted && contextMsg.content && (
                <ContextMenuItem icon={<Pencil className="w-4 h-4" />} label="Modifier" onClick={() => contextMsg && handleEdit(contextMsg)} />
              )}
              {isMineContext && !contextMsg.isDeleted && (
                deleteConfirm === contextMenu.messageId ? (
                  <div className="flex items-center gap-2 px-4 py-2.5">
                    <span className="text-sm text-red-400 flex-1">Supprimer ?</span>
                    <button
                      onClick={() => handleDeleteConfirm(contextMenu.messageId)}
                      className="text-xs bg-red-500 text-white px-2 py-1 rounded-lg hover:bg-red-600"
                    >Oui</button>
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >Non</button>
                  </div>
                ) : (
                  <ContextMenuItem
                    icon={<Trash2 className="w-4 h-4 text-red-400" />}
                    label="Supprimer"
                    labelClass="text-red-400"
                    onClick={() => setDeleteConfirm(contextMenu.messageId)}
                  />
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function isTranslatingCtx(translating: number | null, id: number) {
  return translating === id;
}

function ContextMenuItem({
  icon, label, onClick, labelClass = 'text-[#e8eaed]'
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  labelClass?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left"
    >
      <span className="text-[#8b9bb4]">{icon}</span>
      <span className={`text-sm font-medium ${labelClass}`}>{label}</span>
    </button>
  );
}
