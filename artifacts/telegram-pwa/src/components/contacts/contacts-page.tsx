import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, UserPlus, Share2, X, Loader2, Check } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListContacts,
  getListContactsQueryKey,
} from '@workspace/api-client-react';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { usePreferences } from '@/lib/preferences-context';
import { getAuthHeaders } from '@/lib/auth-fetch';
import { UserProfileSheet } from '@/components/chat/user-profile-sheet';

type ContactUser = {
  id: number;
  username: string;
  displayName: string;
  avatar?: string | null;
  bio?: string | null;
  isOnline?: boolean;
  lastSeen?: string | null;
};

type Props = {
  user: { id: number; username: string; displayName: string };
  onSelectConv: (id: number) => void;
};

function Avatar({ user, size = 44 }: { user: { displayName: string; avatar?: string | null }; size?: number }) {
  const initials = user.displayName.substring(0, 2).toUpperCase() || '??';
  return (
    <div
      className="rounded-full bg-primary/20 overflow-hidden flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size }}
    >
      {user.avatar ? (
        <img src={user.avatar} alt={user.displayName} className="w-full h-full object-cover" />
      ) : (
        <span className="font-semibold text-primary" style={{ fontSize: size * 0.36 }}>{initials}</span>
      )}
    </div>
  );
}

export function ContactsPage({ user, onSelectConv }: Props) {
  const { t } = usePreferences();
  const c = t.contacts;
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [showNewContact, setShowNewContact] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [profileUser, setProfileUser] = useState<ContactUser | null>(null);

  const { data: contacts = [], isLoading } = useListContacts();
  const list = (contacts ?? []) as ContactUser[];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (u) => u.displayName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q),
    );
  }, [list, search]);

  return (
    <div
      className="h-full overflow-y-auto overscroll-contain relative"
      style={{ paddingBottom: 'calc(7rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <div className="flex flex-col gap-4 px-4 pt-6">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={c.searchPlaceholder}
            className="bg-white/5 border-white/10 pl-10 h-11 rounded-2xl"
            data-testid="input-search-contacts"
          />
        </div>

        {/* Action card: Invite friends */}
        <div className="glass rounded-2xl overflow-hidden">
          <button
            type="button"
            onClick={() => setShowInvite(true)}
            className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/5 active:bg-white/10 transition-colors"
            data-testid="button-invite-friends"
          >
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
              <Share2 className="w-5 h-5 text-primary" />
            </div>
            <span className="text-base font-medium text-foreground">{c.inviteFriends}</span>
          </button>
        </div>

        {/* List header */}
        <div className="text-xs font-semibold text-primary uppercase tracking-wider px-1 mt-1">
          {c.sortByOnline}
        </div>

        {/* Contacts list */}
        <div className="flex flex-col">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-6">
              <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center mb-3">
                <UserPlus className="w-6 h-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground mb-1">
                {search ? c.noResults : c.noContacts}
              </p>
              {!search && (
                <p className="text-xs text-muted-foreground max-w-[260px]">{c.noContactsHint}</p>
              )}
            </div>
          ) : (
            filtered.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => setProfileUser(u)}
                className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-white/5 active:bg-white/10 transition-colors text-left"
                data-testid={`contact-row-${u.username}`}
              >
                <Avatar user={u} size={44} />
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-sm font-semibold truncate">{u.displayName}</span>
                  <span className="text-xs text-muted-foreground truncate">
                    {u.isOnline ? t.chat.online : c.onlineRecently}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* FAB */}
      <button
        type="button"
        onClick={() => setShowNewContact(true)}
        className="fixed right-5 z-30 w-14 h-14 rounded-full gradient-primary glow-primary flex items-center justify-center shadow-lg active:scale-95 transition-transform"
        style={{ bottom: 'calc(6rem + env(safe-area-inset-bottom, 0px))' }}
        aria-label={c.newContact}
        data-testid="button-new-contact-fab"
      >
        <UserPlus className="w-6 h-6 text-white" />
      </button>

      <AnimatePresence>
        {showNewContact && (
          <NewContactSheet
            currentUsername={user.username}
            onClose={() => setShowNewContact(false)}
            onAdded={() => {
              queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
              setShowNewContact(false);
            }}
          />
        )}
        {showInvite && <InviteFriendsSheet onClose={() => setShowInvite(false)} />}
      </AnimatePresence>

      {/* User profile detail (opened by tapping a contact row) */}
      {profileUser && (
        <UserProfileSheet
          user={profileUser}
          currentUserId={user.id}
          onClose={() => setProfileUser(null)}
          onOpenConversation={(convId) => {
            setProfileUser(null);
            onSelectConv(convId);
          }}
        />
      )}
    </div>
  );
}

