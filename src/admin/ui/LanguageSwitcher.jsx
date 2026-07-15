// Console language switcher. English + Azerbaijani.
//
// Two languages means a segmented toggle rather than a dropdown: both options
// are visible, switching is one click, and there is no menu to open. A <select>
// would be the right call at four or more.
//
// Lives in the sidebar, below the nav, because it is set once and then ignored —
// it should be findable, not prominent.
import React from 'react';
import { Languages } from 'lucide-react';

import { LANGUAGES } from '../i18n/index.js';
import { useT } from '../i18n/ConsoleI18nProvider.jsx';

export function LanguageSwitcher() {
  const { lang, setLang, t } = useT();

  return (
    <div className="console-lang" role="group" aria-label={t('nav.language')}>
      <Languages size={14} aria-hidden="true" />
      {LANGUAGES.map((option) => (
        <button
          key={option.code}
          type="button"
          className={`console-lang-button${option.code === lang ? ' is-active' : ''}`}
          onClick={() => setLang(option.code)}
          // The full language name is the accessible label; the button face
          // shows the short code to keep the sidebar narrow.
          aria-label={option.name}
          aria-pressed={option.code === lang}
          lang={option.code}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
