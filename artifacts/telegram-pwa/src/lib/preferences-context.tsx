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

  // Theme + visual effects are locked platform-wide (always dark, always on).
  const theme: Theme = 'dark';
  const resolvedTheme: ResolvedTheme = 'dark';
  const effectsEnabled = true;

  // Ensure <html> always reflects the locked dark theme + meta theme-color.
  useEffect(() => {
    const html = document.documentElement;
    html.dataset.theme = 'dark';
    html.classList.add('dark');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLOR_DARK);
  }, []);

  const setAppLanguage = (lang: AppLang) => {
    setAppLanguageState(lang);
    localStorage.setItem('telechat_app_lang', lang);
  };

  const setTranslateLanguage = (lang: TranslateLang) => {
    setTranslateLanguageState(lang);
    localStorage.setItem('telechat_translate_lang', lang);
  };

  // Theme & effects are locked — setters are kept for type compatibility but no-op.
  const setTheme = (_next: Theme) => {};
  const setEffectsEnabled = (_enabled: boolean) => {};

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
