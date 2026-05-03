import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  Link2,
  Image as ImageIcon,
  FileText,
  Mic,
  Play,
  ExternalLink,
  Film,
  MoreVertical,
  Search,
  UserPlus,
  Check,
  Loader2,
} from 'lucide-react';
import { usePreferences } from '@/lib/preferences-context';
import { translateGroupName } from '@/lib/i18n';
import { useToast } from '@/hooks/use-toast';
import { useListContacts, getGetConversationQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { getAuthHeaders } from '@/lib/auth-fetch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MediaViewer } from './media-viewer';
import { UserProfileSheet, UserProfileBody } from './user-profile-sheet';
import { useAuth } from '@/lib/auth-context';
import { CachedImg, InstantImg } from './cached-img';
import { getVideoPoster } from './video-thumbnail';
import { preloadMedia } from '@/lib/media-cache';

type Participant = {
  id: number;
  displayName: string;
  username?: string;
  avatar?: string | null;
  bio?: string | null;
  isOnline?: boolean;
};

type Conversation = {
  id: number;
  name?: string | null;
  type: string;
  participants?: Participant[];
};

type Msg = {
  imageUrl?: string | null;
  audioUrl?: string | null;
  mediaAlbum?: string[] | null;
  linkPreview?: {
    url: string;
    title?: string | null;
    description?: string | null;
    image?: string | null;
    siteName?: string | null;
  } | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  conversation: Conversation;
  messages: Msg[];
  onOpenConversation?: (convId: number) => void;
};

type View = 'main' | 'searchMembers' | 'addMembers';

function isVideo(url: string) {
  return /\.(mp4|webm|mov|avi|mkv)$/i.test(url);
}

export function GroupInfoSheet({ open, onClose, conversation, messages, onOpenConversation }: Props) {
  const { t, appLanguage } = usePreferences();
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [mediaViewer, setMediaViewer] = useState<{ urls: string[]; index: number } | null>(null);
  const [profileUser, setProfileUser] = useState<Participant | null>(null);
  const isGroup = conversation?.type === 'group';

  type Tab = 'media' | 'files' | 'links' | 'voice' | 'gifs';
  const [tab, setTab] = useState<Tab>('media');
  const [view, setView] = useState<View>('main');
  const [menuOpen, setMenuOpen] = useState(false);

  // Reset internal state every time the sheet is closed so it reopens fresh.
  useEffect(() => {
    if (!open) {
      setView('main');
      setMenuOpen(false);
      setProfileUser(null);
    }
  }, [open]);

  // Pre-warm the in-memory media cache the instant the sheet opens — so the
  // Media / Links / GIFs tabs paint instantly even on the very first click,
  // with no flash and no per-image network round-trip. We only schedule
  // photo URLs (videos already have a separate poster cache populated when
  // the user viewed them in the chat).
  useEffect(() => {
    if (!open) return;
    for (const m of messages) {
      if (m.imageUrl && !isVideo(m.imageUrl)) preloadMedia(m.imageUrl);
      if (m.mediaAlbum) {
        for (const u of m.mediaAlbum) {
          if (!isVideo(u)) preloadMedia(u);
        }
      }
      if (m.linkPreview?.image) preloadMedia(m.linkPreview.image);
    }
  }, [open, messages]);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'media', label: t.groupInfo.media },
    { key: 'files', label: t.groupInfo.files },
    { key: 'links', label: t.groupInfo.links },
    { key: 'voice', label: t.groupInfo.voice },
    { key: 'gifs', label: t.groupInfo.gifs },
  ];

  const rawTitle = conversation?.name || 'Conversation';
  const title = conversation?.type === 'group' ? translateGroupName(rawTitle, appLanguage) : rawTitle;
  const initial = title.substring(0, 1).toUpperCase();
  const memberCount = conversation?.participants?.length ?? 0;
  const groupLink = `https://thelegendsonline.social/join/${conversation.id}`;

  // For direct (1-on-1) conversations, pick the OTHER participant — their
  // profile is shown above the media tabs in place of the conversation
  // header.
  const otherUser: Participant | null = useMemo(() => {
    if (isGroup) return null;
    const me = currentUser?.id;
    const list = conversation?.participants ?? [];
    if (me == null) return list[0] ?? null;
    return list.find((pp) => pp.id !== me) ?? list[0] ?? null;
  }, [isGroup, conversation?.participants, currentUser?.id]);

  // Collect ALL media URLs in order (albums expanded + single images/videos)
  const isGifUrl = (url: string) =>
    /\.gif(\?|$)/i.test(url) || /(?:^|\/\/|\.)tenor\.com\//i.test(url) || /media\.tenor\./i.test(url);

  const allMediaUrls: string[] = [];
  const gifUrls: string[] = [];
  for (const m of messages) {
    if (m.mediaAlbum && Array.isArray(m.mediaAlbum) && m.mediaAlbum.length > 0) {
      for (const u of m.mediaAlbum) {
        if (isGifUrl(u)) gifUrls.push(u);
        else allMediaUrls.push(u);
      }
    } else if (m.imageUrl) {
      if (isGifUrl(m.imageUrl)) gifUrls.push(m.imageUrl);
      else allMediaUrls.push(m.imageUrl);
    }
  }

  const voiceMessages = messages.filter(m => m.audioUrl);

  // Deduplicate links by URL (keep first occurrence)
  const linkPreviews: NonNullable<Msg['linkPreview']>[] = [];
  const seenLinkUrls = new Set<string>();
  for (const m of messages) {
    const lp = m.linkPreview;
    if (lp?.url && !seenLinkUrls.has(lp.url)) {
      seenLinkUrls.add(lp.url);
      linkPreviews.push(lp);
    }
  }

  return createPortal(
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-[450] bg-background flex flex-col"
            style={{ height: '100dvh' }}
            initial={{ y: '-100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '-100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
          >
            {view === 'main' && (
              <MainView
                onBack={onClose}
                isGroup={isGroup}
                title={title}
                initial={initial}
                memberCount={memberCount}
                groupLink={groupLink}
                otherUser={otherUser}
                currentUserId={currentUser?.id ?? 0}
                onCloseSheet={onClose}
                onOpenConversation={onOpenConversation}
                onCopyLink={async () => {
                  try {
                    if (navigator.clipboard?.writeText) {
                      await navigator.clipboard.writeText(groupLink);
                    } else {
                      const ta = document.createElement('textarea');
                      ta.value = groupLink;
                      ta.style.position = 'fixed';
                      ta.style.opacity = '0';
                      document.body.appendChild(ta);
                      ta.select();
                      document.execCommand('copy');
                      document.body.removeChild(ta);
                    }
                    toast({ title: t.groupInfo.linkCopied, duration: 2000 });
                  } catch {
                    // Silent fail — clipboard may be blocked by the browser
                  }
                }}
                tabs={tabs}
                tab={tab}
                setTab={setTab}
                allMediaUrls={allMediaUrls}
                linkPreviews={linkPreviews}
                voiceMessages={voiceMessages}
                gifUrls={gifUrls}
                onOpenMedia={(urls, index) => setMediaViewer({ urls, index })}
                menuOpen={menuOpen}
                setMenuOpen={setMenuOpen}
                onSearchMembers={() => {
                  setMenuOpen(false);
                  setView('searchMembers');
                }}
                onAddMembers={() => {
                  setMenuOpen(false);
                  setView('addMembers');
                }}
                t={t}
              />
            )}

            {view === 'searchMembers' && (
              <SearchMembersView
                onBack={() => setView('main')}
                participants={conversation.participants ?? []}
                onUserClick={(p) => setProfileUser(p)}
                t={t}
              />
            )}

            {view === 'addMembers' && (
              <AddMembersView
                onBack={() => setView('main')}
                conversationId={conversation.id}
                existingIds={(conversation.participants ?? []).map((p) => p.id)}
                onAdded={(count) => {
                  toast({ title: t.groupInfo.membersAdded, duration: 2000 });
                  queryClient.invalidateQueries({
                    queryKey: getGetConversationQueryKey(conversation.id),
                  });
                  if (count > 0) setView('main');
                }}
                onError={() => {
                  toast({ title: t.groupInfo.addMembersError, variant: 'destructive', duration: 2500 });
                }}
                t={t}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Full-screen media viewer */}
      {mediaViewer && (
        <MediaViewer
          urls={mediaViewer.urls}
          startIndex={mediaViewer.index}
          onClose={() => setMediaViewer(null)}
        />
      )}

      {/* User profile detail (opened by tapping a member) */}
      {profileUser && currentUser && (
        <UserProfileSheet
          user={profileUser}
          currentUserId={currentUser.id}
          onClose={() => setProfileUser(null)}
          onOpenConversation={(convId) => {
            setProfileUser(null);
            onClose();
            onOpenConversation?.(convId);
          }}
        />
      )}
    </>,
    document.body,
  );
}

// --- Sub-views -------------------------------------------------------------

type MainViewProps = {
  onBack: () => void;
  isGroup: boolean;
  title: string;
  initial: string;
  memberCount: number;
  groupLink: string;
  otherUser: Participant | null;
  currentUserId: number;
  onCloseSheet: () => void;
  onOpenConversation?: (convId: number) => void;
  onCopyLink: () => void;
  tabs: { key: 'media' | 'files' | 'links' | 'voice' | 'gifs'; label: string }[];
  tab: 'media' | 'files' | 'links' | 'voice' | 'gifs';
  setTab: (t: 'media' | 'files' | 'links' | 'voice' | 'gifs') => void;
  allMediaUrls: string[];
  linkPreviews: NonNullable<Msg['linkPreview']>[];
  voiceMessages: Msg[];
  gifUrls: string[];
  onOpenMedia: (urls: string[], index: number) => void;
  menuOpen: boolean;
  setMenuOpen: (b: boolean) => void;
  onSearchMembers: () => void;
  onAddMembers: () => void;
  t: ReturnType<typeof usePreferences>['t'];
};

function MainView(p: MainViewProps) {
  // While the 3-dot popover is open, the FIRST tap anywhere outside
  // the popover (or its trigger) should ONLY dismiss the popover —
  // it must not also fire whatever onClick is underneath (e.g. the
  // back arrow). We attach a document-level CAPTURE-phase handler
  // that closes the popover and stops further propagation. The user
  // then needs to tap a second time to actually trigger an action.
  useEffect(() => {
    if (!p.menuOpen) return;
    const handler = (e: Event) => {
      const target = e.target as Element | null;
      if (target && target.closest && target.closest('[data-overlay-region="group-info-menu"]')) return;
      p.setMenuOpen(false);
      e.stopPropagation();
      if (typeof (e as any).stopImmediatePropagation === 'function') {
        (e as any).stopImmediatePropagation();
      }
    };
    document.addEventListener('click', handler, true);
    document.addEventListener('touchstart', handler, true);
    return () => {
      document.removeEventListener('click', handler, true);
      document.removeEventListener('touchstart', handler, true);
    };
  }, [p.menuOpen, p.setMenuOpen]);

  return (
    <div
      className="flex flex-col h-full overflow-y-auto bg-background"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Top bar with back arrow and (group only) 3-dot menu */}
      <div
        className="sticky top-0 z-10 flex items-center justify-between px-3 bg-background/80 backdrop-blur-md gradient-hairline-bottom"
        style={{
          paddingTop: `calc(0.75rem + env(safe-area-inset-top, 0px))`,
          paddingBottom: 12,
          minHeight: `calc(4rem + env(safe-area-inset-top, 0px))`,
        }}
      >
        <button
          onClick={() => { p.setMenuOpen(false); p.onBack(); }}
          className="w-10 h-10 rounded-full glass flex items-center justify-center text-foreground hover:text-primary transition-colors"
          aria-label="Retour"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        {p.isGroup ? (
          <Popover open={p.menuOpen} onOpenChange={p.setMenuOpen}>
            <PopoverTrigger asChild>
              <button
                data-overlay-region="group-info-menu"
                className="w-10 h-10 rounded-full glass flex items-center justify-center text-foreground hover:text-primary transition-colors"
                aria-label="Menu"
              >
                <MoreVertical className="w-5 h-5" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={8}
              data-overlay-region="group-info-menu"
              className="w-60 p-1 glass-strong border-border/40 rounded-2xl z-[460] shadow-2xl"
            >
              <button
                onClick={p.onSearchMembers}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm text-foreground hover:bg-foreground/5 transition-colors"
              >
                <Search className="w-4 h-4 text-primary" />
                <span>{p.t.groupInfo.searchMembers}</span>
              </button>
              <button
                onClick={p.onAddMembers}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm text-foreground hover:bg-foreground/5 transition-colors"
              >
                <UserPlus className="w-4 h-4 text-primary" />
                <span>{p.t.groupInfo.addMembers}</span>
              </button>
            </PopoverContent>
          </Popover>
        ) : (
          <div className="w-10 h-10" />
        )}
      </div>

      {/* Header section: for direct (1-on-1) chats we show the full user
          profile (avatar, name, online status, action tiles, bio,
          @username, add/remove contact) — same as the user details page.
          For groups we keep the simple avatar + group name + member count. */}
      {!p.isGroup && p.otherUser ? (
        <div className="pb-4">
          <UserProfileBody
            user={p.otherUser}
            currentUserId={p.currentUserId}
            onClose={p.onCloseSheet}
            onOpenConversation={(convId) => p.onOpenConversation?.(convId)}
            showActions={false}
          />
        </div>
      ) : (
        <div className="flex flex-col items-center pb-4 px-4 pt-2">
          <div className="w-20 h-20 rounded-2xl gradient-primary glow-primary-sm flex items-center justify-center mb-3">
            <span className="text-3xl font-bold text-white">{p.initial}</span>
          </div>
          <h2 className="text-lg font-bold text-foreground">{p.title}</h2>
          <p className="text-sm text-muted-foreground">{p.memberCount} {p.t.groupInfo.members}</p>
        </div>
      )}

      {/* Group link — only shown for groups, not for private 1-on-1 chats */}
      {p.isGroup && (
        <div className="mx-4 mb-4 glass rounded-2xl px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full gradient-primary-soft border border-primary/30 flex items-center justify-center flex-shrink-0">
            <Link2 className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-muted-foreground">{p.t.groupInfo.groupLink}</p>
            <p className="text-xs text-foreground truncate font-mono">{p.groupLink.substring(0, 35)}...</p>
          </div>
          <button
            onClick={p.onCopyLink}
            className="text-muted-foreground hover:text-primary transition-colors p-1 flex-shrink-0"
            aria-label={p.t.groupInfo.groupLink}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeWidth="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" strokeWidth="2" />
            </svg>
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="mx-4 gradient-hairline-bottom pb-2">
        <div className="glass relative grid grid-cols-5 gap-0.5 rounded-2xl p-1 overflow-hidden">
          {p.tabs.map(tabItem => {
            const active = p.tab === tabItem.key;
            return (
              <button
                key={tabItem.key}
                onClick={() => p.setTab(tabItem.key)}
                className={`relative py-2 rounded-xl text-[11px] font-medium transition-colors ${
                  active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="activeGroupInfoTabPill"
                    className="absolute inset-0 rounded-xl gradient-primary-soft border border-primary/35"
                    style={{ boxShadow: '0 4px 14px -6px hsl(263 90% 65% / 0.45), inset 0 1px 0 rgba(255,255,255,0.06)' }}
                    transition={{ type: 'spring', damping: 26, stiffness: 320 }}
                  />
                )}
                <span className="relative z-10">{tabItem.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 p-4 min-h-[160px]">
        {p.tab === 'media' && (
          p.allMediaUrls.length > 0 ? (
            <div className="grid grid-cols-3 gap-1">
              {p.allMediaUrls.map((url, i) => (
                <button
                  key={i}
                  className="aspect-square rounded-lg overflow-hidden relative group focus:outline-none active:opacity-75 transition-opacity"
                  onClick={() => p.onOpenMedia(p.allMediaUrls, i)}
                >
                  {isVideo(url) ? (
                    <>
                      {(() => {
                        // Reuse the locally-cached first-frame poster
                        // captured when the user first viewed this video
                        // in the chat — paints the real frame instantly,
                        // no network round-trip, no grey/black box.
                        const poster = getVideoPoster(url);
                        return poster ? (
                          <InstantImg
                            src={poster}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <video
                            src={url}
                            className="w-full h-full object-cover"
                            muted
                            playsInline
                            preload="metadata"
                          />
                        );
                      })()}
                      <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                        <div className="w-8 h-8 rounded-full bg-black/60 flex items-center justify-center">
                          <Play className="w-4 h-4 text-white fill-white ml-0.5" />
                        </div>
                      </div>
                    </>
                  ) : (
                    <CachedImg
                      src={url}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  )}
                </button>
              ))}
            </div>
          ) : (
            <EmptyState icon={<ImageIcon className="w-8 h-8" />} label={p.t.groupInfo.noMedia} />
          )
        )}
        {p.tab === 'files' && (
          <EmptyState icon={<FileText className="w-8 h-8" />} label={p.t.groupInfo.noFiles} />
        )}
        {p.tab === 'links' && (
          p.linkPreviews.length > 0 ? (
            <div className="space-y-2">
              {p.linkPreviews.map((lp, i) => (
                <a
                  key={i}
                  href={lp.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="glass rounded-xl px-3 py-2 flex items-center gap-3 hover:bg-foreground/5 transition-colors"
                >
                  {lp.image ? (
                    <CachedImg
                      src={lp.image}
                      alt=""
                      className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-lg gradient-primary-soft border border-primary/30 flex items-center justify-center flex-shrink-0">
                      <ExternalLink className="w-4 h-4 text-primary" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">
                      {lp.title || lp.siteName || lp.url}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">{lp.url}</p>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <EmptyState icon={<ExternalLink className="w-8 h-8" />} label={p.t.groupInfo.noLinks} />
          )
        )}
        {p.tab === 'voice' && (
          p.voiceMessages.length > 0 ? (
            <div className="space-y-2">
              {p.voiceMessages.map((m, i) => (
                <div key={i} className="glass rounded-xl px-3 py-2 flex items-center gap-2">
                  <Mic className="w-4 h-4 text-primary flex-shrink-0" />
                  <span className="text-xs text-muted-foreground">{p.t.groupInfo.voiceMessage} {i + 1}</span>
                  <audio controls src={m.audioUrl!} className="flex-1 h-6" />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={<Mic className="w-8 h-8" />} label={p.t.groupInfo.noVoice} />
          )
        )}
        {p.tab === 'gifs' && (
          p.gifUrls.length > 0 ? (
            <div className="grid grid-cols-3 gap-1">
              {p.gifUrls.map((url, i) => (
                <button
                  key={i}
                  className="aspect-square rounded-lg overflow-hidden relative focus:outline-none active:opacity-75 transition-opacity"
                  onClick={() => p.onOpenMedia(p.gifUrls, i)}
                >
                  <CachedImg
                    src={url}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState icon={<Film className="w-8 h-8" />} label={p.t.groupInfo.noGifs} />
          )
        )}
      </div>
    </div>
  );
}

// --- Search current members ------------------------------------------------

function SearchMembersView({
  onBack,
  participants,
  onUserClick,
  t,
}: {
  onBack: () => void;
  participants: Participant[];
  onUserClick: (p: Participant) => void;
  t: ReturnType<typeof usePreferences>['t'];
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return participants;
    return participants.filter((p) => p.displayName.toLowerCase().includes(q));
  }, [participants, query]);

  return (
    <div className="flex flex-col h-full">
      {/* Header with back + search input */}
      <div
        className="sticky top-0 z-10 flex items-center gap-2 px-3 bg-background/80 backdrop-blur-md gradient-hairline-bottom"
        style={{
          paddingTop: `calc(0.75rem + env(safe-area-inset-top, 0px))`,
          paddingBottom: 12,
          minHeight: `calc(4rem + env(safe-area-inset-top, 0px))`,
        }}
      >
        <button
          onClick={onBack}
          className="w-10 h-10 rounded-full glass flex items-center justify-center text-foreground hover:text-primary transition-colors flex-shrink-0"
          aria-label="Retour"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.groupInfo.searchPlaceholder}
            className="w-full h-10 pl-9 pr-3 rounded-full glass border border-border/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        <p className="px-3 pt-1 pb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
          {t.groupInfo.membersInGroup}
        </p>
        {filtered.length === 0 ? (
          <EmptyState icon={<Search className="w-8 h-8" />} label={t.groupInfo.noMembersFound} />
        ) : (
          <ul className="space-y-1">
            {filtered.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onUserClick(m)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-foreground/5 active:bg-foreground/10 transition-colors text-left"
                  data-testid={`button-member-${m.id}`}
                >
                  <Avatar className="w-10 h-10">
                    <AvatarImage src={m.avatar ?? undefined} />
                    <AvatarFallback className="gradient-primary text-white text-sm">
                      {m.displayName.substring(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{m.displayName}</p>
                    {m.isOnline && (
                      <p className="text-[11px] text-primary">en ligne</p>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// --- Add new members -------------------------------------------------------

type SearchedUser = {
  id: number;
  username: string;
  displayName: string;
  avatar?: string | null;
};

function AddMembersView({
  onBack,
  conversationId,
  existingIds,
  onAdded,
  onError,
  t,
}: {
  onBack: () => void;
  conversationId: number;
  existingIds: number[];
  onAdded: (addedCount: number) => void;
  onError: () => void;
  t: ReturnType<typeof usePreferences>['t'];
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Map<number, SearchedUser>>(new Map());
  const [submitting, setSubmitting] = useState(false);

  // Pull from the user's own contact list rather than searching all users.
  const { data: contacts, isLoading } = useListContacts();

  const existingSet = useMemo(() => new Set(existingIds), [existingIds]);

  const candidates: SearchedUser[] = useMemo(() => {
    const base = (contacts ?? []) as SearchedUser[];
    const trimmed = query.trim().toLowerCase();
    const notMembers = base.filter((u) => !existingSet.has(u.id));
    if (!trimmed) return notMembers;
    return notMembers.filter(
      (u) =>
        u.displayName.toLowerCase().includes(trimmed) ||
        u.username.toLowerCase().includes(trimmed),
    );
  }, [contacts, existingSet, query]);

  const toggle = (u: SearchedUser) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(u.id)) next.delete(u.id);
      else next.set(u.id, u);
      return next;
    });
  };

  const submit = async () => {
    if (selected.size === 0 || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/participants`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } as Record<string, string>,
        body: JSON.stringify({ userIds: Array.from(selected.keys()) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { added: number[] } = await res.json();
      onAdded(Array.isArray(data.added) ? data.added.length : 0);
    } catch {
      onError();
    } finally {
      setSubmitting(false);
    }
  };

  const selectedList = Array.from(selected.values());

  return (
    <div className="flex flex-col h-full">
      {/* Header: back + title + Add button */}
      <div
        className="sticky top-0 z-10 flex items-center gap-3 px-3 bg-background/80 backdrop-blur-md gradient-hairline-bottom"
        style={{
          paddingTop: `calc(0.75rem + env(safe-area-inset-top, 0px))`,
          paddingBottom: 12,
          minHeight: `calc(4rem + env(safe-area-inset-top, 0px))`,
        }}
      >
        <button
          onClick={onBack}
          className="w-10 h-10 rounded-full glass flex items-center justify-center text-foreground hover:text-primary transition-colors flex-shrink-0"
          aria-label="Retour"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="flex-1 text-base font-semibold text-foreground truncate">
          {t.groupInfo.addMembers}
        </h2>
        <button
          onClick={submit}
          disabled={selected.size === 0 || submitting}
          className="px-4 h-9 rounded-full text-xs font-semibold gradient-primary text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-opacity"
        >
          {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {t.groupInfo.add}
          {selected.size > 0 && !submitting && (
            <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-white/25 text-[10px]">
              {selected.size}
            </span>
          )}
        </button>
      </div>

      {/* Selected chips */}
      {selectedList.length > 0 && (
        <div className="px-3 pt-2 pb-1 flex flex-wrap gap-2 gradient-hairline-bottom">
          {selectedList.map((u) => (
            <button
              key={u.id}
              onClick={() => toggle(u)}
              className="flex items-center gap-2 pr-3 pl-1 py-1 rounded-full glass border border-primary/40 text-xs text-foreground hover:bg-foreground/5 transition-colors"
            >
              <Avatar className="w-6 h-6">
                <AvatarImage src={u.avatar ?? undefined} />
                <AvatarFallback className="gradient-primary text-white text-[10px]">
                  {u.displayName.substring(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="truncate max-w-[120px]">{u.displayName}</span>
            </button>
          ))}
        </div>
      )}

      {/* Search input */}
      <div className="px-3 pt-3 pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.groupInfo.searchPeoplePlaceholder}
            className="w-full h-10 pl-9 pr-3 rounded-full glass border border-border/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : candidates.length === 0 ? (
          <EmptyState
            icon={query.trim() ? <Search className="w-8 h-8" /> : <UserPlus className="w-8 h-8" />}
            label={query.trim() ? t.groupInfo.noPeopleFound : t.contacts.noContacts}
          />
        ) : (
          <ul className="space-y-1">
            {candidates.map((u) => {
              const isSelected = selected.has(u.id);
              return (
                <li key={u.id}>
                  <button
                    onClick={() => toggle(u)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left hover:bg-foreground/5 transition-colors"
                  >
                    <div className="relative">
                      <Avatar className="w-10 h-10">
                        <AvatarImage src={u.avatar ?? undefined} />
                        <AvatarFallback className="gradient-primary text-white text-sm">
                          {u.displayName.substring(0, 1).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      {isSelected && (
                        <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full gradient-primary border-2 border-background flex items-center justify-center">
                          <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                        </span>
                      )}
                    </div>
                    <span className="flex-1 text-sm text-foreground truncate">{u.displayName}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function EmptyState({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
      {icon}
      <p className="text-sm">{label}</p>
    </div>
  );
}
