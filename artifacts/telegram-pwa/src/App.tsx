import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useEffect, lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
// ── Route components ──────────────────────────────────────────────────────────
// Home et Login sont importés en EAGER : ce sont les deux écrans d'entrée
// (un visiteur arrive forcément sur l'un ou l'autre selon son état d'auth).
// Les rendre lazy provoquait un spinner blanc visible 200-800 ms à chaque
// ouverture de l'app — perçu comme une régression d'interactivité par les
// utilisateurs. Le chunk Home (~840 KB) est de toute façon nécessaire pour
// l'usage principal de l'app, donc autant le mettre dans le bundle initial.
//
// Les pages secondaires (Register, Join, NotFound) restent en
// lazy car elles sont rarement visitées.
import Home from "@/pages/home";
import Login from "@/pages/login";
const NotFound = lazy(() => import("@/pages/not-found"));
const Register = lazy(() => import("@/pages/register"));
const JoinGroup = lazy(() => import("@/pages/join"));
const ProfilePublic = lazy(() => import("@/pages/profile-public"));
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { SocketProvider } from "@/lib/socket-context";
import { CallProvider } from "@/lib/call-context";
import { CallModalLazy as CallModal } from "@/components/chat/call-surface-lazy";
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

// Suspense fallback shown pendant le téléchargement du chunk de route.
// Volontairement minimaliste (pas de logo, pas de texte) : un spinner
// centré sur fond transparent qui se fond dans le splash screen du
// navigateur / la couleur de fond du <body>. Ne reste à l'écran que
// 50-300 ms sur 4G typique pour un chunk de route < 200 KB.
function RouteFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-white/60 animate-spin" />
    </div>
  );
}

function AppRouter() {
  return (
    <BanGuard>
      <Suspense fallback={<RouteFallback />}>
        <Switch>
          <Route path="/login" component={Login} />
          <Route path="/register" component={Register} />
          <Route path="/join/:id" component={JoinGroup} />
          <Route path="/u/:username" component={ProfilePublic} />
          <Route path="/" component={Home} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </BanGuard>
  );
}

// ── Visual viewport fix (keyboard push-up on mobile) ─────────────────────────
// Default behavior: #root tracks the visual viewport so the on-screen keyboard
// pushes content up (e.g. chat input bar stays above the keyboard).
//
// Some pages (like the contacts search) want the OPPOSITE — let the keyboard
// overlay the bottom of the layout so the bottom nav is naturally covered
// instead of being pushed up. Those pages call `setRootViewportMode('fullscreen')`
// while their input is focused, and revert to `'visual'` on blur.
type ViewportMode = 'visual' | 'fullscreen';
let _viewportMode: ViewportMode = 'visual';
let _viewportListeners: Array<() => void> = [];

export function setRootViewportMode(mode: ViewportMode) {
  if (_viewportMode === mode) return;
  _viewportMode = mode;
  _viewportListeners.forEach((fn) => fn());
}

function useVisualViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    // Track keyboard-open state via visual viewport height delta. When the
    // soft keyboard slides in, `vv.height` shrinks by ~250–400px. We toggle a
    // `keyboard-open` class on <body> so CSS (e.g. the composer pill glow)
    // can react to the *actual* keyboard state instead of relying on
    // `:focus-within`, which stays true after the keyboard is dismissed.
    const KEYBOARD_THRESHOLD_PX = 150;
    const updateKeyboardClass = () => {
      const delta = window.innerHeight - vv.height;
      const open = delta > KEYBOARD_THRESHOLD_PX;
      document.body.classList.toggle('keyboard-open', open);
    };

    const update = () => {
      updateKeyboardClass();
      // Expose the live visual-viewport height as a CSS variable so
      // overlays (emoji/GIF picker, etc.) can clamp their max-height
      // to the actually-visible area when the soft keyboard is open.
      // `100dvh` is unreliable on Samsung's Android WebView (it
      // ignores the keyboard's overlay), this CSS var is the only
      // reading that stays in sync with what the user can see.
      document.documentElement.style.setProperty('--vvh', `${vv.height}px`);
      const root = document.getElementById('root');
      if (!root) return;
      if (_viewportMode === 'fullscreen') {
        // Pin #root to the layout viewport so the keyboard overlays content
        // (covering the bottom nav) instead of shrinking the layout.
        root.style.height = '100%';
        root.style.top = '0px';
      } else {
        root.style.height = `${vv.height}px`;
        // NB: deliberately NOT mirroring `vv.offsetTop` here. On Samsung's
        // Android WebView, during the keyboard open/close animation
        // `visualViewport.offsetTop` briefly reports a non-zero value
        // (the layout viewport scrolling under the keyboard). If we copy
        // that into `#root.style.top`, the entire app shifts down for a
        // few frames mid-animation, which the user sees as the composer
        // jumping to the top of the screen with a huge black gap above
        // the keyboard. Keeping `top: 0` and relying on `height` alone
        // gives a smooth, single-step layout transition.
        root.style.top = '0px';
      }
    };

    const blockScroll = (e: Event) => {
      e.preventDefault();
      window.scrollTo(0, 0);
    };

    update();
    _viewportListeners.push(update);
    vv.addEventListener('resize',  update);
    vv.addEventListener('scroll',  update);
    window.addEventListener('scroll', blockScroll, { passive: false });

    return () => {
      _viewportListeners = _viewportListeners.filter((fn) => fn !== update);
      vv.removeEventListener('resize',  update);
      vv.removeEventListener('scroll',  update);
      window.removeEventListener('scroll', blockScroll);
      document.body.classList.remove('keyboard-open');
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
      onSuccess={() => {
        setIsRestoring(false);
        // Dev-only cold-start telemetry: measure how long the IDB cache
        // restore took from the first script execution. PersistQuery's
        // `onSuccess` fires once per provider mount, so we get exactly
        // one measurement per cold start. Logged as a console table so
        // it's easy to eyeball during local perf work without polluting
        // production builds (the whole block is dead-code-eliminated by
        // Vite when `import.meta.env.DEV === false`).
        if (import.meta.env.DEV) {
          try {
            performance.mark('idb-restore-end');
            const m = performance.measure(
              'idb-restore',
              'app-mount-start',
              'idb-restore-end',
            );
            // eslint-disable-next-line no-console
            console.info(`[perf] IDB restore complete in ${m.duration.toFixed(1)} ms`);
          } catch {
            /* perf marks are best-effort */
          }
        }
      }}
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
                    {/* Full-screen call overlay */}
                    <CallModal />
                    {/* The minimized call banner is rendered INLINE inside each page
                        (right below the header), not here. See <CallBanner /> usage
                        in home.tsx and chat-area.tsx. */}
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
