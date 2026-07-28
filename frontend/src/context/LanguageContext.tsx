// In the Next.js App Router, every component is a Server Component 
// unless you write 'use client' at the top.
// 'use client' marks this whole module as a Client Component. It MUST be a
// client component because the translation system relies on browser-only
// features: React state/hooks, localStorage, and document.documentElement.
// Server components cannot use any of those.
'use client';

import {
  createContext, // creates the shared "channel" every component reads from
  useCallback,   // memoises functions so they aren't recreated every render
  useContext,    // reads the value out of the channel inside a component
  useEffect,     // runs side effects (localStorage, DOM) after render
  useMemo,       // memoises the context object so consumers don't re-render needlessly
  useState,      // holds the currently selected language in React state
} from 'react';

// The three translation dictionaries. Each is a plain JSON object of
// key -> text, e.g. { "header": { "login": "Login" } }. They are imported at
// build time and bundled into the app, so there is no network request to load
// translations — switching language is instant.
import en from '@/i18n/messages/en.json';
import ms from '@/i18n/messages/ms.json';
import zh from '@/i18n/messages/zh.json';

// tells the compiler what is allowed 
// data type
export type Locale = 'en' | 'ms' | 'zh';
// choice available
export const LOCALES: Locale[] = ['en', 'ms', 'zh'];

// Maps each language code to its dictionary object, so we can pick the right
// one with MESSAGES[lang]. Typed as `unknown` because the JSON shape is
// arbitrary/nested — `lookup()` below does the safe type-checking.
const MESSAGES: Record<Locale, unknown> = { en, ms, zh };

// later will put in localStorage key = lang , value ='zh'
const STORAGE_KEY = 'lang';

// Type for the optional variables passed to t(), used to fill placeholders
// like {count} or {name} in a message. Values can be strings or numbers.
type Vars = Record<string, string | number>;

// The shape of everything the context hands to consumers:
//   lang    - the currently active language code
//   setLang - function to change the language
//   t       - the translate function: give it a key, get back the text
type LanguageContextValue = {
  lang: Locale;
  setLang: (lang: Locale) => void;
  t: (key: string, vars?: Vars) => string;
};

// The actual React context object. Starts as null; a component that tries to
// read it without a provider wrapping it will get null
const LanguageContext = createContext<LanguageContextValue | null>(null);

/**
 * lookup — resolve a dotted key path into a nested messages object.
 *
 * @param obj - a whole dictionary (MESSAGES['en'], etc.)
 * @param key - a dotted path like "myShop.heading"
 * @returns the string found at that path, or undefined if the path is missing
 *          or the value there isn't a string (e.g. it's a nested object).
 */