/* ── New contact sheet ── */
function NewContactSheet({
  currentUsername,
  onClose,
  onAdded,
}: {
  currentUsername: string;
  onClose: () => void;
  onAdded: (user: ContactUser) => void;
}) {
  const { t } = usePreferences();
  const c = t.contacts;
  const { toast } = useToast();
  const [identifier, setIdentifier] = useState('');
  const [loading, setLoading] = useState(false);

  const trimmed = identifier.trim().toLowerCase();
  const valid = trimmed.length >= 1;

  async function submit() {
    if (!valid || loading) return;
    if (trimmed === currentUsername.toLowerCase()) {
      toast({ variant: 'destructive', title: c.cannotAddSelf });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() } as Record<string, string>,
        body: JSON.stringify({ username: trimmed }),
      });
      if (res.status === 404) {
        toast({ variant: 'destructive', title: c.userNotFound });
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ variant: 'destructive', title: c.addContactError, description: err?.error });
        return;
      }
      const added = (await res.json()) as ContactUser;
      const msg = res.status === 200 ? c.contactAlreadyExists : c.contactAdded;
      toast({ title: msg, duration: 1800 });
      onAdded(added);
    } catch {
      toast({ variant: 'destructive', title: c.addContactError });
    } finally {
      setLoading(false);
    }
  }

  return createPortal(
    <>
      <motion.div
        key="new-contact-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        key="new-contact-sheet"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="fixed inset-x-0 bottom-0 z-50 sm:inset-0 sm:flex sm:items-center sm:justify-center sm:p-4"
        onClick={onClose}
      >
        <div
          className="glass-strong rounded-t-3xl sm:rounded-3xl flex flex-col w-full sm:max-w-md sm:mx-auto"
          style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
            <div className="w-10 h-1 rounded-full bg-white/20" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 flex-shrink-0">
            <h3 className="text-lg font-bold">{c.newContact}</h3>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center"
              aria-label={c.cancel}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="px-5 pb-5 flex flex-col gap-3">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                {c.identifier}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">@</span>
                <Input
                  autoFocus
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  placeholder={c.identifierPlaceholder}
                  maxLength={64}
                  className="bg-white/5 border-white/10 pl-7 h-12 rounded-xl"
                  onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                  data-testid="input-new-contact-identifier"
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">{c.identifierHint}</p>
            </div>

            <button
              type="button"
              onClick={submit}
              disabled={!valid || loading}
              className={`mt-2 w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-semibold text-sm transition-all ${
                valid && !loading
                  ? 'gradient-primary glow-primary text-white hover:opacity-95 active:scale-[0.97]'
                  : 'bg-white/10 text-muted-foreground cursor-not-allowed'
              }`}
              data-testid="button-create-contact"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {loading ? c.creating : c.create}
            </button>
          </div>
        </div>
      </motion.div>
    </>,
    document.body,
  );
}

/* ── Invite friends sheet (just shares/copies a link to the app) ── */
function InviteFriendsSheet({ onClose }: { onClose: () => void }) {
  const { t } = usePreferences();
  const c = t.contacts;
  const { toast } = useToast();

  const link = window.location.origin;
  const message = `${c.inviteMessage} ${link}`;

  async function shareNative() {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'The Legends Online', text: message, url: link });
      } else {
        await navigator.clipboard.writeText(message);
        toast({ title: c.inviteLinkCopied, duration: 1800 });
      }
      onClose();
    } catch {
      // User cancelled — no-op
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(message);
      toast({ title: c.inviteLinkCopied, duration: 1800 });
    } catch {
      toast({ variant: 'destructive', title: 'Erreur' });
    }
  }

  return createPortal(
    <>
      <motion.div
        key="invite-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        key="invite-sheet"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="fixed inset-x-0 bottom-0 z-50 sm:inset-0 sm:flex sm:items-center sm:justify-center sm:p-4"
        onClick={onClose}
      >
        <div
          className="glass-strong rounded-t-3xl sm:rounded-3xl flex flex-col w-full sm:max-w-md sm:mx-auto"
          style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
            <div className="w-10 h-1 rounded-full bg-white/20" />
          </div>
          <div className="flex items-center justify-between px-5 py-3 flex-shrink-0">
            <h3 className="text-lg font-bold">{c.inviteFriends}</h3>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="px-5 pb-5 flex flex-col gap-3">
            <div className="rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-muted-foreground break-words">
              {message}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={copyLink}
                className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/15 active:scale-[0.97] font-medium text-sm transition-all"
              >
                {t.chat.copy}
              </button>
              <button
                type="button"
                onClick={shareNative}
                className="flex-1 py-3 rounded-xl gradient-primary glow-primary text-white font-semibold text-sm hover:opacity-95 active:scale-[0.97] transition-all"
              >
                {c.inviteFriends}
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </>,
    document.body,
  );
}
