import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChatArea } from '@/components/chat/chat-area';
import { ConversationList } from '@/components/chat/conversation-list';
import { useAuth } from '@/lib/auth-context';
import { useIsMobile } from '@/hooks/use-mobile';
import { AnimatedBackground } from '@/components/animated-background';
import { Users, MessageSquare, ShoppingBag, Settings, Zap, Menu, LogOut, Search } from 'lucide-react';

type Tab = 'groups' | 'messages' | 'shop' | 'settings';

const NAV_ITEMS: { id: Tab; icon: typeof Users; label: string }[] = [
  { id: 'groups',   icon: Users,         label: 'Groupes'    },
  { id: 'messages', icon: MessageSquare, label: 'Messages'   },
  { id: 'shop',     icon: ShoppingBag,   label: 'Shop'       },
  { id: 'settings', icon: Settings,      label: 'Paramètres' },
];

export default function Home() {
  const { user, logout } = useAuth();
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState<Tab>('groups');
  const [activeConvId, setActiveConvId] = useState<number | undefined>();

  if (!user) return null;

  const showList = !isMobile || !activeConvId;
  const showChat = !isMobile || !!activeConvId;

  const handleSelectConv = (id: number) => {
    setActiveConvId(id);
  };

  const handleBack = () => {
    setActiveConvId(undefined);
  };

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    if (isMobile) setActiveConvId(undefined);
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
              <div className="flex-1 min-h-0 overflow-hidden">
                <TabContent
                  tab={activeTab}
                  activeConvId={activeConvId}
                  onSelectConv={handleSelectConv}
                  isMobile
                  onLogout={logout}
                  user={user}
                />
              </div>
              <MobileBottomNav activeTab={activeTab} onSelect={handleTabChange} />
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
  return (
    <div className="flex-shrink-0 flex gap-1 px-3 py-2 border-b border-border/30">
      {NAV_ITEMS.map(({ id, icon: Icon, label }) => (
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
      ))}
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
  return (
    <nav className="flex-shrink-0 glass border-t border-border/50 flex items-stretch safe-area-bottom">
      {NAV_ITEMS.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          onClick={() => onSelect(id)}
          className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 transition-all ${
            activeTab === id ? 'text-primary' : 'text-muted-foreground'
          }`}
        >
          <Icon className="w-5 h-5" />
          <span className="text-[10px] font-medium">{label}</span>
        </button>
      ))}
    </nav>
  );
}

/* ── Tab content switcher ── */
function TabContent({
  tab, activeConvId, onSelectConv, isMobile, onLogout, user,
}: {
  tab: Tab;
  activeConvId?: number;
  onSelectConv: (id: number) => void;
  isMobile: boolean;
  onLogout: () => void;
  user: { id: number; displayName: string; username: string; avatar?: string | null };
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
    return <SettingsPage user={user} onLogout={onLogout} />;
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
  user, onLogout,
}: {
  user: { displayName: string; username: string; avatar?: string | null };
  onLogout: () => void;
}) {
  return (
    <div className="flex flex-col h-full p-4 gap-4">
      <div className="glass rounded-2xl p-4 flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-primary/20 flex items-center justify-center">
          <span className="text-2xl font-bold text-primary">{user.displayName.substring(0, 2).toUpperCase()}</span>
        </div>
        <div>
          <p className="font-bold text-base">{user.displayName}</p>
          <p className="text-sm text-muted-foreground">@{user.username}</p>
        </div>
      </div>

      <div className="glass rounded-2xl overflow-hidden">
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-red-500/10 transition-colors text-red-400 text-left"
        >
          <LogOut className="w-5 h-5" />
          <span className="font-medium">Se déconnecter</span>
        </button>
      </div>
    </div>
  );
}
