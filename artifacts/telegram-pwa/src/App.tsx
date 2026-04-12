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
      staleTime: 1000 * 30,  // 30s — show cached data instantly, refetch after 30s
      retry: 1,
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
      // Set height to the actual visible area (shrinks when keyboard opens)
      root.style.height = `${vv.height}px`;
    };

    update();
    vv.addEventListener('resize', update);
    return () => {
      vv.removeEventListener('resize', update);
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
