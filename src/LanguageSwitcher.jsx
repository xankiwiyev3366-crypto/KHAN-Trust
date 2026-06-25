import React, { useEffect, useRef, useState } from 'react';
import { Globe2 } from 'lucide-react';
import { useTranslation } from './i18n/I18nContext.jsx';

export default function LanguageSwitcher({ variant = 'desktop' }) {
  const { language, setLanguage, languages, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = languages.find((item) => item.code === language) || languages[0];

  return (
    <div className={`language-switcher ${variant}`} ref={rootRef}>
      <button
        type="button"
        className="language-switcher-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('languageSwitcher.label')}
      >
        <Globe2 size={16} />
        <span>{current.short}</span>
      </button>
      {open && (
        <ul className="language-switcher-menu" role="listbox">
          {languages.map((item) => (
            <li key={item.code}>
              <button
                type="button"
                role="option"
                aria-selected={item.code === language}
                className={item.code === language ? 'active' : ''}
                onClick={() => {
                  setLanguage(item.code);
                  setOpen(false);
                }}
              >
                <span className="language-switcher-short">{item.short}</span>
                <span className="language-switcher-name">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
