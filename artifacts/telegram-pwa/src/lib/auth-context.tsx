import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User } from '@workspace/api-client-react';
import { useGetMe, useLogin, useRegister, useLogout, getGetMeQueryKey } from '@workspace/api-client-react';
import { useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';
import { saveTokenToIDB, removeTokenFromIDB } from './auth-idb';
import { useIsRestoring } from './restoring-context';
import { Capacitor, registerPlugin } from '@capacitor/core';

// Native bridge that mirrors the auth token into Android SharedPreferences
// so the inline "Répondre" RemoteInput on push notifications can POST
// to /api without booting the WebView. The plugin is registered in
// MainActivity.java and is a no-op on web/iOS (callProxy returns null).
interface AuthBridgePlugin {
  setToken(opts: { token: string | null; baseUrl?: string; userId?: number | null }): Promise<void>;
  clearToken(): Promise<void>;
}
const AuthBridge = registerPlugin<AuthBridgePlugin>('AuthBridge');

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  login: ReturnType<typeof useLogin>['mutateAsync'];
  register: ReturnType<typeof useRegister>['mutateAsync'];
  logout: () => void;
  refetchUser: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function extractTokenFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const authToken = params.get('auth_token');
  if (authToken) {
    params.delete('auth_token');
    const newSearch = params.toString();
    const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '') + window.location.hash;
    window.history.replaceState({}, '', newUrl);
    return authToken;
  }
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // True while IndexedDB is being restored into React Query cache.
  // During this window, queries are paused — we MUST NOT act on missing user data.
  const isRestoring = useIsRestoring();

  const [hasToken, setHasToken] = useState<boolean>(() => {
    const urlToken = extractTokenFromUrl();
    if (urlToken) {
      localStorage.setItem('telechat_token', urlToken);
      return true;
    }
    return !!localStorage.getItem('telechat_token');
  });

  const { data: user, isLoading, refetch } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      retry: false,
      // Don't run the query while IDB is restoring (it would return undefined briefly)
      enabled: hasToken && !isRestoring,
    }
  });

  const loginMutation = useLogin();
  const registerMutation = useRegister();
  const logoutMutation = useLogout();

  const handleLogout = async () => {
    try {
      await logoutMutation.mutateAsync(undefined);
    } catch (e) {
      // Ignore
    } finally {
      localStorage.removeItem('telechat_token');
      localStorage.removeItem('telechat-query-cache');
      setHasToken(false);
      setLocation('/login');
    }
  };

  // Sync token to IndexedDB so the service worker can access it for inline reply
  // AND mirror it into native SharedPreferences (Android only) so the
  // FcmMessagingService / NotificationReplyReceiver can authenticate the
  // user's inline-reply POST without ever booting the WebView.
  useEffect(() => {
    const token = localStorage.getItem('telechat_token');
    if (token) {
      saveTokenToIDB(token);
      if (Capacitor.isNativePlatform()) {
        const baseUrl = window.location.origin;
        AuthBridge.setToken({
          token,
          baseUrl,
          userId: user?.id ?? null,
        }).catch((e: unknown) => console.warn('[auth] AuthBridge.setToken failed', e));
      }
    } else {
      removeTokenFromIDB();
      if (Capacitor.isNativePlatform()) {
        AuthBridge.clearToken().catch(() => {});
      }
    }
  }, [hasToken, user?.id]);

  // Only clear token / redirect AFTER IDB restoration is complete
  useEffect(() => {
    if (isRestoring) return; // Wait — queries are still paused
    if (!isLoading && !user && hasToken) {
      localStorage.removeItem('telechat_token');
      setHasToken(false);
    }
  }, [user, isLoading, hasToken, isRestoring]);

  useEffect(() => {
    if (isRestoring) return; // Wait — don't redirect during restoration
    if (!isLoading && !user && !hasToken && window.location.pathname !== '/login' && window.location.pathname !== '/register') {
      setLocation('/login');
    }
  }, [user, isLoading, hasToken, isRestoring, setLocation]);

  return (
    <AuthContext.Provider
      value={{
        user: user || null,
        isLoading,
        login: loginMutation.mutateAsync,
        register: registerMutation.mutateAsync,
        logout: handleLogout,
        refetchUser: refetch,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
