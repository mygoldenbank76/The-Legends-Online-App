import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { AppLang, TranslateLang } from './i18n';
import { i18n } from './i18n';

export type Theme = 'dark' | 'light';

interface PreferencesContextType {
  appLanguage: AppLang;
  setAppLanguage: (lang: AppLang) => void;
  translateLanguage: TranslateLang;
  setTranslateLanguage: (lang: TranslateLang) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  effectsEnabled: boolean;
  setEffectsEnabled: (enabled: boolean) => void;
  t: (typeof i18n)['fr'];
}

const PreferencesContext = createContext<PreferencesContextType | undefined>(undefined);

const THEME_KEY = 'telechat_theme';
const EFFECTS_KEY = 'telechat_effects';

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const stored = window.localStorage.getItem(THEME_KEY);
  return stored === 'light' ? 'light' : 'dark';
}

function readStoredEffects(): boolean {
  if (typeof window === 'undefined') return true;
  const stored = window.localStorage.getItem(EFFECTS_KEY);
  return stored === null ? true : stored === '1';
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [appLanguage, setAppLanguageState] = useState<AppLang>(() => {
    return (localStorage.getItem('telechat_app_lang') as AppLang) ?? 'fr';
  });

  const [translateLanguage, setTranslateLanguageState] = useState<TranslateLang>(() => {
    return (localStorage.getItem('telechat_translate_lang') as TranslateLang) ?? 'fr';
  });

  const [theme, setThemeState] = useState<Theme>(readStoredTheme);
  const [effectsEnabled, setEffectsEnabledState] = useState<boolean>(readStoredEffects);

  // Apply theme to <html> (also kept in sync at boot by main.tsx to avoid flash)
  useEffect(() => {
    const html = document.documentElement;
    html.dataset.theme = theme;
    html.classList.toggle('dark', theme === 'dark');
  }, [theme]);

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
