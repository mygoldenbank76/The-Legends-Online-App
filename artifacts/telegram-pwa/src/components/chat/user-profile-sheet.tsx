import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, MessageSquare, Loader2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getAuthHeaders } from '@/lib/auth-fetch';

type UserInfo = {
  id: number;
  displayName: string;
  username?: string;
  avatar?: string | null;
  bio?: string | null;
};

type Props = {
  user: UserInfo;
  currentUserId: number;
  onClose: () => void;
  onOpenConversation: (convId: number) => void;
};

export function UserProfileSheet({ user, currentUserId, onClose, onOpenConversation }: Props) {
  const [loading, setLoading] = useState(false);

  const handleSendMessage = async () => {
    if (user.id === currentUserId) return;
    setLoading(true);
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() } as Record<string, string>,
        body: JSON.stringify({ userId: user.id }),
      });
      if (!res.ok) throw new Error('Failed');
      const conv = await res.json();
      onClose();
      onOpenConversation(conv.id);
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  };

  const initials = user.displayName.substring(0, 2).toUpperCase();

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        key="sheet"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="fixed inset-x-0 bottom-0 z-50"
      >
        <div className="glass-strong rounded-t-3xl pb-10 overflow-hidden">
          {/* Handle */}
          <div className="flex justify-center pt-3 pb-4">
            <div className="w-10 h-1 rounded-full bg-white/20" />
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4 text-foreground" />
          </button>

          {/* Profile content */}
          <div className="flex flex-col items-center px-6 gap-4">
            {/* Avatar */}
            <Avatar className="w-20 h-20 ring-2 ring-primary/30">
              <AvatarImage src={user.avatar || ''} />
              <AvatarFallback className="bg-primary/20 text-primary text-2xl font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>

            {/* Name & username */}
            <div className="text-center">
              <p className="text-lg font-bold leading-tight">{user.displayName}</p>
              <p className="text-sm text-muted-foreground">@{user.username}</p>
            </div>

            {/* Bio */}
            {user.bio && (
              <div className="glass rounded-xl px-4 py-3 w-full text-center">
                <p className="text-sm text-muted-foreground/90 italic">"{user.bio}"</p>
              </div>
            )}

            {/* Send message button (only if not yourself) */}
            {user.id !== currentUserId && (
              <button
                onClick={handleSendMessage}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2.5 py-3 px-5 rounded-2xl bg-primary text-white font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed mt-1"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <MessageSquare className="w-4 h-4" />
                )}
                {loading ? 'Ouverture…' : 'Envoyer un message'}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
