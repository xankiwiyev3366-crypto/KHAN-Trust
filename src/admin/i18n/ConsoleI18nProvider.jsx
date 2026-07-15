// React binding for the console's i18n. The translation logic itself is in
// index.js (plain JS, so tests can import it without a build step).
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { translate, readStoredLang, persistLang, isKnownLang } from './index.js';

const I18nContext = createContext(null);

export function ConsoleI18nProvider({ children }) {
  const [lang, setLangState] = useState(readStoredLang);

  const setLang = useCallback((next) => {
    if (!isKnownLang(next)) return;
    persistLang(next);
    setLangState(next);
    // Keeps the document's language honest for screen readers and the browser's
    // own text handling.
    try {
      document.documentElement.lang = next;
    } catch {
      // Non-DOM environment; nothing to do.
    }
  }, []);

  const value = useMemo(() => ({
    lang,
    setLang,
    t: (path, vars) => translate(lang, path, vars),
  }), [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useT must be used inside <ConsoleI18nProvider>');
  return context;
}
