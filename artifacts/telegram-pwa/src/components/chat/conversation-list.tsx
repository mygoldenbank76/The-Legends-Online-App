import { useState } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/lib/auth-context';
import { useListConversations } from '@workspace/api-client-react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { UserSearch } from './user-search';
import { Search } from 'lucide-react';

type Props = {
  filterType: 'group' | 'direct' | 'all';
  activeConvId?: number;
  onSelectConv: (id: number) => void;
  user: { id: number; displayName: string };
};

export function ConversationList({ filterType, activeConvId, onSelectConv, user }: Props) {
  const { data: allConvs = [] } = useListConversations();
  const [searchOpen, setSearchOpen] = useState(false);

  const conversations = filterType === 'all'
    ? allConvs
    : allConvs.filter(c =>
        filterType === 'group' ? c.type === 'group' : c.type === 'direct'
      );

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="flex-shrink-0 px-3 py-2">
        <UserSearch onSelectUser={onSelectConv} />
      </div>

      {/* List */}
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

          return (
            <motion.button
              key={conv.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03, duration: 0.2 }}
              onClick={() => onSelectConv(conv.id)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all mb-1 text-left',
                isActive
                  ? 'bg-primary/15 border border-primary/20'
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
                        {lastMsg.content || (lastMsg.imageUrl ? '📷 Image' : '')}
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
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
