import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User } from '@workspace/api-client-react';
import { useGetMe, useLogin, useRegister, useLogout } from '@workspace/api-client-react';
import { useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  login: ReturnType<typeof useLogin>['mutateAsync'];
  register: ReturnType<typeof useRegister>['mutateAsync'];
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const { data: user, isLoading, refetch } = useGetMe({
    query: {
      retry: false,
      enabled: !!localStorage.getItem('telechat_token')
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
      refetch();
      setLocation('/login');
    }
  };

  useEffect(() => {
    if (!isLoading && !user && window.location.pathname !== '/login' && window.location.pathname !== '/register') {
      setLocation('/login');
    }
  }, [user, isLoading, setLocation]);

  return (
    <AuthContext.Provider
      value={{
        user: user || null,
        isLoading,
        login: loginMutation.mutateAsync,
        register: registerMutation.mutateAsync,
        logout: handleLogout,
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