function lookup(obj: unknown, key: string): string | undefined {
  // key.split('.') turns "myShop.heading" into array ["myShop", "heading"].
  // reduce starts one by one of the element in array looping
  const value = key.split('.').reduce<unknown>((acc, part) => {
    // Only descend if the current accumulator is a real object AND it actually
    // contains this part as a key. Otherwise the path is broken -> undefined.
    // (Once we return undefined, every later step stays undefined.)
    if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
  // Guard the final result: we only ever want to return an actual string.
  // If the path pointed at an object or was missing, hand back undefined so
  // the caller (t) can fall back to English.
  return typeof value === 'string' ? value : undefined;
}

/**
 * interpolate — substitute {placeholder} tokens in a message with real values.
 *
 * A message can contain tokens like "Published ({count})". Given
 * vars = { count: 5 } this produces "Published (5)".
 *
 * @param template - the raw message text, possibly containing {name} tokens
 * @param vars     - the values to inject; if omitted, the template is returned as-is
 * @returns the message with every known {name} replaced by its value
 */
function interpolate(template: string, vars?: Vars): string {
  // No variables supplied -> nothing to replace, return the text untouched.
  if (!vars) return template;
  // Find every {word} token. For each match, `name` is the word inside the braces. 
  // inside vars(object with multiple key)
  // Check if name inside teh library thn get the value by the key 
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  );
}

/**
 * LanguageProvider — the component that OWNS the language state and shares it.
 *
 * Wrap it around the app (done in app/layout.tsx) so every component inside can
 * call useI18n() to read `lang`, `setLang`, and `t`. Without this wrapper the
 * context is null and useI18n() throws.
 */
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // The single source of truth for the active language. Starts as 'en' so the
  // very first server render and the first client render 
  const [lang, setLangState] = useState<Locale>('en');

  // On first mount (client only), read any language the user picked on a
  // previous visit from localStorage and apply it. The empty [] dependency
  // array means this runs exactly once, after the component first appears.
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    // Only trust the saved value if it's actually one of our supported codes.
    if (saved && LOCALES.includes(saved as Locale)) {
      setLangState(saved as Locale);
    }
  }, []);

  // Keep the <html lang="..."> attribute in sync with the active language.
  // This helps screen readers and search engines know the page's language.
  // Re-runs whenever `lang` changes from setlang.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // setLang — the public way to change language. It does two things:
  //   1. Update React state so the UI re-renders in the new language.
  //   2. Persist the choice to localStorage so it survives reloads.
  // Wrapped in useCallback with [] so the same function identity is reused
  // across renders (prevents needless re-renders of consumers).
  const setLang = useCallback((next: Locale) => {
    setLangState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  // t — THE translate function every component uses. Give it a key (and
  // optional variables) and it returns the display text in the active language.
  const t = useCallback(
    (key: string, vars?: Vars) => {
      // Three-tier fallback so text is never blank:
      //   1. Look up the key in the ACTIVE language. If found, use it.
      const active = lookup(MESSAGES[lang], key);
      if (active) return interpolate(active, vars);
      //   2. Not translated yet (blank/missing)? Fall back to ENGLISH, so the
      //      user still sees readable text instead of an empty label.
      const fallback = lookup(MESSAGES.en, key);
      if (fallback) return interpolate(fallback, vars);
      //   3. Even English is missing the key -> return the key itself, which
      //      makes the untranslated spot obvious to developers.
      return key;
    },
    // Recreate t only when the language changes, so components using t()
    // re-render with the new language.
    [lang],
  );

  // Bundle the three values into one object for the context. useMemo keeps the
  // SAME object reference between renders unless lang/setLang/t actually change,
  // so consumers don't re-render just because the provider re-rendered.
  // keep the same object unless one of these three actually changed
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  // Publish `value` to every descendant. Anything inside <LanguageProvider>
  // can now read it with useI18n().
  // It returns a React elemen
  // It returns its children, plus an invisible instruction to React: 
  // "everyone below can now read value from LanguageContext."
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/**
 * useI18n — the hook components call to access translation.
 *
 * Usage:  const { t, lang, setLang } = useI18n();
 *
 * It reads the context and, if the component was rendered OUTSIDE a
 * LanguageProvider (so the context is still null), throws a clear error
 * instead of letting `ctx.t` crash with a confusing "cannot read property".
 */
export function useI18n(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useI18n must be used within a LanguageProvider');
  }
  return ctx;
}

/* ---------------------------------------------------------------------------
 * WHERE THIS IS USED 
 *
 * setLang — 1 place in the app. Only the header dropdown changes language:
 *   components/Header/Header.tsx:68
 *     onChange={(e) => setLang(e.target.value as Locale)}
 *   (also __tests__/contexts/LanguageContext.test.tsx:14)
 *
 * t — 4 files, ~130 calls:
 *   app/(user)/profile/my-ads/page.tsx         (87 calls — most translated page)
 *   app/(user)/profile/my-ads/import/page.tsx  (35 calls)
 *   components/Header/Header.tsx               ( 6 calls)
 *   app/(user)/sell/page.tsx                   ( 2 calls)
 * ------------------------------------------------------------------------- */
