import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChatArea } from '@/components/chat/chat-area';
import { ConversationList } from '@/components/chat/conversation-list';
import { useAuth } from '@/lib/auth-context';
import { useIsMobile } from '@/hooks/use-mobile';
import { useQueryClient } from '@tanstack/react-query';
import { getListConversationsQueryKey } from '@workspace/api-client-react';
import { AnimatedBackground } from '@/components/animated-background';
import { Users, MessageSquare, Settings, Zap, LogOut, Globe, Languages, ChevronDown, Shield, X, ChevronRight, Download, Smartphone, CheckCircle2, Share, Bell, BellOff, User, Contact } from 'lucide-react';
import { AdminPanel } from '@/components/admin/admin-panel';
import { ProfilePage } from '@/components/profile/profile-page';
import { ContactsPage } from '@/components/contacts/contacts-page';
import { CallBanner } from '@/components/chat/call-modal';
import { usePreferences } from '@/lib/preferences-context';
import { SUPPORTED_APP_LANGUAGES, SUPPORTED_TRANSLATE_LANGUAGES } from '@/lib/i18n';
import { usePushNotifications } from '@/hooks/use-push-notifications';

/* ── PWA install prompt — captured at module level before React mounts ── */
let _pwaPrompt: any = null;
let _pwaPromptListeners: Array<() => void> = [];
function onPwaPromptReady(cb: () => void) { _pwaPromptListeners.push(cb); }
window.addEventListener('beforeinstallprompt', (e: any) => {
  e.preventDefault();
  _pwaPrompt = e;
  _pwaPromptListeners.forEach(fn => fn());
  _pwaPromptListeners = [];
});

type Tab = 'groups' | 'messages' | 'profile' | 'contacts' | 'settings';

const NAV_ICONS: Record<Tab, typeof Users> = {
  groups: Users,
  messages: MessageSquare,
  profile: User,
  contacts: Contact,
  settings: Settings,
};

const TAB_ORDER: Tab[] = ['groups', 'messages', 'profile', 'contacts', 'settings'];

