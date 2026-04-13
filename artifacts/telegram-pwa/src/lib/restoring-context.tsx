/**
 * Tracks whether the IndexedDB query cache is still being restored.
 * Replaces the missing `useIsRestoring` from @tanstack/react-query-persist-client v5.97.
 *
 * Usage:
 *  - Wrap the app with <RestoringProvider onRestoringChange={fn} />
 *  - Call useIsRestoring() anywhere inside to know if IDB is still loading
 */
import { createContext, useContext, useEffect, useState } from 'react';

const RestoringContext = createContext<boolean>(true);

/** Returns true while IndexedDB is being restored into the React Query cache. */
export function useIsRestoring(): boolean {
  return useContext(RestoringContext);
}

interface RestoringProviderProps {
  children: React.ReactNode;
  /** Pass the setter so App.tsx can flip the flag via PersistQueryClientProvider's onSuccess */
  setIsRestoring: (v: boolean) => void;
  isRestoring: boolean;
}

export function RestoringProvider({ children, isRestoring }: RestoringProviderProps) {
  return (
    <RestoringContext.Provider value={isRestoring}>
      {children}
    </RestoringContext.Provider>
  );
}

/** Convenience hook to create the restoring state in the root component */
export function useRestoringState() {
  const [isRestoring, setIsRestoring] = useState(true);

  // Safety fallback: if onSuccess is never called (empty IDB, error, etc.),
  // unblock auth after 3s so the user isn't stuck on a blank screen.
  useEffect(() => {
    const id = setTimeout(() => setIsRestoring(false), 3000);
    return () => clearTimeout(id);
  }, []);

  return { isRestoring, setIsRestoring };
}
