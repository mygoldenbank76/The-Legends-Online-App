import { createContext, useContext, useState, ReactNode } from 'react';
import type { AppLang, TranslateLang } from './i18n';
import { i18n } from './i18n';

interface PreferencesContextType {
  appLanguage: AppLang;
  setAppLanguage: (lang: AppLang) => void;
  translateLanguage: TranslateLang;
  setTranslateLanguage: (lang: TranslateLang) => void;
  t: (typeof i18n)['fr'];
}

const PreferencesContext = createContext<PreferencesContextType | undefined>(undefined);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [appLanguage, setAppLanguageState] = useState<AppLang>(() => {
    return (localStorage.getItem('telechat_app_lang') as AppLang) ?? 'fr';
  });

  const [translateLanguage, setTranslateLanguageState] = useState<TranslateLang>(() => {
    return (localStorage.getItem('telechat_translate_lang') as TranslateLang) ?? 'fr';
  });

  const setAppLanguage = (lang: AppLang) => {
    setAppLanguageState(lang);
    localStorage.setItem('telechat_app_lang', lang);
  };

  const setTranslateLanguage = (lang: TranslateLang) => {
    setTranslateLanguageState(lang);
    localStorage.setItem('telechat_translate_lang', lang);
  };

  return (
    <PreferencesContext.Provider
      value={{ appLanguage, setAppLanguage, translateLanguage, setTranslateLanguage, t: i18n[appLanguage] }}
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
