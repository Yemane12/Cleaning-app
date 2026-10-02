'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';
import {
  defaultLocale,
  isLocale,
  locales,
  preferredLocale,
  translate,
  type Locale,
  type MessageKey,
} from './locales';

interface I18n {
  locale: Locale;
  /** BCP 47 tag for Intl date and number formatting. */
  intlLocale: string;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
}

const STORAGE_KEY = 'locale';
const I18nContext = createContext<I18n | null>(null);

/**
 * The chosen language lives in localStorage, read as an external store: the
 * server renders the default, and the browser switches after hydration.
 */
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

/** The language chosen here before, else the one the phone or browser is set to. */
function savedLocale(): Locale {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode); the device's language will do.
  }
  if (isLocale(saved)) return saved;
  return preferredLocale(navigator.languages?.length ? navigator.languages : [navigator.language]);
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const locale = useSyncExternalStore(subscribe, savedLocale, () => defaultLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not remembered; nothing else to do.
    }
    listeners.forEach((listener) => listener());
  }, []);

  const value = useMemo<I18n>(() => {
    const { messages, intl } = locales[locale];
    return {
      locale,
      intlLocale: intl,
      setLocale,
      t: (key, values) => translate(messages, key, values),
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used inside <I18nProvider>');
  }
  return context;
}
