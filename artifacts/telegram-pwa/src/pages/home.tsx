import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChatArea } from '@/components/chat/chat-area';
import { ConversationList } from '@/components/chat/conversation-list';
import { useAuth } from '@/lib/auth-context';
import { useIsMobile } from '@/hooks/use-mobile';
import { AnimatedBackground } from '@/components/animated-background';
import { Users, MessageSquare, ShoppingBag, Settings, Zap, LogOut, Globe, Languages, ChevronDown, Shield, X, ChevronRight, Pencil, Download, Smartphone, CheckCircle2, Share, Bell, BellOff } from 'lucide-react';
import { AdminPanel } from '@/components/admin/admin-panel';
import { ProfileEditorSheet } from '@/components/profile/profile-editor-sheet';
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

type Tab = 'groups' | 'messages' | 'shop' | 'settings';

const NAV_ICONS: Record<Tab, typeof Users> = {
  groups: Users,
  messages: MessageSquare,
  shop: ShoppingBag,
  settings: Settings,
};

const TAB_ORDER: Tab[] = ['groups', 'messages', 'shop', 'settings'];

export default function Home() {
  const { user, logout, refetchUser } = useAuth();
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState<Tab>('groups');
  const [activeConvId, setActiveConvId] = useState<number | undefined>();
  const [swipeDir, setSwipeDir] = useState<1 | -1>(1);

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

  const handleSelectConv = (id: number) => { setActiveConvId(id); };
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
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background text-foreground relative">
      <AnimatedBackground />

      {/* ── Desktop sidebar ── */}
      {!isMobile && (
        <aside className="relative z-10 w-[340px] min-w-[340px] h-full flex flex-col border-r border-border/50">
          <DesktopHeader user={user} onLogout={logout} />
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

              <MobileBottomNav activeTab={activeTab} onSelect={(t) => {
                const cur = TAB_ORDER.indexOf(activeTab);
                const nxt = TAB_ORDER.indexOf(t);
                setSwipeDir(nxt >= cur ? 1 : -1);
                handleTabChange(t);
              }} />
            </div>
          )}
          {showChat && activeConvId && (
            <ChatArea conversationId={activeConvId} onBack={handleBack} />
          )}
        </div>
      ) : (
        /* Desktop: chat panel */
        <div className="relative z-10 flex-1 h-full min-w-0 flex flex-col">
          {activeConvId ? (
            <ChatArea conversationId={activeConvId} onBack={undefined} />
          ) : (
            <div className="flex h-full items-center justify-center flex-col gap-4 text-muted-foreground">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Zap className="w-8 h-8 text-primary" />
              </div>
              <p className="text-base font-medium">Sélectionne une conversation</p>
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
    <div className="flex-shrink-0 h-14 flex items-center justify-between px-4 border-b border-border/50 glass">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl bg-primary/20 flex items-center justify-center">
          <Zap className="w-4 h-4 text-primary" />
        </div>
        <span className="font-bold text-base text-primary">The Legends Online</span>
      </div>
      <button onClick={onLogout} className="text-muted-foreground hover:text-foreground transition-colors p-1">
        <LogOut className="w-5 h-5" />
      </button>
    </div>
  );
}

/* ── Desktop tab pills ── */
function DesktopTabs({ activeTab, onSelect }: { activeTab: Tab; onSelect: (t: Tab) => void }) {
  const { t } = usePreferences();
  const tabs: Tab[] = ['groups', 'messages', 'shop', 'settings'];
  return (
    <div className="flex-shrink-0 flex gap-1 px-3 py-2 border-b border-border/30">
      {tabs.map((id) => {
        const Icon = NAV_ICONS[id];
        const label = t.tabs[id];
        return (
          <button
            key={id}
            onClick={() => onSelect(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === id
                ? 'bg-primary/15 text-primary border border-primary/20'
                : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Mobile header ── */
function MobileHeader({ user }: { user: { displayName: string } }) {
  return (
    <div className="flex-shrink-0 h-14 flex items-center justify-between px-4 border-b border-border/50 glass">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl bg-primary/20 flex items-center justify-center">
          <Zap className="w-4 h-4 text-primary" />
        </div>
        <span className="font-bold text-base text-primary">The Legends Online</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center">
          <span className="text-xs font-bold text-primary">{user.displayName.substring(0, 2).toUpperCase()}</span>
        </div>
      </div>
    </div>
  );
}

/* ── Mobile bottom nav ── */
function MobileBottomNav({ activeTab, onSelect }: { activeTab: Tab; onSelect: (t: Tab) => void }) {
  const { t } = usePreferences();
  const tabs: Tab[] = ['groups', 'messages', 'shop', 'settings'];
  return (
    <nav className="flex-shrink-0 glass border-t border-border/50 flex items-stretch safe-area-bottom">
      {tabs.map((id) => {
        const Icon = NAV_ICONS[id];
        return (
          <button
            key={id}
            onClick={() => onSelect(id)}
            className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 transition-all ${
              activeTab === id ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            <Icon className="w-5 h-5" />
            <span className="text-[10px] font-medium">{t.tabs[id]}</span>
          </button>
        );
      })}
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
  if (tab === 'shop') {
    return <ShopPlaceholder />;
  }
  if (tab === 'settings') {
    return <SettingsPage user={user} onLogout={onLogout} onRefetchUser={onRefetchUser} />;
  }
  return null;
}

/* ── Shop — iframe via proxy serveur (évite X-Frame-Options) ── */
function ShopPlaceholder() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const SHOP_URL = 'https://www.goldenvibeofficiel.com';
  const PROXY_URL = '/api/shop-proxy?path=/';

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Barre supérieure */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 glass border-b border-border/40">
        <div className="flex items-center gap-2">
          <ShoppingBag className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-primary">Golden Vibe</span>
        </div>
        <a
          href={SHOP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors px-2 py-1 rounded-lg hover:bg-white/5"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          Ouvrir
        </a>
      </div>

      {/* Zone iframe */}
      <div className="relative flex-1 min-h-0 w-full overflow-hidden">
        {/* Spinner de chargement */}
        {loading && !error && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <ShoppingBag className="w-6 h-6 text-primary animate-pulse" />
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              <span className="text-xs text-muted-foreground mt-1">Chargement du shop…</span>
            </div>
          </div>
        )}

        {/* Message d'erreur si l'iframe est bloqué */}
        {error && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 p-8 text-center bg-background">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <ShoppingBag className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h3 className="font-bold text-base mb-1">Golden Vibe Shop</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Le shop ne peut pas s'afficher ici directement.
              </p>
              <a
                href={SHOP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                Visiter le shop
              </a>
            </div>
          </div>
        )}

        {/* Iframe via proxy — contourne X-Frame-Options */}
        {!error && (
          <iframe
            src={PROXY_URL}
            title="Golden Vibe Shop"
            className="w-full h-full border-0"
            style={{ display: loading ? 'none' : 'block' }}
            onLoad={() => setLoading(false)}
            onError={() => { setLoading(false); setError(true); }}
            allow="fullscreen"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation-by-user-activation"
          />
        )}
      </div>
    </div>
  );
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
  const [showProfileEditor, setShowProfileEditor] = useState(false);
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
    <div className="flex flex-col h-full overflow-y-auto p-4 gap-4">
      {/* Profile card — clickable to edit */}
      <button
        onClick={() => setShowProfileEditor(true)}
        className="glass rounded-2xl p-4 flex items-center gap-4 w-full text-left hover:bg-white/5 transition-colors group"
      >
        <div className="relative flex-shrink-0">
          <div className="w-16 h-16 rounded-2xl bg-primary/20 overflow-hidden flex items-center justify-center">
            {user.avatar ? (
              <img src={user.avatar} alt="avatar" className="w-full h-full object-cover" />
            ) : (
              <span className="text-2xl font-bold text-primary">{user.displayName.substring(0, 2).toUpperCase()}</span>
            )}
          </div>
          <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-primary flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <Pencil className="w-2.5 h-2.5 text-white" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-base leading-tight">{user.displayName}</p>
          <p className="text-sm text-muted-foreground">@{user.username}</p>
          {user.bio && (
            <p className="text-xs text-muted-foreground/70 mt-1 truncate">{user.bio}</p>
          )}
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      </button>

      {/* Profile editor sheet */}
      {showProfileEditor && (
        <ProfileEditorSheet
          user={user}
          onClose={() => setShowProfileEditor(false)}
          onSaved={() => { onRefetchUser(); setShowProfileEditor(false); }}
        />
      )}

      {/* Preferences section */}
      <div>
        <p className="text-xs font-semibold text-primary/70 uppercase tracking-wider px-1 mb-2">{t.settings.preferences}</p>
        <div className="glass rounded-2xl overflow-hidden divide-y divide-white/5">

          {/* App language */}
          <div className="relative">
            <button
              onClick={() => setOpenLangMenu(openLangMenu === 'app' ? null : 'app')}
              className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/5 transition-colors text-left"
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
              <div className="glass-strong border-t border-white/5 py-1">
                {SUPPORTED_APP_LANGUAGES.map(lang => (
                  <button
                    key={lang.code}
                    onClick={() => { setAppLanguage(lang.code); setOpenLangMenu(null); }}
                    className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors hover:bg-white/5 ${appLanguage === lang.code ? 'text-primary font-semibold' : 'text-foreground'}`}
                  >
                    <span className="text-base">{lang.flag}</span>
                    <span>{lang.label}</span>
                    {appLanguage === lang.code && <span className="ml-auto text-primary text-xs">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Translation language */}
          <div className="relative">
            <button
              onClick={() => setOpenLangMenu(openLangMenu === 'translate' ? null : 'translate')}
              className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/5 transition-colors text-left"
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
              <div className="glass-strong border-t border-white/5 py-1">
                {SUPPORTED_TRANSLATE_LANGUAGES.map(lang => (
                  <button
                    key={lang.code}
                    onClick={() => { setTranslateLanguage(lang.code); setOpenLangMenu(null); }}
                    className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors hover:bg-white/5 ${translateLanguage === lang.code ? 'text-primary font-semibold' : 'text-foreground'}`}
                  >
                    <span className="text-base">{lang.flag}</span>
                    <span>{lang.label}</span>
                    {translateLanguage === lang.code && <span className="ml-auto text-primary text-xs">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Notifications section */}
      {pushSupported && (
        <div>
          <p className="text-xs font-semibold text-primary/70 uppercase tracking-wider px-1 mb-2">Notifications</p>
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
                    <p className="text-sm font-medium text-red-400">Notifications bloquées</p>
                    <p className="text-xs text-muted-foreground">Autorise-les dans les réglages du navigateur</p>
                  </>
                ) : pushSubscribed ? (
                  <>
                    <p className="text-sm font-medium text-green-400">Notifications activées</p>
                    <p className="text-xs text-muted-foreground">Appuie pour désactiver</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-primary">Activer les notifications</p>
                    <p className="text-xs text-muted-foreground">Reçois une alerte pour chaque nouveau message</p>
                  </>
                )}
              </div>
              {!pushLoading && pushPermission !== 'denied' && (
                <div className={`w-10 h-6 rounded-full transition-colors flex-shrink-0 ${pushSubscribed ? 'bg-green-500' : 'bg-white/10'}`}>
                  <div className={`w-5 h-5 bg-white rounded-full shadow m-0.5 transition-transform ${pushSubscribed ? 'translate-x-4' : 'translate-x-0'}`} />
                </div>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Administration section (admins only) */}
      {user.isAdmin && (
        <>
          <div>
            <p className="text-xs font-semibold text-primary/70 uppercase tracking-wider px-1 mb-2">Administration</p>
            <div className="glass rounded-2xl overflow-hidden">
              <button
                onClick={() => setShowAdmin(true)}
                className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-primary/10 transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0">
                  <Shield className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-primary">Panel Administrateur</p>
                  <p className="text-xs text-muted-foreground">Gérer les utilisateurs et surveiller</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
          </div>

          {/* Admin bottom sheet */}
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
                  initial={{ y: '100%' }}
                  animate={{ y: 0 }}
                  exit={{ y: '100%' }}
                  transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                  className="fixed inset-x-0 bottom-0 z-50 flex flex-col"
                  style={{ maxHeight: '92vh' }}
                >
                  <div className="glass-strong rounded-t-3xl flex flex-col overflow-hidden" style={{ maxHeight: '92vh' }}>
                    <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
                      <div className="w-10 h-1 rounded-full bg-white/20" />
                    </div>
                    <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 flex-shrink-0">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl bg-primary/20 flex items-center justify-center">
                          <Shield className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                          <p className="font-bold text-sm">Panel Administrateur</p>
                          <p className="text-xs text-muted-foreground">The Legends Online</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setShowAdmin(false)}
                        className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/15 flex items-center justify-center transition-colors"
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
          </AnimatePresence>
        </>
      )}

      {/* Application section — PWA install */}
      <div>
        <p className="text-xs font-semibold text-primary/70 uppercase tracking-wider px-1 mb-2">Application</p>
        <div className="glass rounded-2xl overflow-hidden">
          {isStandalone ? (
            <div className="flex items-center gap-3 px-4 py-3.5">
              <div className="w-8 h-8 rounded-xl bg-green-500/15 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-4 h-4 text-green-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-green-400">Application installée</p>
                <p className="text-xs text-muted-foreground">Vous utilisez déjà la version native</p>
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
                  {isIos ? 'Installer sur iPhone / iPad' : 'Télécharger l\'application'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isIos ? 'Ajouter à l\'écran d\'accueil via Safari' : (canInstall ? 'Installer en application native' : 'Ouvrir dans le navigateur pour installer')}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

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
                  <div className="w-10 h-1 rounded-full bg-white/20" />
                </div>
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-primary/20 flex items-center justify-center">
                      <Smartphone className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-bold text-sm">Installer sur iOS</p>
                      <p className="text-xs text-muted-foreground">The Legends Online</p>
                    </div>
                  </div>
                  <button onClick={() => setShowIosInstructions(false)}
                    className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/15 flex items-center justify-center">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex flex-col gap-4">
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0 text-white text-sm font-bold">1</div>
                    <div>
                      <p className="text-sm font-medium">Ouvre Safari</p>
                      <p className="text-xs text-muted-foreground">L'installation nécessite le navigateur Safari d'Apple</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0 text-white text-sm font-bold">2</div>
                    <div className="flex-1">
                      <p className="text-sm font-medium flex items-center gap-1.5">Appuie sur <Share className="w-4 h-4 text-primary inline" /> Partager</p>
                      <p className="text-xs text-muted-foreground">En bas de l'écran dans la barre Safari</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0 text-white text-sm font-bold">3</div>
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
                  <div className="w-10 h-1 rounded-full bg-white/20" />
                </div>
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-primary/20 flex items-center justify-center">
                      <Download className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-bold text-sm">Installer sur Android</p>
                      <p className="text-xs text-muted-foreground">The Legends Online</p>
                    </div>
                  </div>
                  <button onClick={() => setShowAndroidInstructions(false)}
                    className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/15 flex items-center justify-center">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex flex-col gap-4">
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0 text-white text-sm font-bold">1</div>
                    <div>
                      <p className="text-sm font-medium">Ouvre Chrome ou ton navigateur</p>
                      <p className="text-xs text-muted-foreground">Assure-toi d'utiliser Chrome pour Android</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0 text-white text-sm font-bold">2</div>
                    <div>
                      <p className="text-sm font-medium">Menu ⋮ → « Ajouter à l'écran d'accueil »</p>
                      <p className="text-xs text-muted-foreground">Les trois points en haut à droite du navigateur</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0 text-white text-sm font-bold">3</div>
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
  );
}
