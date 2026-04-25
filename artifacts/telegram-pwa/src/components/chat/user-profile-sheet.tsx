import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, MessageSquare, Loader2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getAuthHeaders } from '@/lib/auth-fetch';
import { usePreferences } from '@/lib/preferences-context';

type UserInfo = {
  id: number;
  displayName: string;
  username?: string;
  avatar?: string | null;
  bio?: string | null;
  isOnline?: boolean;
};

type Props = {
  user: UserInfo;
  currentUserId: number;
  onClose: () => void;
  onOpenConversation: (convId: number) => void;
};

const MYMEMORY_ERROR_PATTERNS = /please select|invalid|mymemory|query length|quota|too many/i;

async function safeTranslate(text: string, from: string, to: string): Promise<string | null> {
  if (!text || from === to) return null;
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`
    );
    const data = await res.json();
    const status = Number(data?.responseStatus);
    const translated: string = data?.responseData?.translatedText ?? '';
    if (status !== 200 || !translated || MYMEMORY_ERROR_PATTERNS.test(translated)) return null;
    if (translated.trim().toLowerCase() === text.trim().toLowerCase()) return null;
    return translated;
  } catch {
    return null;
  }
}

const LIKELY_SOURCE_LANGS = ['fr', 'en', 'es', 'ar', 'pt', 'de'];

async function translateBio(bio: string, targetLang: string): Promise<string | null> {
  for (const src of LIKELY_SOURCE_LANGS) {
    if (src === targetLang) continue;
    const result = await safeTranslate(bio, src, targetLang);
    if (result) return result;
  }
  return null;
}

export function UserProfileSheet({ user, currentUserId, onClose, onOpenConversation }: Props) {
  const [loading, setLoading] = useState(false);
  const { t, appLanguage } = usePreferences();
  const [translatedBio, setTranslatedBio] = useState<string | null>(null);
  const [bioLoading, setBioLoading] = useState(false);

  useEffect(() => {
    if (!user.bio) { setTranslatedBio(null); return; }
    setBioLoading(true);
    translateBio(user.bio, appLanguage)
      .then(result => setTranslatedBio(result))
      .catch(() => setTranslatedBio(null))
      .finally(() => setBioLoading(false));
  }, [user.bio, appLanguage]);

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
  const displayedBio = translatedBio ?? user.bio;
  const isTranslated = !!translatedBio && translatedBio !== user.bio;

  return (
    <AnimatePresence>
      <>
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
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          className="fixed inset-x-0 bottom-0 z-50 sm:inset-0 sm:flex sm:items-center sm:justify-center sm:p-4"
          onClick={onClose}
        >
        <div className="glass-strong rounded-t-3xl sm:rounded-3xl pb-10 overflow-hidden w-full sm:max-w-sm sm:mx-auto" onClick={e => e.stopPropagation()}>
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
            {/* Avatar with online indicator */}
            <div className="relative">
              <Avatar className="w-20 h-20 ring-2 ring-primary/30">
                <AvatarImage src={user.avatar || ''} />
                <AvatarFallback className="bg-primary/20 text-primary text-2xl font-bold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              {user.isOnline && (
                <span className="absolute bottom-0.5 right-0.5 w-4 h-4 bg-green-500 border-2 border-background rounded-full" />
              )}
            </div>

            {/* Name & username & status */}
            <div className="text-center">
              <p className="text-lg font-bold leading-tight">{user.displayName}</p>
              <p className="text-sm text-muted-foreground">@{user.username}</p>
              {user.id !== currentUserId && (
                <p className={`text-xs mt-0.5 ${user.isOnline ? 'text-green-400' : 'text-muted-foreground'}`}>
                  {user.isOnline ? t.chat.online : t.chat.offline}
                </p>
              )}
            </div>

            {/* Bio */}
            {user.bio && (
              <div className="glass rounded-xl px-4 py-3 w-full text-center relative">
                <p className="text-sm text-muted-foreground/90 italic">"{displayedBio}"</p>
                {isTranslated && (
                  <p className="text-[10px] text-muted-foreground/50 mt-1">{user.bio}</p>
                )}
                {bioLoading && (
                  <Loader2 className="w-3 h-3 animate-spin absolute top-2 right-2 text-muted-foreground/40" />
                )}
              </div>
            )}

            {/* Send message button (only if not yourself) */}
            {user.id !== currentUserId && (
              <button
                onClick={handleSendMessage}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2.5 py-3 px-5 rounded-2xl gradient-primary glow-primary-sm text-white font-semibold text-sm hover:opacity-95 active:scale-[0.97] transition-all disabled:opacity-60 disabled:cursor-not-allowed mt-1"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <MessageSquare className="w-4 h-4" />
                )}
                {loading ? t.profile.opening : t.profile.sendMessage}
              </button>
            )}
          </div>
        </div>
        </motion.div>
      </>
    </AnimatePresence>
  );
}
