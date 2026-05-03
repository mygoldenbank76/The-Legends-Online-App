import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, UserPlus, Share2, ArrowLeft, Loader2, Check, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListContacts,
  getListContactsQueryKey,
} from '@workspace/api-client-react';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { usePreferences } from '@/lib/preferences-context';
import { setRootViewportMode } from '@/App';
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
  /** Notifies the parent when the contacts search becomes active so the
   *  bottom navigation (and other chrome) can be hidden, Telegram-style. */
  onSearchActiveChange?: (active: boolean) => void;
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

export function ContactsPage({ user, onSelectConv, onSearchActiveChange }: Props) {
  const { t } = usePreferences();
  const c = t.contacts;
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [showHub, setShowHub] = useState(false);
  const [profileUser, setProfileUser] = useState<ContactUser | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // While the search input is focused, switch the app shell into "fullscreen"
  // mode so the on-screen keyboard overlays the bottom nav instead of
  // squishing the layout (the chat-input behavior is preserved everywhere
  // else by reverting to 'visual' on blur or unmount).
  function handleSearchFocus() {
    setRootViewportMode('fullscreen');
  }
  function handleSearchBlur() {
    setRootViewportMode('visual');
  }
  useEffect(() => {
    return () => setRootViewportMode('visual');
  }, []);

  const { data: contacts = [], isLoading } = useListContacts();
  const list = (contacts ?? []) as ContactUser[];

  const trimmedSearch = search.trim();
  // Search mode is active only while the input contains text. Clearing the
  // text (via the X button or by deleting characters) restores the default
  // page appearance — no manual cancel needed.
  const searchActive = trimmedSearch.length > 0;

  const filtered = useMemo(() => {
    const q = trimmedSearch.toLowerCase();
    if (!q) return list;
    return list.filter(
      (u) => u.displayName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q),
    );
  }, [list, trimmedSearch]);

  // Notify parent whenever search-active state changes, and clean up when the
  // page unmounts (e.g. user switches tab) so the bottom nav reappears.
  useEffect(() => {
    onSearchActiveChange?.(searchActive);
  }, [searchActive, onSearchActiveChange]);
  useEffect(() => {
    return () => onSearchActiveChange?.(false);
  }, [onSearchActiveChange]);

  return (
    <div
      className="h-full overflow-y-auto overscroll-contain relative"
      style={{
        paddingBottom: searchActive
          ? 'calc(1.5rem + env(safe-area-inset-bottom, 0px))'
          : 'calc(7rem + env(safe-area-inset-bottom, 0px))',
      }}
    >
      <div className="flex flex-col gap-4 px-4 pt-6">
        {/* Search bar (with optional clear button when text is present) */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            ref={searchInputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={handleSearchFocus}
            onBlur={handleSearchBlur}
            placeholder={c.searchPlaceholder}
            className="bg-white/5 border-white/10 pl-10 pr-10 h-11 rounded-2xl"
            data-testid="input-search-contacts"
          />
          {search.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                searchInputRef.current?.focus();
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
              aria-label={c.clearSearch}
              data-testid="button-clear-contacts-search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Action card + section header: hidden in search mode (Telegram-style) */}
        <AnimatePresence initial={false}>
          {!searchActive && (
            <motion.div
              key="contacts-chrome"
              initial={{ opacity: 0, height: 0, marginTop: 0 }}
              animate={{ opacity: 1, height: 'auto', marginTop: 0 }}
              exit={{ opacity: 0, height: 0, marginTop: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden flex flex-col gap-4"
            >
              {/* Action card: opens the 2-in-1 hub */}
              <div className="glass rounded-2xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowHub(true)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/5 active:bg-white/10 transition-colors"
                  data-testid="button-invite-friends"
                >
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <Share2 className="w-5 h-5 text-primary" />
                  </div>
                  <span className="text-base font-medium text-foreground">{c.addOrInviteFriends}</span>
                </button>
              </div>

              {/* List section header */}
              <div className="text-xs font-semibold text-primary uppercase tracking-wider px-1 mt-1">
                {c.sortByOnline}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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

      <ContactsHubSheet
        open={showHub}
        currentUsername={user.username}
        onClose={() => setShowHub(false)}
        onAdded={() => {
          queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
          setShowHub(false);
        }}
      />

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

/* ── 2-in-1 contacts hub: invite friends + new contact on the same page ── */
function ContactsHubSheet({
  open,
  currentUsername,
  onClose,
  onAdded,
}: {
  open: boolean;
  currentUsername: string;
  onClose: () => void;
  onAdded: (user: ContactUser) => void;
}) {
  const { t } = usePreferences();
  const c = t.contacts;
  const { toast } = useToast();
  const [identifier, setIdentifier] = useState('');
  const [loading, setLoading] = useState(false);
  // Bumped each time the hub opens so in-flight requests from a previous
  // session can detect they are stale and skip their UI side-effects.
  const sessionRef = useRef(0);

  // Reset identifier whenever the hub closes
  useEffect(() => {
    if (open) {
      sessionRef.current += 1;
    } else {
      setIdentifier('');
      setLoading(false);
    }
  }, [open]);

  const trimmed = identifier.trim().toLowerCase();
  const valid = trimmed.length >= 1;

  async function submit() {
    if (!valid || loading) return;
    if (trimmed === currentUsername.toLowerCase()) {
      toast({ variant: 'destructive', title: c.cannotAddSelf });
      return;
    }
    const session = sessionRef.current;
    setLoading(true);
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() } as Record<string, string>,
        body: JSON.stringify({ username: trimmed }),
      });
      // Drop result if the user closed/reopened the hub mid-flight.
      if (session !== sessionRef.current) return;
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
      if (session !== sessionRef.current) return;
      const msg = res.status === 200 ? c.contactAlreadyExists : c.contactAdded;
      toast({ title: msg, duration: 1800 });
      onAdded(added);
    } catch {
      if (session !== sessionRef.current) return;
      toast({ variant: 'destructive', title: c.addContactError });
    } finally {
      if (session === sessionRef.current) setLoading(false);
    }
  }

  const link = typeof window !== 'undefined' ? window.location.origin : '';
  const message = `${c.inviteMessage} ${link}`;

  async function shareNative() {
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: 'The Legends Online', text: message, url: link });
      } else if (typeof navigator !== 'undefined') {
        await navigator.clipboard.writeText(message);
        toast({ title: c.inviteLinkCopied, duration: 1800 });
      }
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

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="contacts-hub"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 320 }}
          className="fixed inset-0 z-[450] bg-background flex flex-col"
          style={{ height: '100dvh' }}
          data-testid="sheet-contacts-hub"
        >
          {/* Top bar — safe-area-aware padding so the title doesn't
              slide under the Android status bar (clock / battery /
              notch) on devices like the S22. Mirrors the conversation
              detail page (UserProfileSheet) header. */}
          <div
            className="flex items-center gap-3 px-3 pt-3 pb-3 bg-background/80 backdrop-blur-md border-b border-white/5 flex-shrink-0"
            style={{
              paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))',
              paddingBottom: 12,
              minHeight: 'calc(4rem + env(safe-area-inset-top, 0px))',
            }}
          >
            <button
              type="button"
              onClick={onClose}
              className="w-10 h-10 rounded-full glass flex items-center justify-center text-foreground hover:text-primary transition-colors"
              aria-label={c.cancel}
              data-testid="button-contacts-hub-back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-lg font-bold text-foreground">{c.addOrInviteFriends}</h1>
          </div>

          {/* Body */}
          <div
            className="flex-1 overflow-y-auto overscroll-contain px-4 py-5 flex flex-col gap-5"
            style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))' }}
          >
            {/* Section: New contact */}
            <section className="glass-strong rounded-2xl p-4 flex flex-col gap-3" data-testid="section-new-contact">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <UserPlus className="w-5 h-5 text-primary" />
                </div>
                <h2 className="text-base font-semibold">{c.newContact}</h2>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                  {c.identifier}
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">@</span>
                  <Input
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
                className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-semibold text-sm transition-all ${
                  valid && !loading
                    ? 'gradient-primary glow-primary text-white hover:opacity-95 active:scale-[0.97]'
                    : 'bg-white/10 text-muted-foreground cursor-not-allowed'
                }`}
                data-testid="button-create-contact"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {loading ? c.creating : c.create}
              </button>
            </section>

            {/* Section: Invite friends (share link) */}
            <section className="glass-strong rounded-2xl p-4 flex flex-col gap-3" data-testid="section-invite-friends">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <Share2 className="w-5 h-5 text-primary" />
                </div>
                <h2 className="text-base font-semibold">{c.inviteFriends}</h2>
              </div>

              <div className="rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-muted-foreground break-words">
                {message}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={copyLink}
                  className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/15 active:scale-[0.97] font-medium text-sm transition-all"
                  data-testid="button-copy-invite-link"
                >
                  {t.chat.copy}
                </button>
                <button
                  type="button"
                  onClick={shareNative}
                  className="flex-1 py-3 rounded-xl gradient-primary glow-primary text-white font-semibold text-sm hover:opacity-95 active:scale-[0.97] transition-all"
                  data-testid="button-share-invite-link"
                >
                  {c.inviteFriends}
                </button>
              </div>
            </section>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
