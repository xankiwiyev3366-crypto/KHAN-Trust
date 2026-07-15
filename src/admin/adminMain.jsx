// Entry point for the KHAN Growth OS console — a PRIVATE application.
//
// Nothing in this tree is reachable from src/main.jsx, so none of it is emitted
// into the bundle a visitor downloads. Served at /console (see netlify.toml),
// noindex'd, and gated behind the admin passcode.
//
// Deliberately absent, unlike the user app: no analytics tracking (the operator
// must never pollute the funnel they are measuring), no wallet adapters, no
// i18n (the console has exactly one operator and English-only keeps the bundle
// and the maintenance surface small).
import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity, ArrowRight, BrainCircuit, Filter, Lock, Rocket,
  Target, Users, Youtube, ListChecks, LogOut,
} from 'lucide-react';

import '../styles.css';
import './console.css';
import { adminLogin, clearAdminToken, getAdminToken } from './lib/adminSession.js';
import { FormField, SectionTitle } from './ui/primitives.jsx';
import { ErrorBoundary } from './ui/ErrorBoundary.jsx';
import { ConsoleI18nProvider, useT } from './i18n/ConsoleI18nProvider.jsx';
import { LanguageSwitcher } from './ui/LanguageSwitcher.jsx';
import OverviewPage from './pages/OverviewPage.jsx';
import FunnelPage from './pages/FunnelPage.jsx';
import RetentionPage from './pages/RetentionPage.jsx';
import AcquisitionPage from './pages/AcquisitionPage.jsx';
import ContentEnginePage from './pages/ContentEnginePage.jsx';
import InitiativesPage from './pages/InitiativesPage.jsx';

// One nav entry per module. `id` doubles as the hash route (#/funnel) and as
// the translation key (nav.funnel). Labels are resolved at render time, not
// here, so switching language re-translates the sidebar immediately instead of
// baking English in at module load.
const NAV = [
  { id: 'overview', icon: BrainCircuit, Component: OverviewPage },
  { id: 'funnel', icon: Filter, Component: FunnelPage },
  { id: 'retention', icon: Users, Component: RetentionPage },
  { id: 'acquisition', icon: Target, Component: AcquisitionPage },
  { id: 'content', icon: Youtube, Component: ContentEnginePage },
  { id: 'initiatives', icon: ListChecks, Component: InitiativesPage },
];

function LoginScreen({ onAuthenticated }) {
  const { t } = useT();
  const [passcode, setPasscode] = useState('');
  const [state, setState] = useState({ status: 'idle', message: '' });

  const submit = async (event) => {
    event.preventDefault();
    setState({ status: 'loading', message: '' });
    try {
      onAuthenticated(await adminLogin(passcode));
    } catch (error) {
      // Deliberately generic: this screen is reachable by anyone who guesses
      // the URL, so it must never distinguish "wrong passcode" from
      // "passcode not configured" or confirm that the console exists here.
      setState({ status: 'error', message: error.message || t('login.failed') });
    }
  };

  return (
    <div className="console-login">
      <form className="add-form admin-login-form" onSubmit={submit}>
        <SectionTitle icon={Lock} eyebrow={t('login.eyebrow')} title={t('login.title')} />
        <FormField label={t('login.passcode')} type="password" value={passcode} onChange={setPasscode} required />
        <button className="primary-button wide-button" type="submit" disabled={state.status === 'loading'}>
          {state.status === 'loading' ? t('login.checking') : t('login.signIn')} <ArrowRight size={18} />
        </button>
        {/* The switcher is on the login screen too: an operator who prefers
            Azerbaijani should not have to sign in through English first. */}
        <LanguageSwitcher />
        {state.message && <p className="lookup-message error">{state.message}</p>}
      </form>
    </div>
  );
}

function Console({ token, onSignOut }) {
  const { t } = useT();
  const [route, setRoute] = useState(() => window.location.hash.replace('#/', '') || 'overview');

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash.replace('#/', '') || 'overview');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const active = NAV.find((item) => item.id === route) || NAV[0];
  const ActivePage = active.Component;

  return (
    <div className="console-shell">
      <aside className="console-nav">
        <div className="console-brand">
          <span className="brand-mark">K</span>
          <div>
            {/* Brand names, not copy — identical in both dictionaries. */}
            <strong>{t('brand.name')}</strong>
            <small>{t('brand.site')}</small>
          </div>
        </div>
        <nav>
          {NAV.map((item) => (
            <a
              key={item.id}
              href={`#/${item.id}`}
              className={`console-nav-link${item.id === active.id ? ' is-active' : ''}`}
            >
              <item.icon size={17} /> {t(`nav.${item.id}`)}
            </a>
          ))}
        </nav>
        <LanguageSwitcher />
        <button className="console-signout" onClick={onSignOut} type="button">
          <LogOut size={15} /> {t('nav.signOut')}
        </button>
      </aside>
      <main className="console-main">
        {/* The boundary wraps the PAGE, not the shell, so a crashing module
            leaves the sidebar intact and the operator can navigate away.
            `resetKey` clears a stale error when the route changes.

            Both keyed on route so each page's data loading starts clean rather
            than briefly rendering the previous page's state. */}
        <ErrorBoundary resetKey={active.id} t={t}>
          <ActivePage key={active.id} token={token} />
        </ErrorBoundary>
      </main>
    </div>
  );
}

function AdminApp() {
  const [token, setToken] = useState(() => getAdminToken());

  const signOut = useCallback(() => {
    clearAdminToken();
    setToken('');
  }, []);

  // A page deep in the console can discover the token expired (adminFetch
  // throws UNAUTHORIZED after clearing it). Poll the store so the shell drops
  // back to the login screen instead of leaving pages stuck on an auth error.
  useEffect(() => {
    if (!token) return undefined;
    const interval = setInterval(() => {
      if (!getAdminToken()) setToken('');
    }, 5000);
    return () => clearInterval(interval);
  }, [token]);

  if (!token) return <LoginScreen onAuthenticated={setToken} />;
  return <Console token={token} onSignOut={signOut} />;
}

createRoot(document.getElementById('admin-root')).render(
  <React.StrictMode>
    {/* Wraps AdminApp rather than sitting inside it, so the login screen is
        translated too — and so the stored language survives sign-out. */}
    <ConsoleI18nProvider>
      <AdminApp />
    </ConsoleI18nProvider>
  </React.StrictMode>
);
