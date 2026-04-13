import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { PreferencesProvider } from "@/lib/preferences-context";
import { ShieldOff, LogOut } from "lucide-react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Socket handles all real-time updates — no HTTP refetch needed due to staleness
      staleTime: Infinity,
      // Keep all query data in memory for 24h — fast reopening like Telegram/WhatsApp
      gcTime: 1000 * 60 * 60 * 24,
      retry: 1,
      // Don't refetch on focus — socket keeps everything live
      refetchOnWindowFocus: false,
    },
  },
});

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

function useVisualViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const root = document.getElementById('root');
      if (!root) return;
      // Clamp the root to exactly the visible area (shrinks when keyboard opens).
      // offsetTop > 0 when Android Chrome scrolls the layout viewport to reveal
      // the focused input — we compensate so #root tracks the visual viewport.
      root.style.height = `${vv.height}px`;
      root.style.top    = `${vv.offsetTop}px`;
    };

    // Hard-block any document-level scroll. All scrolling must happen inside
    // the message list container, never at the window/body level.
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

function App() {
  useVisualViewport();
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <PreferencesProvider>
            <AuthProvider>
              <SocketProvider>
                <AppRouter />
              </SocketProvider>
            </AuthProvider>
          </PreferencesProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
