import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import Register from "@/pages/register";
import Home from "@/pages/home";
import JoinGroup from "@/pages/join";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { SocketProvider } from "@/lib/socket-context";
import { CallProvider } from "@/lib/call-context";
import { CallModal } from "@/components/chat/call-modal";
import { PreferencesProvider } from "@/lib/preferences-context";
import { ShieldOff, LogOut } from "lucide-react";
import { createIDBPersister } from "@/lib/idb-persister";
import { BackgroundLoader } from "@/components/background-loader";
import { RestoringProvider, useRestoringState } from "@/lib/restoring-context";

// ── Query client ──────────────────────────────────────────────────────────────
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Socket handles all real-time updates — no HTTP refetch needed due to staleness
      staleTime: Infinity,
      // Keep all query data in memory for 24h (IDB handles longer-term persistence)
      gcTime: 1000 * 60 * 60 * 24,
      retry: 1,
      refetchOnWindowFocus: false,
      // On reconnect, refetch conversation list so we get any missed data
      refetchOnReconnect: 'always',
    },
  },
});

// ── IndexedDB persister — survives full app close/reopen ─────────────────────
const idbPersister = createIDBPersister(
  1000 * 60 * 60 * 24 * 7 // 7 days
);

// ── Persist options ───────────────────────────────────────────────────────────
const persistOptions = {
  persister: idbPersister,
  // Bump this string to force-invalidate all cached data (e.g. after schema changes)
  buster: 'legends-v1',
  dehydrateOptions: {
    // Exclude auth query — user identity must always be freshly verified from server
    shouldDehydrateQuery: (query: { queryKey: readonly unknown[] }) => {
      return !query.queryKey.includes('/api/auth/me');
    },
  },
};

// ── Screens ───────────────────────────────────────────────────────────────────
function BannedScreen() {
  const { logout } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm text-center flex flex-col items-center gap-6">
        <div className="w-20 h-20 rounded-full bg-red-500/15 flex items-center justify-center">
          <ShieldOff className="w-10 h-10 text-red-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-red-400 mb-2">Compte suspendu</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Ton compte a été temporairement suspendu par un administrateur.
            Tu ne peux pas accéder à la plateforme pour le moment.
          </p>
        </div>
        <button
          onClick={logout}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-white/10 hover:bg-white/15 transition-colors text-sm font-medium"
        >
          <LogOut className="w-4 h-4" />
          Se déconnecter
        </button>
      </div>
    </div>
  );
}

function BanGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  if (!isLoading && user && (user as any).isBanned) {
    return <BannedScreen />;
  }
  return <>{children}</>;
}

function AppRouter() {
  return (
    <BanGuard>
      <Switch>
        <Route path="/login" component={Login} />
        <Route path="/register" component={Register} />
        <Route path="/join/:id" component={JoinGroup} />
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </BanGuard>
  );
}

// ── Visual viewport fix (keyboard push-up on mobile) ─────────────────────────
function useVisualViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const root = document.getElementById('root');
      if (!root) return;
      root.style.height = `${vv.height}px`;
      root.style.top    = `${vv.offsetTop}px`;
    };

    const blockScroll = (e: Event) => {
      e.preventDefault();
      window.scrollTo(0, 0);
    };

    update();
    vv.addEventListener('resize',  update);
    vv.addEventListener('scroll',  update);
    window.addEventListener('scroll', blockScroll, { passive: false });

    return () => {
      vv.removeEventListener('resize',  update);
      vv.removeEventListener('scroll',  update);
      window.removeEventListener('scroll', blockScroll);
    };
  }, []);
}

// ── App ───────────────────────────────────────────────────────────────────────
function App() {
  useVisualViewport();
  // Track IndexedDB restoration state so auth can pause during it
  const { isRestoring, setIsRestoring } = useRestoringState();

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={persistOptions}
      onSuccess={() => setIsRestoring(false)}
    >
      <RestoringProvider isRestoring={isRestoring} setIsRestoring={setIsRestoring}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <PreferencesProvider>
              <AuthProvider>
                <SocketProvider>
                  <CallProvider>
                    {/* Invisible background data loader — preloads all convs + media silently */}
                    <BackgroundLoader />
                    <AppRouter />
                    {/* Full-screen call overlay — renders on top of everything */}
                    <CallModal />
                  </CallProvider>
                </SocketProvider>
              </AuthProvider>
            </PreferencesProvider>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </RestoringProvider>
    </PersistQueryClientProvider>
  );
}

export default App;
