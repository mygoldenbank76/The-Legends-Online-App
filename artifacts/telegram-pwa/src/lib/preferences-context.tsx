import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { AppLang, TranslateLang } from './i18n';
import { i18n } from './i18n';

export type Theme = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

interface PreferencesContextType {
  appLanguage: AppLang;
  setAppLanguage: (lang: AppLang) => void;
  translateLanguage: TranslateLang;
  setTranslateLanguage: (lang: TranslateLang) => void;
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  effectsEnabled: boolean;
  setEffectsEnabled: (enabled: boolean) => void;
  t: (typeof i18n)['fr'];
}

const PreferencesContext = createContext<PreferencesContextType | undefined>(undefined);

const THEME_KEY = 'telechat_theme';
const EFFECTS_KEY = 'telechat_effects';

const THEME_COLOR_DARK = '#0e121c';
const THEME_COLOR_LIGHT = '#f9f9fc';

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'system';
}

function readStoredEffects(): boolean {
  if (typeof window === 'undefined') return true;
  const stored = window.localStorage.getItem(EFFECTS_KEY);
  return stored === null ? true : stored === '1';
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === 'system' ? getSystemTheme() : theme;
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [appLanguage, setAppLanguageState] = useState<AppLang>(() => {
    return (localStorage.getItem('telechat_app_lang') as AppLang) ?? 'fr';
  });

  const [translateLanguage, setTranslateLanguageState] = useState<TranslateLang>(() => {
    return (localStorage.getItem('telechat_translate_lang') as TranslateLang) ?? 'fr';
  });

  const [theme, setThemeState] = useState<Theme>(readStoredTheme);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);
  const [effectsEnabled, setEffectsEnabledState] = useState<boolean>(readStoredEffects);

  const resolvedTheme: ResolvedTheme = theme === 'system' ? systemTheme : theme;

  // Listen to OS-level color-scheme changes (live update when in 'system' mode)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? 'dark' : 'light');
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
    // Safari < 14 fallback
    mql.addListener(handler);
    return () => mql.removeListener(handler);
  }, []);

  // Apply resolved theme to <html> + sync the PWA theme-color meta tag
  useEffect(() => {
    const html = document.documentElement;
    html.dataset.theme = resolvedTheme;
    html.classList.toggle('dark', resolvedTheme === 'dark');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', resolvedTheme === 'dark' ? THEME_COLOR_DARK : THEME_COLOR_LIGHT);
    }
  }, [resolvedTheme]);

  const setAppLanguage = (lang: AppLang) => {
    setAppLanguageState(lang);
    localStorage.setItem('telechat_app_lang', lang);
  };

  const setTranslateLanguage = (lang: TranslateLang) => {
    setTranslateLanguageState(lang);
    localStorage.setItem('telechat_translate_lang', lang);
  };

  const setTheme = (next: Theme) => {
    setThemeState(next);
    localStorage.setItem(THEME_KEY, next);
  };

  const setEffectsEnabled = (enabled: boolean) => {
    setEffectsEnabledState(enabled);
    localStorage.setItem(EFFECTS_KEY, enabled ? '1' : '0');
  };

  return (
    <PreferencesContext.Provider
      value={{
        appLanguage,
        setAppLanguage,
        translateLanguage,
        setTranslateLanguage,
        theme,
        resolvedTheme,
        setTheme,
        effectsEnabled,
        setEffectsEnabled,
        t: i18n[appLanguage],
      }}
    >
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used within PreferencesProvider');
  return ctx;
}

export { resolveTheme };
