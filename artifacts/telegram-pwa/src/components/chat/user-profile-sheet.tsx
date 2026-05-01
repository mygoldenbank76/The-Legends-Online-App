import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, MessageSquare, Phone, AtSign, FileText, UserPlus, UserMinus, Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useListContacts, getListContactsQueryKey } from '@workspace/api-client-react';
import { getAuthHeaders } from '@/lib/auth-fetch';
import { usePreferences } from '@/lib/preferences-context';
import { useToast } from '@/hooks/use-toast';
import { useCall } from '@/lib/call-context';

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

async function getOrCreateConversation(userId: number): Promise<number | null> {
  try {
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() } as Record<string, string>,
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) return null;
    const conv = await res.json();
    return conv.id ?? null;
  } catch {
    return null;
  }
}

export function UserProfileSheet({ user, currentUserId, onClose, onOpenConversation }: Props) {
  const { t, appLanguage } = usePreferences();
  const p = t.profile;
  const { toast } = useToast();
  const { initiateCall } = useCall();
  const queryClient = useQueryClient();

  const [translatedBio, setTranslatedBio] = useState<string | null>(null);
  const [bioLoading, setBioLoading] = useState(false);
  const [messageLoading, setMessageLoading] = useState(false);
  const [callLoading, setCallLoading] = useState(false);
  const [contactLoading, setContactLoading] = useState(false);

  const isSelf = user.id === currentUserId;

  const { data: contacts = [] } = useListContacts();
  const isContact = useMemo(
    () => !isSelf && contacts.some((c) => c.id === user.id),
    [contacts, isSelf, user.id],
  );

  useEffect(() => {
    setTranslatedBio(null);
    if (!user.bio) {
      setBioLoading(false);
      return;
    }
    let cancelled = false;
    setBioLoading(true);
    translateBio(user.bio, appLanguage)
      .then((result) => { if (!cancelled) setTranslatedBio(result); })
      .catch(() => { if (!cancelled) setTranslatedBio(null); })
      .finally(() => { if (!cancelled) setBioLoading(false); });
    return () => { cancelled = true; };
  }, [user.bio, appLanguage]);

  const initials = user.displayName.substring(0, 2).toUpperCase() || '??';
  const displayedBio = translatedBio ?? user.bio ?? '';
  const isTranslated = !!translatedBio && translatedBio !== user.bio;

  const handleSendMessage = useCallback(async () => {
    if (isSelf || messageLoading) return;
    setMessageLoading(true);
    const convId = await getOrCreateConversation(user.id);
    setMessageLoading(false);
    if (convId == null) {
      toast({ variant: 'destructive', title: 'Erreur', description: 'Impossible d\'ouvrir la conversation' });
      return;
    }
    onClose();
    onOpenConversation(convId);
  }, [isSelf, messageLoading, onClose, onOpenConversation, toast, user.id]);

  const handleCall = useCallback(async () => {
    if (isSelf || callLoading) return;
    setCallLoading(true);
    const convId = await getOrCreateConversation(user.id);
    if (convId == null) {
      setCallLoading(false);
      toast({ variant: 'destructive', title: 'Erreur', description: 'Impossible de démarrer l\'appel' });
      return;
    }
    try {
      await initiateCall({
        peerId: user.id,
        peerName: user.displayName,
        peerAvatar: user.avatar || undefined,
        conversationId: convId,
        isVideo: false,
      });
      onClose();
    } catch {
      toast({ variant: 'destructive', title: 'Erreur', description: 'Impossible de démarrer l\'appel' });
    } finally {
      setCallLoading(false);
    }
  }, [callLoading, initiateCall, isSelf, onClose, toast, user.avatar, user.displayName, user.id]);

  const handleCopyUsername = useCallback(async () => {
    if (!user.username) return;
    try {
      await navigator.clipboard.writeText(user.username);
      toast({ title: p.usernameCopied, duration: 1600 });
    } catch {
      toast({ variant: 'destructive', title: 'Erreur', description: 'Copie impossible' });
    }
  }, [p.usernameCopied, toast, user.username]);

  const handleToggleContact = useCallback(async () => {
    if (isSelf || contactLoading || !user.username) return;
    setContactLoading(true);
    try {
      if (isContact) {
        const res = await fetch(`/api/contacts/${user.id}`, {
          method: 'DELETE',
          headers: { ...getAuthHeaders() } as Record<string, string>,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          toast({ variant: 'destructive', title: t.contacts.addContactError, description: err?.error });
          return;
        }
        await queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        toast({ title: p.removedFromContacts, duration: 1800 });
      } else {
        const res = await fetch('/api/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() } as Record<string, string>,
          body: JSON.stringify({ username: user.username }),
        });
        if (res.status === 404) {
          toast({ variant: 'destructive', title: t.contacts.userNotFound });
          return;
        }
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          toast({ variant: 'destructive', title: t.contacts.addContactError, description: err?.error });
          return;
        }
        await queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        const msg = res.status === 200 ? t.contacts.contactAlreadyExists : t.contacts.contactAdded;
        toast({ title: msg, duration: 1800 });
      }
    } catch {
      toast({ variant: 'destructive', title: t.contacts.addContactError });
    } finally {
      setContactLoading(false);
    }
  }, [contactLoading, isContact, isSelf, p.removedFromContacts, queryClient, t.contacts.addContactError, t.contacts.contactAdded, t.contacts.contactAlreadyExists, t.contacts.userNotFound, toast, user.id, user.username]);

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="user-profile-page"
        initial={{ x: '100%', opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: '100%', opacity: 0 }}
        transition={{ type: 'spring', damping: 32, stiffness: 320 }}
        className="fixed inset-0 z-[450] bg-background flex flex-col"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-3 py-3 border-b border-white/10 flex-shrink-0"
          style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}
        >
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
            data-testid="button-back-user-profile"
            aria-label={t.chat.back}
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="text-sm font-semibold text-muted-foreground">{p.userDetails}</div>
          <div className="w-9 h-9" />
        </div>

        {/* Scrollable body */}
        <div
          className="flex-1 overflow-y-auto overscroll-contain"
          style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <div className="flex flex-col gap-5 px-4 pt-8">
            {/* Hero: avatar + name + status */}
            <div className="flex flex-col items-center gap-4">
              <motion.div
                initial={{ scale: 0.92, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', damping: 22, stiffness: 240 }}
                className="relative mb-2"
              >
                <span aria-hidden className="absolute -inset-1 rounded-[1.75rem] profile-hero-ring pointer-events-none" />
                <div className="relative w-28 h-28 rounded-3xl bg-primary/20 overflow-hidden glow-primary-sm">
                  {user.avatar ? (
                    <img src={user.avatar} alt={user.displayName} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="text-5xl font-bold text-primary">{initials}</span>
                    </div>
                  )}
                </div>
              </motion.div>

              <div className="flex flex-col items-center text-center gap-1">
                <p className="text-2xl font-bold leading-tight" data-testid="text-user-display-name">{user.displayName}</p>
                <p className={`text-sm ${user.isOnline ? 'text-primary' : 'text-muted-foreground'}`}>
                  {user.isOnline ? t.chat.online : t.contacts.onlineRecently}
                </p>
              </div>
            </div>

            {/* Action buttons row: Message + Appeler */}
            {!isSelf && (
              <div className="grid grid-cols-2 gap-2.5">
                <ActionTile
                  icon={messageLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <MessageSquare className="w-5 h-5" />}
                  label={p.message}
                  onClick={handleSendMessage}
                  disabled={messageLoading}
                  testId="button-message-user"
                />
                <ActionTile
                  icon={callLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Phone className="w-5 h-5" />}
                  label={p.call}
                  onClick={handleCall}
                  disabled={callLoading}
                  testId="button-call-user"
                />
              </div>
            )}

            {/* Info card: bio + @username */}
            <div className="glass rounded-2xl overflow-hidden">
              <div className="flex items-start gap-3 px-4 py-3.5">
                <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                  <FileText className="w-4 h-4 text-primary" />
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  {user.bio && user.bio.trim().length > 0 ? (
                    <>
                      <span className="text-sm font-medium whitespace-pre-wrap break-words" data-testid="text-user-bio">
                        {displayedBio}
                      </span>
                      {isTranslated && (
                        <span className="text-[11px] text-muted-foreground/60 mt-1 italic break-words">
                          {user.bio}
                        </span>
                      )}
                      {bioLoading && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground/60 mt-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> …
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-sm text-muted-foreground italic">{p.noBioOther}</span>
                  )}
                  <span className="text-xs text-muted-foreground mt-0.5">{p.bio}</span>
                </div>
              </div>

              {user.username && (
                <>
                  <div className="h-px bg-white/8 mx-4" />
                  <button
                    type="button"
                    onClick={handleCopyUsername}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-white/5 active:bg-white/10 transition-colors"
                    data-testid="button-copy-user-username"
                  >
                    <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                      <AtSign className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-sm font-medium truncate">@{user.username}</span>
                      <span className="text-xs text-muted-foreground">{p.username}</span>
                    </div>
                  </button>
                </>
              )}
            </div>

            {/* Add to / Remove from contacts */}
            {!isSelf && user.username && (
              <button
                type="button"
                onClick={handleToggleContact}
                disabled={contactLoading}
                className="glass rounded-2xl flex items-center gap-3 px-4 py-3.5 text-left hover:bg-white/5 active:bg-white/10 transition-colors disabled:opacity-60"
                data-testid={isContact ? 'button-remove-from-contacts' : 'button-add-to-contacts'}
              >
                <div className={`w-9 h-9 rounded-full ${isContact ? 'bg-destructive/15' : 'bg-primary/15'} flex items-center justify-center flex-shrink-0`}>
                  {contactLoading ? (
                    <Loader2 className={`w-4 h-4 ${isContact ? 'text-destructive' : 'text-primary'} animate-spin`} />
                  ) : isContact ? (
                    <UserMinus className="w-4 h-4 text-destructive" />
                  ) : (
                    <UserPlus className="w-4 h-4 text-primary" />
                  )}
                </div>
                <span className={`text-sm font-medium ${isContact ? 'text-destructive' : ''}`}>
                  {isContact ? p.removeFromContacts : p.addToContacts}
                </span>
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}

function ActionTile({
  icon,
  label,
  onClick,
  disabled,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className="glass rounded-2xl px-3 py-3 flex flex-col items-center gap-1.5 hover:bg-white/10 active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 transition-all"
    >
      <span className="text-primary">{icon}</span>
      <span className="text-xs font-medium leading-tight text-center whitespace-nowrap truncate max-w-full">{label}</span>
    </button>
  );
}