export default function Home() {
  const { user, logout, refetchUser } = useAuth();
  const { t } = usePreferences();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('groups');
  const [activeConvId, setActiveConvId] = useState<number | undefined>();
  const [swipeDir, setSwipeDir] = useState<1 | -1>(1);

  // ── Open conversation from push notification ──────────────────────────────
  const openConversation = useCallback((convId: number, isGroupConv: boolean) => {
    setActiveTab(isGroupConv ? 'groups' : 'messages');
    setActiveConvId(convId);
  }, []);

  // Handle SW postMessage (app already open when notification is tapped)
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'OPEN_CONVERSATION') {
        openConversation(Number(event.data.conversationId), Boolean(event.data.isGroup));
      }
      if (event.data?.type === 'MESSAGE_SENT') {
        openConversation(Number(event.data.conversationId), Boolean(event.data.isGroup));
      }
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, [openConversation]);

  // Handle URL params (app was closed — opened fresh via notification link)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const convId = params.get('conv');
    const type = params.get('type');
    if (convId) {
      // Clean the URL immediately so a refresh doesn't re-trigger this
      window.history.replaceState({}, '', window.location.pathname);
      openConversation(Number(convId), type !== 'direct');
    }
  }, [openConversation]);
  // ─────────────────────────────────────────────────────────────────────────

  // ── Swipe between tabs ───────────────────────────────────────
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const swipeLocked = useRef(false);

  const handleSwipeStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    swipeLocked.current = false;
  };

  const handleSwipeEnd = (e: React.TouchEvent) => {
    if (swipeLocked.current) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = Math.abs(e.changedTouches[0].clientY - touchStartY.current);
    if (Math.abs(dx) < 60 || dy > Math.abs(dx) * 0.8) return; // too short or too vertical
    const currentIdx = TAB_ORDER.indexOf(activeTab);
    if (dx < 0 && currentIdx < TAB_ORDER.length - 1) {
      // swipe left → next tab
      setSwipeDir(1);
      handleTabChange(TAB_ORDER[currentIdx + 1]);
    } else if (dx > 0 && currentIdx > 0) {
      // swipe right → previous tab
      setSwipeDir(-1);
      handleTabChange(TAB_ORDER[currentIdx - 1]);
    }
  };

  const handleSwipeMove = (e: React.TouchEvent) => {
    const dy = Math.abs(e.touches[0].clientY - touchStartY.current);
    const dx = Math.abs(e.touches[0].clientX - touchStartX.current);
    if (dy > dx && dy > 10) swipeLocked.current = true; // vertical scroll wins
  };
  // ────────────────────────────────────────────────────────────

  if (!user) return null;

  const showList = !isMobile || !activeConvId;
  const showChat = !isMobile || !!activeConvId;

  const handleSelectConv = (id: number) => {
    // Zero out the unread badge immediately on tap — before messages even load
    queryClient.setQueryData(getListConversationsQueryKey(), (old: any[]) => {
      if (!Array.isArray(old)) return old;
      return old.map(conv => conv.id === id ? { ...conv, unreadCount: 0 } : conv);
    });
    setActiveConvId(id);
  };
  const handleBack = () => { setActiveConvId(undefined); };
  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    if (isMobile) setActiveConvId(undefined);
  };

  const slideVariants = {
    enter: (dir: number) => ({ x: dir > 0 ? '100%' : '-100%', opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? '-100%' : '100%', opacity: 0 }),
  };

  return (
    <div className="flex h-full w-full overflow-hidden text-foreground relative">
      <AnimatedBackground />

      {/* ── Desktop sidebar ── */}
      {!isMobile && (
        <aside className="relative z-10 w-[340px] min-w-[340px] h-full flex flex-col border-r border-border/50">
          <DesktopHeader user={user} onLogout={logout} />
          <CallBanner />
          <DesktopTabs activeTab={activeTab} onSelect={setActiveTab} />
          <div className="flex-1 min-h-0 overflow-hidden">
            <TabContent
              tab={activeTab}
              activeConvId={activeConvId}
              onSelectConv={handleSelectConv}
              isMobile={false}
              onLogout={logout}
              onRefetchUser={refetchUser}
              user={user}
            />
          </div>
        </aside>
      )}

      {/* ── Mobile: list or chat ── */}
      {isMobile ? (
        <div className="relative z-10 flex-1 flex flex-col h-full min-w-0">
          {showList && !activeConvId && (
            <div className="flex flex-col h-full">
              <MobileHeader user={user} />
              <CallBanner />

              {/* Content area with swipe + animated tab transitions */}
              <div
                className="flex-1 min-h-0 overflow-hidden relative"
                onTouchStart={handleSwipeStart}
                onTouchMove={handleSwipeMove}
                onTouchEnd={handleSwipeEnd}
              >
                <AnimatePresence mode="popLayout" custom={swipeDir} initial={false}>
                  <motion.div
                    key={activeTab}
                    custom={swipeDir}
                    variants={slideVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ type: 'tween', duration: 0.25, ease: 'easeInOut' }}
                    className="absolute inset-0"
                  >
                    <TabContent
                      tab={activeTab}
                      activeConvId={activeConvId}
                      onSelectConv={handleSelectConv}
                      isMobile
                      onLogout={logout}
                      onRefetchUser={refetchUser}
                      user={user}
                    />
                  </motion.div>
                </AnimatePresence>

                {/* Edge swipe zones — float above iframe (Shop tab) */}
                <div
                  className="absolute left-0 top-0 bottom-0 w-7 z-20"
                  onTouchStart={handleSwipeStart}
                  onTouchMove={handleSwipeMove}
                  onTouchEnd={handleSwipeEnd}
                />
                <div
                  className="absolute right-0 top-0 bottom-0 w-7 z-20"
                  onTouchStart={handleSwipeStart}
                  onTouchMove={handleSwipeMove}
                  onTouchEnd={handleSwipeEnd}
                />
              </div>

              <MobileBottomNav
                activeTab={activeTab}
                onSelect={(t) => {
                  const cur = TAB_ORDER.indexOf(activeTab);
                  const nxt = TAB_ORDER.indexOf(t);
                  setSwipeDir(nxt >= cur ? 1 : -1);
                  handleTabChange(t);
                }}
                floating
              />
            </div>
          )}
          {showChat && activeConvId && (
            <ChatArea
              conversationId={activeConvId}
              onBack={handleBack}
              onOpenConversation={(convId) => openConversation(convId, false)}
            />
          )}
        </div>
      ) : (
        /* Desktop: chat panel */
        <div className="relative z-10 flex-1 h-full min-w-0 flex flex-col">
          {activeConvId ? (
            <ChatArea
              conversationId={activeConvId}
              onBack={undefined}
              onOpenConversation={(convId) => openConversation(convId, false)}
            />
          ) : (
            <div className="flex h-full items-center justify-center flex-col gap-4 text-muted-foreground">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Zap className="w-8 h-8 text-primary" />
              </div>
              <p className="text-base font-medium">{t.home.selectConversation}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Desktop header ── */
function DesktopHeader({ user, onLogout }: { user: { displayName: string }; onLogout: () => void }) {
  return (
    <div className="flex-shrink-0 h-14 flex items-center justify-between px-4 glass gradient-hairline-bottom">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl gradient-primary flex items-center justify-center glow-primary-sm">
          <Zap className="w-4 h-4 text-white" />
        </div>
        <span className="font-bold text-base text-gradient-primary">The Legends Online</span>
      </div>
      <button onClick={onLogout} className="text-muted-foreground hover:text-foreground transition-colors p-1">
        <LogOut className="w-5 h-5" />
      </button>
    </div>
  );
}

/* ── Desktop tab pills (shared visual language with mobile capsule) ── */
function DesktopTabs({ activeTab, onSelect }: { activeTab: Tab; onSelect: (t: Tab) => void }) {
  const { t } = usePreferences();
  return (
    <div className="flex-shrink-0 px-2 py-2 gradient-hairline-bottom">
      <div className="glass relative grid grid-cols-5 gap-0.5 rounded-2xl p-1 overflow-hidden">
        {TAB_ORDER.map((id) => {
          const Icon = NAV_ICONS[id];
          const label = t.tabs[id];
          const active = activeTab === id;
          const isProfile = id === 'profile';
          return (
            <button
              key={id}
              onClick={() => onSelect(id)}
              className={`relative flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-xl text-[11px] font-medium transition-colors min-w-0 ${
                active ? 'text-white' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="activeDesktopTabPill"
                  className="absolute inset-0 rounded-xl gradient-primary-soft border border-primary/40"
                  style={{ boxShadow: '0 4px 14px -6px hsl(263 90% 65% / 0.55), inset 0 1px 0 rgba(255,255,255,0.08)' }}
                  transition={{ type: 'spring', damping: 26, stiffness: 320 }}
                />
              )}
              <span className="relative z-10 inline-flex items-center justify-center w-6 h-6">
                {isProfile && (
                  <>
                    <span aria-hidden className="absolute inset-0 rounded-full profile-tab-aura pointer-events-none" />
                    <span aria-hidden className="absolute inset-[-2px] rounded-full profile-tab-orbit pointer-events-none" />
                  </>
                )}
                <motion.span
                  animate={{ scale: active ? 1.1 : 1 }}
                  transition={{ type: 'spring', damping: 22, stiffness: 320 }}
                  className="relative inline-flex"
                  style={active || isProfile ? { filter: 'drop-shadow(0 0 6px hsl(263 92% 65% / 0.85))' } : undefined}
                >
                  <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                </motion.span>
              </span>
              <span className="truncate w-full text-center leading-none relative z-10">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Mobile header ── */
function MobileHeader({ user }: { user: { displayName: string } }) {
  return (
    <div
      className="flex-shrink-0 flex items-center justify-between px-4 gradient-hairline-bottom relative surface-header"
      style={{
        paddingTop: `calc(env(safe-area-inset-top, 0px) + 12px)`,
        paddingBottom: 12,
        minHeight: '3.5rem',
      }}
    >
      <div className="flex items-center gap-2.5 relative z-10">
        <div className="w-8 h-8 rounded-xl gradient-primary flex items-center justify-center glow-primary-sm">
          <Zap className="w-4 h-4 text-white" />
        </div>
        <span className="font-bold text-base text-gradient-primary">The Legends Online</span>
      </div>
      <div className="flex items-center gap-2 relative z-10">
        <div className="w-7 h-7 rounded-lg gradient-primary-soft border border-primary/35 flex items-center justify-center">
          <span className="text-xs font-bold text-primary">{user.displayName.substring(0, 2).toUpperCase()}</span>
        </div>
      </div>
    </div>
  );
}

/* ── Mobile bottom nav — floating glass capsule with sliding active pill ── */
function MobileBottomNav({
  activeTab,
  onSelect,
  floating = false,
}: {
  activeTab: Tab;
  onSelect: (t: Tab) => void;
  floating?: boolean;
}) {
  const { t } = usePreferences();
  return (
    <nav
      className={
        floating
          ? 'absolute left-0 right-0 bottom-0 z-30 px-3 pointer-events-none'
          : 'flex-shrink-0 px-3 pt-1.5 relative'
      }
      style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
    >
      {/* Soft blur veil — auto-fits the nav's exact height so it starts pile au bord du haut de la barre */}
      {floating && (
        <div
          aria-hidden
          className="absolute inset-0 -z-10 pointer-events-none"
          style={{
            backdropFilter: 'blur(14px) saturate(140%)',
            WebkitBackdropFilter: 'blur(14px) saturate(140%)',
            background: 'linear-gradient(to top, hsl(var(--background) / 0.4), hsl(var(--background) / 0.25))',
          }}
        />
      )}
      {/* Floating capsule shell */}
      <div className={`glass gradient-hairline-top shadow-floating-capsule relative flex items-stretch rounded-[14px] px-1.5 py-1 overflow-visible ${floating ? 'pointer-events-auto' : ''}`}>
        <div className="absolute inset-0 rounded-[14px] overflow-hidden pointer-events-none -z-[1]" />
        {TAB_ORDER.map((id) => {
          const Icon = NAV_ICONS[id];
          const active = activeTab === id;
          const isProfile = id === 'profile';
          return (
            <button
              key={id}
              onClick={() => onSelect(id)}
              aria-label={t.tabs[id]}
              className={`flex-1 relative flex flex-col items-center justify-center py-2 gap-0.5 transition-colors ${
                active ? 'text-primary' : isProfile ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <span className={`relative z-10 inline-flex items-center justify-center ${isProfile ? 'w-9 h-9' : 'w-7 h-7'}`}>
                {isProfile && (
                  <>
                    <span aria-hidden className="absolute inset-0 rounded-full profile-tab-aura pointer-events-none" />
                    <span aria-hidden className="absolute inset-[-3px] rounded-full profile-tab-orbit pointer-events-none" />
                  </>
                )}
                <motion.span
                  animate={{ scale: active ? 1.12 : isProfile ? 1.05 : 1 }}
                  transition={{ type: 'spring', damping: 22, stiffness: 320 }}
                  className="relative inline-flex"
                  style={active || isProfile ? { filter: 'drop-shadow(0 0 8px hsl(263 92% 65% / 0.85))' } : undefined}
                >
                  <Icon className={isProfile ? 'w-6 h-6' : 'w-5 h-5'} />
                </motion.span>
              </span>
              {!isProfile && (
                <span className={`text-[10px] font-medium relative z-10 transition-opacity ${active ? 'opacity-100' : 'opacity-80'}`}>
                  {t.tabs[id]}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/* ── Tab content switcher ── */
function TabContent({
  tab, activeConvId, onSelectConv, isMobile, onLogout, onRefetchUser, user,
}: {
  tab: Tab;
  activeConvId?: number;
  onSelectConv: (id: number) => void;
  isMobile: boolean;
  onLogout: () => void;
  onRefetchUser: () => void;
  user: { id: number; displayName: string; username: string; avatar?: string | null; bio?: string | null };
}) {
  if (tab === 'groups') {
    return (
      <ConversationList
        filterType="group"
        activeConvId={activeConvId}
        onSelectConv={onSelectConv}
        user={user}
      />
    );
  }
  if (tab === 'messages') {
    return (
      <ConversationList
        filterType="direct"
        activeConvId={activeConvId}
        onSelectConv={onSelectConv}
        user={user}
      />
    );
  }
  if (tab === 'profile') {
    return <ProfilePage user={user} onSaved={onRefetchUser} />;
  }
  if (tab === 'contacts') {
    return <ContactsPage user={user} onSelectConv={onSelectConv} />;
  }
  if (tab === 'settings') {
    return <SettingsPage user={user} onLogout={onLogout} onRefetchUser={onRefetchUser} />;
  }
  return null;
}


/* ── Settings page ── */
function SettingsPage({
  user, onLogout, onRefetchUser,
}: {
  user: { displayName: string; username: string; avatar?: string | null; bio?: string | null; isAdmin?: boolean };
  onLogout: () => void;
  onRefetchUser: () => void;
}) {
  const { t, appLanguage, setAppLanguage, translateLanguage, setTranslateLanguage } = usePreferences();
  const [openLangMenu, setOpenLangMenu] = useState<'app' | 'translate' | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const { isSupported: pushSupported, permission: pushPermission, isSubscribed: pushSubscribed, isLoading: pushLoading, enable: enablePush, disable: disablePush } = usePushNotifications();
  const [showIosInstructions, setShowIosInstructions] = useState(false);
  const [showAndroidInstructions, setShowAndroidInstructions] = useState(false);
  const [canInstall, setCanInstall] = useState(() => !!_pwaPrompt);
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;

  useEffect(() => {
    if (_pwaPrompt) { setCanInstall(true); return; }
    onPwaPromptReady(() => setCanInstall(true));
  }, []);

  const handleInstall = async () => {
    if (isIos) { setShowIosInstructions(true); return; }
    if (_pwaPrompt) {
      try {
        _pwaPrompt.prompt();
        await _pwaPrompt.userChoice;
      } catch (_) {}
      _pwaPrompt = null;
      setCanInstall(false);
    } else {
      setShowAndroidInstructions(true);
    }
  };

  const currentAppLang = SUPPORTED_APP_LANGUAGES.find(l => l.code === appLanguage);
  const currentTranslateLang = SUPPORTED_TRANSLATE_LANGUAGES.find(l => l.code === translateLanguage);

  return (
    <div
      className="h-full overflow-y-auto overscroll-contain"
      style={{ paddingBottom: 'calc(5.5rem + env(safe-area-inset-bottom, 0px))' }}
    >
    <div className="flex flex-col p-4 gap-4">
      {/* Preferences section */}
      <div>
        <p className="text-xs font-semibold text-primary/70 uppercase tracking-wider px-1 mb-2">{t.settings.preferences}</p>
        <div className="glass rounded-2xl overflow-hidden divide-y divide-foreground/5">

          {/* App language */}
          <div className="relative">
            <button
              onClick={() => setOpenLangMenu(openLangMenu === 'app' ? null : 'app')}
              className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-foreground/5 transition-colors text-left"
            >
              <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0">
                <Globe className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{t.settings.appLanguage}</p>
                <p className="text-xs text-muted-foreground">{t.settings.appLanguageDesc}</p>
              </div>
              <div className="flex items-center gap-1.5 text-sm text-primary font-medium">
                <span>{currentAppLang?.flag}</span>
                <span className="hidden sm:inline">{currentAppLang?.label}</span>
                <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${openLangMenu === 'app' ? 'rotate-180' : ''}`} />
              </div>
            </button>
            {openLangMenu === 'app' && (
              <div className="glass-strong gradient-hairline-top py-1.5 px-1.5 flex flex-col gap-0.5">
                {SUPPORTED_APP_LANGUAGES.map(lang => {
                  const active = appLanguage === lang.code;
                  return (
                    <button
                      key={lang.code}
                      onClick={() => { setAppLanguage(lang.code); setOpenLangMenu(null); }}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all ${
                        active
                          ? 'gradient-primary-soft border border-primary/35 text-primary font-semibold'
                          : 'border border-transparent text-foreground hover:bg-foreground/5'
                      }`}
                    >
                      <span className="text-base">{lang.flag}</span>
                      <span>{lang.label}</span>
                      {active && <span className="ml-auto text-primary text-xs">✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Translation language */}
          <div className="relative">
            <button
              onClick={() => setOpenLangMenu(openLangMenu === 'translate' ? null : 'translate')}
              className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-foreground/5 transition-colors text-left"
            >
              <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0">
                <Languages className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{t.settings.translateLanguage}</p>
                <p className="text-xs text-muted-foreground">{t.settings.translateLanguageDesc}</p>
              </div>
              <div className="flex items-center gap-1.5 text-sm text-primary font-medium">
                <span>{currentTranslateLang?.flag}</span>
                <span className="hidden sm:inline">{currentTranslateLang?.label}</span>
                <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${openLangMenu === 'translate' ? 'rotate-180' : ''}`} />
              </div>
            </button>
            {openLangMenu === 'translate' && (
              <div className="glass-strong gradient-hairline-top py-1.5 px-1.5 flex flex-col gap-0.5">
                {SUPPORTED_TRANSLATE_LANGUAGES.map(lang => {
                  const active = translateLanguage === lang.code;
                  return (
                    <button
                      key={lang.code}
                      onClick={() => { setTranslateLanguage(lang.code); setOpenLangMenu(null); }}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all ${
                        active
                          ? 'gradient-primary-soft border border-primary/35 text-primary font-semibold'
                          : 'border border-transparent text-foreground hover:bg-foreground/5'
                      }`}
                    >
                      <span className="text-base">{lang.flag}</span>
                      <span>{lang.label}</span>
                      {active && <span className="ml-auto text-primary text-xs">✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Administration section (admins only) */}
      {user.isAdmin && (
        <>
          <div>
            <p className="text-xs font-semibold text-primary/70 uppercase tracking-wider px-1 mb-2">{t.settings.administration}</p>
            <div className="glass rounded-2xl overflow-hidden">
              <button
                onClick={() => setShowAdmin(true)}
                className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-primary/10 transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0">
                  <Shield className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-primary">{t.settings.adminPanel}</p>
                  <p className="text-xs text-muted-foreground">{t.settings.adminPanelDesc}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
          </div>

          {/* Admin bottom sheet — portal to escape sidebar stacking context */}
          {createPortal(
            <AnimatePresence>
              {showAdmin && (
                <>
                  <motion.div
                    key="admin-backdrop"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
                    onClick={() => setShowAdmin(false)}
                  />
                  <motion.div
                    key="admin-sheet"
                    initial={{ y: '100%', opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: '100%', opacity: 0 }}
                    transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                    className="fixed inset-x-0 bottom-0 z-50 sm:inset-0 sm:flex sm:items-center sm:justify-center sm:p-4"
                    onClick={() => setShowAdmin(false)}
                  >
                    <div
                      className="glass-strong rounded-t-3xl sm:rounded-3xl flex flex-col overflow-hidden w-full sm:max-w-2xl"
                      style={{ maxHeight: '92dvh' }}
                      onClick={e => e.stopPropagation()}
                    >
                      <div className="flex justify-center pt-3 pb-1 flex-shrink-0 sm:hidden">
                        <div className="w-10 h-1 rounded-full bg-foreground/20" />
                      </div>
                      <div className="flex items-center justify-between px-5 py-3 gradient-hairline-bottom flex-shrink-0">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-xl gradient-primary glow-primary-sm flex items-center justify-center">
                            <Shield className="w-4 h-4 text-white" />
                          </div>
                          <div>
                            <p className="font-bold text-sm">{t.settings.adminPanel}</p>
                            <p className="text-xs text-muted-foreground">The Legends Online</p>
                          </div>
                        </div>
                        <button
                          onClick={() => setShowAdmin(false)}
                          className="w-8 h-8 rounded-xl bg-foreground/10 hover:bg-foreground/15 flex items-center justify-center transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex-1 overflow-y-auto p-4">
                        <AdminPanel />
                      </div>
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>,
            document.body
          )}
        </>
      )}

      {/* Application section — PWA install */}
      <div>
        <p className="text-xs font-semibold text-primary/70 uppercase tracking-wider px-1 mb-2">{t.settings.application}</p>
        <div className="glass rounded-2xl overflow-hidden">
          {isStandalone ? (
            <div className="flex items-center gap-3 px-4 py-3.5">
              <div className="w-8 h-8 rounded-xl bg-green-500/15 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-4 h-4 text-green-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-green-400">{t.settings.appInstalled}</p>
                <p className="text-xs text-muted-foreground">{t.settings.appInstalledDesc}</p>
              </div>
            </div>
          ) : (
            <button
              onClick={handleInstall}
              className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-primary/10 transition-colors text-left"
            >
              <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0">
                {isIos ? <Smartphone className="w-4 h-4 text-primary" /> : <Download className="w-4 h-4 text-primary" />}
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-primary">
                  {isIos ? t.settings.installAppIos : t.settings.installApp}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isIos ? t.settings.installAppIosDesc : (canInstall ? t.settings.installAppDesc : t.settings.installAppDesc)}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {/* Notifications section */}
      {pushSupported && (
        <div>
          <p className="text-xs font-semibold text-primary/70 uppercase tracking-wider px-1 mb-2">{t.settings.notifications}</p>
          <div className="glass rounded-2xl overflow-hidden">
            <button
              onClick={pushSubscribed ? disablePush : enablePush}
              disabled={pushLoading || pushPermission === 'denied'}
              className={`w-full flex items-center gap-3 px-4 py-3.5 transition-colors text-left disabled:opacity-50 ${pushSubscribed ? 'hover:bg-red-500/10' : 'hover:bg-primary/10'}`}
            >
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${pushSubscribed ? 'bg-green-500/15' : 'bg-primary/15'}`}>
                {pushLoading ? (
                  <div className="w-4 h-4 border-2 border-primary/50 border-t-primary rounded-full animate-spin" />
                ) : pushSubscribed ? (
                  <Bell className="w-4 h-4 text-green-400" />
                ) : (
                  <BellOff className="w-4 h-4 text-primary" />
                )}
              </div>
              <div className="flex-1">
                {pushPermission === 'denied' ? (
                  <>
                    <p className="text-sm font-medium text-red-400">{t.settings.notifBlocked}</p>
                    <p className="text-xs text-muted-foreground">{t.settings.notifBlockedDesc}</p>
                  </>
                ) : pushSubscribed ? (
                  <>
                    <p className="text-sm font-medium text-green-400">{t.settings.notifEnabled}</p>
                    <p className="text-xs text-muted-foreground">{t.settings.notifEnabledDesc}</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-primary">{t.settings.notifEnable}</p>
                    <p className="text-xs text-muted-foreground">{t.settings.notifEnableDesc}</p>
                  </>
                )}
              </div>
              {!pushLoading && pushPermission !== 'denied' && (
                <div className={`w-10 h-6 rounded-full transition-colors flex-shrink-0 ${pushSubscribed ? 'bg-green-500' : 'bg-foreground/15'}`}>
                  <div className={`w-5 h-5 bg-white rounded-full shadow m-0.5 transition-transform ${pushSubscribed ? 'translate-x-4' : 'translate-x-0'}`} />
                </div>
              )}
            </button>
          </div>
        </div>
      )}

      {/* iOS install instructions modal */}
      <AnimatePresence>
        {showIosInstructions && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
              onClick={() => setShowIosInstructions(false)}
            />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed inset-x-0 bottom-0 z-50"
            >
              <div className="glass-strong rounded-t-3xl p-6 pb-10">
                <div className="flex justify-center mb-4">
                  <div className="w-10 h-1 rounded-full bg-foreground/20" />
                </div>
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl gradient-primary glow-primary-sm flex items-center justify-center">
                      <Smartphone className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="font-bold text-sm">Installer sur iOS</p>
                      <p className="text-xs text-muted-foreground">The Legends Online</p>
                    </div>
                  </div>
                  <button onClick={() => setShowIosInstructions(false)}
                    className="w-8 h-8 rounded-xl bg-foreground/10 hover:bg-foreground/15 flex items-center justify-center">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex flex-col gap-4">
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full gradient-primary glow-primary-sm flex items-center justify-center flex-shrink-0 text-white text-sm font-bold">1</div>
                    <div>
                      <p className="text-sm font-medium">Ouvre Safari</p>
                      <p className="text-xs text-muted-foreground">L'installation nécessite le navigateur Safari d'Apple</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full gradient-primary glow-primary-sm flex items-center justify-center flex-shrink-0 text-white text-sm font-bold">2</div>
                    <div className="flex-1">
                      <p className="text-sm font-medium flex items-center gap-1.5">Appuie sur <Share className="w-4 h-4 text-primary inline" /> Partager</p>
                      <p className="text-xs text-muted-foreground">En bas de l'écran dans la barre Safari</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full gradient-primary glow-primary-sm flex items-center justify-center flex-shrink-0 text-white text-sm font-bold">3</div>
                    <div>
                      <p className="text-sm font-medium">« Sur l'écran d'accueil »</p>
                      <p className="text-xs text-muted-foreground">Fais défiler et sélectionne cette option, puis confirme</p>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Android install instructions modal */}
      <AnimatePresence>
        {showAndroidInstructions && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
              onClick={() => setShowAndroidInstructions(false)}
            />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed inset-x-0 bottom-0 z-50"
            >
              <div className="glass-strong rounded-t-3xl p-6 pb-10">
                <div className="flex justify-center mb-4">
                  <div className="w-10 h-1 rounded-full bg-foreground/20" />
                </div>
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl gradient-primary glow-primary-sm flex items-center justify-center">
                      <Download className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="font-bold text-sm">Installer sur Android</p>
                      <p className="text-xs text-muted-foreground">The Legends Online</p>
                    </div>
                  </div>
                  <button onClick={() => setShowAndroidInstructions(false)}
                    className="w-8 h-8 rounded-xl bg-foreground/10 hover:bg-foreground/15 flex items-center justify-center">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex flex-col gap-4">
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full gradient-primary glow-primary-sm flex items-center justify-center flex-shrink-0 text-white text-sm font-bold">1</div>
                    <div>
                      <p className="text-sm font-medium">Ouvre Chrome ou ton navigateur</p>
                      <p className="text-xs text-muted-foreground">Assure-toi d'utiliser Chrome pour Android</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full gradient-primary glow-primary-sm flex items-center justify-center flex-shrink-0 text-white text-sm font-bold">2</div>
                    <div>
                      <p className="text-sm font-medium">Menu ⋮ → « Ajouter à l'écran d'accueil »</p>
                      <p className="text-xs text-muted-foreground">Les trois points en haut à droite du navigateur</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full gradient-primary glow-primary-sm flex items-center justify-center flex-shrink-0 text-white text-sm font-bold">3</div>
                    <div>
                      <p className="text-sm font-medium">Confirme l'installation</p>
                      <p className="text-xs text-muted-foreground">Appuie sur "Installer" dans la fenêtre qui apparaît</p>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Logout */}
      <div className="glass rounded-2xl overflow-hidden">
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-red-500/10 transition-colors text-red-400 text-left"
        >
          <LogOut className="w-5 h-5" />
          <span className="font-medium">{t.settings.logout}</span>
        </button>
      </div>
    </div>
    </div>
  );
}
