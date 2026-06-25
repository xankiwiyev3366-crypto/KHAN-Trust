import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, getLanguage, setLanguage, subscribeLanguage, translate } from './index.js';

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [language, setLanguageState] = useState(getLanguage());

  useEffect(() => subscribeLanguage(setLanguageState), []);

  const changeLanguage = useCallback((next) => {
    setLanguage(next);
  }, []);

  const t = useCallback((key, params) => translate(key, params, language), [language]);

  const value = useMemo(
    () => ({ language, setLanguage: changeLanguage, t, languages: SUPPORTED_LANGUAGES, defaultLanguage: DEFAULT_LANGUAGE }),
    [language, changeLanguage, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useTranslation must be used inside I18nProvider');
  return context;
}
