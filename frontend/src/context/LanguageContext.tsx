'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import en from '@/i18n/messages/en.json';
import ms from '@/i18n/messages/ms.json';
import zh from '@/i18n/messages/zh.json';

export type Locale = 'en' | 'ms' | 'zh';

export const LOCALES: Locale[] = ['en', 'ms', 'zh'];

const MESSAGES: Record<Locale, unknown> = { en, ms, zh };
const STORAGE_KEY = 'lang';

type Vars = Record<string, string | number>;

type LanguageContextValue = {
  lang: Locale;
  setLang: (lang: Locale) => void;
  t: (key: string, vars?: Vars) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

// Walk a dot-path ("myShop.heading") into a nested messages object.
function lookup(obj: unknown, key: string): string | undefined {
  const value = key.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
  return typeof value === 'string' ? value : undefined;
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  );
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Locale>('en');

  // Load saved choice on mount (client only).
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LOCALES.includes(saved as Locale)) {
      setLangState(saved as Locale);
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Locale) => {
    setLangState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const t = useCallback(
    (key: string, vars?: Vars) => {
      // Prefer the active language; fall back to English if the key is empty
      // or missing (so an untranslated string shows English, never blank);
      // final fallback is the key itself.
      const active = lookup(MESSAGES[lang], key);
      if (active) return interpolate(active, vars);
      const fallback = lookup(MESSAGES.en, key);
      if (fallback) return interpolate(fallback, vars);
      return key;
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useI18n must be used within a LanguageProvider');
  }
  return ctx;
}
