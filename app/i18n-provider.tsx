'use client';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { LANG_COOKIE, locales, messages, type Lang, type Messages } from '@/lib/i18n';

type I18n = { lang: Lang; t: Messages; locale: string; setLang: (lang: Lang) => void };
const I18nContext = createContext<I18n | null>(null);

/** The server picks the first language, so the page is rendered in it without a flash. */
export function I18nProvider({ initialLang, children }: { initialLang: Lang; children: React.ReactNode }) {
  const [lang, setLangState] = useState(initialLang);
  const setLang = useCallback((next: Lang) => {
    // The cookie lets the server render pages and API messages in the chosen language.
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${LANG_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    document.documentElement.lang = next;
    document.title = messages[next].meta.title;
    setLangState(next);
  }, []);
  const value = useMemo(() => ({ lang, t: messages[lang], locale: locales[lang], setLang }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}
