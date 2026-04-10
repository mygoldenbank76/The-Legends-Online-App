import { useEffect, useRef, useState } from 'react';
import { useListMessages, useGetConversation, useSendMessage, useMarkConversationRead, useAddReaction, useUploadImage } from '@workspace/api-client-react';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, Send, Paperclip, Smile, Image as ImageIcon } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Textarea } from '@/components/ui/textarea';
import { useSocket } from '@/lib/socket-context';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatDistanceToNow } from 'date-fns';

const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '😡', '🔥'];

type ChatAreaProps = {
  conversationId: number;
  onBack?: () => void;
};

export function ChatArea({ conversationId, onBack }: ChatAreaProps) {
  const { user } = useAuth();
  const { socket } = useSocket();
  const { data: messages, isLoading } = useListMessages(conversationId);
  const { data: conversation } = useGetConversation(conversationId);
  const markRead = useMarkConversationRead();
  const sendMessage = useSendMessage();
  const addReaction = useAddReaction();
  const uploadImage = useUploadImage();
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [content, setContent] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState<number | null>(null);

  useEffect(() => {
    if (socket && conversationId) {
      socket.emit('join_conversation', conversationId);
    }
  }, [socket, conversationId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    if (conversationId) {
      markRead.mutate({ conversationId });
    }
  }, [messages, conversationId]);

  const handleSend = async () => {
    if (!content.trim() && !isSending) return;
    try {
      setIsSending(true);
      await sendMessage.mutateAsync({ conversationId, data: { content: content.trim() } });
      setContent("");
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    try {
      setUploadingImage(true);
      const res = await uploadImage.mutateAsync({ data: { file } });
      await sendMessage.mutateAsync({ conversationId, data: { imageUrl: res.url } });
    } catch (err) {
      console.error(err);
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleReaction = async (messageId: number, emoji: string) => {
    try {
      await addReaction.mutateAsync({ messageId, data: { emoji } });
      setContextMenuOpen(null);
    } catch (e) {
      console.error(e);
    }
  };

  const title = conversation?.name || conversation?.participants.find(p => p.id !== user?.id)?.displayName || "Chat";
  const avatarUrl = conversation?.type === 'direct' ? conversation?.participants.find(p => p.id !== user?.id)?.avatar : undefined;
  const otherUser = conversation?.participants.find(p => p.id !== user?.id);
  const isOnline = otherUser?.isOnline;
  const lastSeen = otherUser?.lastSeen ? `last seen ${formatDistanceToNow(new Date(otherUser.lastSeen), { addSuffix: true })}` : 'offline';

  return (
    <div className="flex flex-col h-full w-full">
      <div className="h-14 border-b border-border bg-sidebar flex items-center px-4 flex-shrink-0 z-10 shadow-sm">
        {onBack && (
          <Button variant="ghost" size="icon" onClick={onBack} className="mr-2 -ml-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        )}
        <Avatar className="w-9 h-9 mr-3">
          <AvatarImage src={avatarUrl || ""} />
          <AvatarFallback className="bg-primary/20 text-primary">{title.substring(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="flex flex-col">
          <span className="font-medium text-sm leading-tight text-foreground">{title}</span>
          <span className={`text-xs leading-tight ${isOnline ? 'text-primary' : 'text-muted-foreground'}`}>
            {isOnline ? 'online' : lastSeen}
          </span>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-background pb-8">
        {isLoading && (
          <div className="flex justify-center py-4">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}
        
        {messages?.slice().reverse().map((msg) => {
          const isMine = msg.senderId === user?.id;
          
          // Group reactions by emoji
          const reactionCounts = msg.reactions.reduce((acc, r) => {
            acc[r.emoji] = (acc[r.emoji] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          
          const hasReacted = (emoji: string) => msg.reactions.some(r => r.emoji === emoji && r.userId === user?.id);

          return (
            <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
              <Popover open={contextMenuOpen === msg.id} onOpenChange={(open) => setContextMenuOpen(open ? msg.id : null)}>
                <PopoverTrigger asChild>
                  <div 
                    className={`max-w-[75%] relative group cursor-pointer animate-in fade-in slide-in-from-bottom-2 duration-300`}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenuOpen(msg.id);
                    }}
                  >
                    <div className={`rounded-2xl px-3 py-2 text-sm shadow-sm ${isMine ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-card text-card-foreground border border-border rounded-bl-sm'}`}>
                      {msg.imageUrl && (
                        <div className="mb-2 -mx-1 -mt-1 overflow-hidden rounded-xl">
                          <img src={msg.imageUrl} alt="attached" className="max-w-full max-h-64 object-cover" />
                        </div>
                      )}
                      
                      {msg.content && <div className="whitespace-pre-wrap break-words">{msg.content}</div>}
                      
                      {msg.linkPreview && (
                        <div className={`mt-2 rounded-lg p-2 text-xs border ${isMine ? 'bg-primary-foreground/10 border-primary-foreground/20' : 'bg-background border-border'} overflow-hidden`}>
                          {msg.linkPreview.image && <img src={msg.linkPreview.image} alt="preview" className="w-full h-24 object-cover rounded mb-2" />}
                          {msg.linkPreview.title && <div className="font-semibold truncate mb-1">{msg.linkPreview.title}</div>}
                          {msg.linkPreview.description && <div className="line-clamp-2 opacity-80">{msg.linkPreview.description}</div>}
                        </div>
                      )}

                      <div className={`text-[10px] mt-1 text-right flex justify-end gap-1 items-center ${isMine ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    
                    {Object.keys(reactionCounts).length > 0 && (
                      <div className={`absolute -bottom-3 flex gap-1 ${isMine ? 'right-0 flex-row-reverse' : 'left-0'}`}>
                        {Object.entries(reactionCounts).map(([emoji, count]) => (
                          <div 
                            key={emoji}
                            onClick={(e) => { e.stopPropagation(); handleReaction(msg.id, emoji); }}
                            className={`rounded-full px-1.5 py-0.5 text-xs flex items-center gap-1 shadow-sm border cursor-pointer ${hasReacted(emoji) ? 'bg-primary/20 border-primary/30 text-primary' : 'bg-card border-border text-foreground'}`}
                          >
                            <span>{emoji}</span>
                            {count > 1 && <span className="font-medium text-[10px]">{count}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-1.5 flex gap-1 rounded-full shadow-lg" align={isMine ? "end" : "start"}>
                  {EMOJIS.map(emoji => (
                    <Button 
                      key={emoji} 
                      variant="ghost" 
                      size="icon" 
                      className={`h-8 w-8 rounded-full text-lg ${hasReacted(emoji) ? 'bg-primary/20' : ''}`}
                      onClick={() => handleReaction(msg.id, emoji)}
                    >
                      {emoji}
                    </Button>
                  ))}
                </PopoverContent>
              </Popover>
            </div>
          );
        })}
      </div>

      <div className="p-3 bg-sidebar border-t border-border mt-auto relative z-10">
        <div className="flex items-end gap-2 max-w-4xl mx-auto">
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept="image/*" 
            onChange={handleFileChange} 
          />
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingImage}
            className="flex-shrink-0 text-muted-foreground hover:text-foreground"
          >
            {uploadingImage ? <Loader2 className="w-5 h-5 animate-spin" /> : <Paperclip className="w-5 h-5" />}
          </Button>
          
          <div className="flex-1 bg-input rounded-xl border border-border focus-within:border-primary/50 flex items-end relative">
            <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="flex-shrink-0 mb-0.5 text-muted-foreground">
                  <Smile className="w-5 h-5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2 mb-2" align="start" side="top">
                <div className="grid grid-cols-6 gap-2">
                  {['😀', '😂', '🤣', '😊', '😍', '🥰', '😘', '😋', '😎', '🤩', '🤔', '🤨', '😐', '😑', '😶', '🙄', '😏', '😣', '😥', '😮', '🤐', '😯', '😪', '😫', '🥱', '😴', '😌', '😛', '😜', '😝', '🤤', '😒', '😓', '😔', '😕', '🙃', '🤑', '😲', '☹️', '🙁', '😖', '😞', '😟', '😤', '😢', '😭', '😦', '😧', '😨', '😩', '🤯', '😬', '😰', '😱', '🥵', '🥶', '😳', '🤪', '😵', '😡', '😠', '🤬', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '😇', '🥳', '🥺', '🤠', '🤡', '🤥', '🤫', '🤭', '🧐', '🤓', '😈', '👿', '👹', '👺', '💀', '👻', '👽', '👾', '🤖'].map(emoji => (
                    <button
                      key={emoji}
                      onClick={() => { setContent(prev => prev + emoji); setEmojiPickerOpen(false); }}
                      className="text-2xl hover:bg-muted rounded p-1 transition-colors"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message"
              className="min-h-[40px] max-h-[120px] border-0 focus-visible:ring-0 resize-none py-2.5 px-1 bg-transparent shadow-none"
              rows={1}
            />
          </div>
          <Button 
            size="icon" 
            onClick={handleSend}
            disabled={(!content.trim() && !uploadingImage) || isSending}
            className="flex-shrink-0 rounded-full w-10 h-10 bg-primary hover:bg-primary/90 text-primary-foreground transition-all shadow-md"
          >
            {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 ml-0.5" />}
          </Button>
        </div>
      </div>
    </div>
  );
}