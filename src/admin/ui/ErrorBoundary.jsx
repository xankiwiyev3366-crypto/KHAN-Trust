// Stops one broken page from taking down the whole console.
//
// Without this, any render error anywhere unmounts the entire React tree and
// the operator gets a blank white screen with no navigation, no explanation,
// and no way back — the failure mode is indistinguishable from the app being
// dead. This was not hypothetical: it is exactly what happened the first time
// the console was opened against an endpoint that returned HTML instead of
// JSON, and the sidebar disappearing made it far harder to diagnose than the
// underlying bug warranted.
//
// The boundary is placed around the PAGE, not the shell, so navigation
// survives and the operator can simply move to another module.
import React from 'react';
import { AlertTriangle } from 'lucide-react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // There is one operator and no error-reporting service wired up, so the
    // console is genuinely the right place for this.
    console.error('[console] page crashed:', error, info?.componentStack);
  }

  // Without this, navigating away from a crashed page leaves the boundary stuck
  // on the old error — the operator clicks a working page and still sees the
  // failure. The shell re-keys on route, which remounts and resets us.
  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    // A class component cannot use hooks, so the shell threads `t` in as a
    // prop. The fallbacks matter: if the boundary itself caught a crash in the
    // i18n provider, `t` may be missing, and an error screen that crashes is
    // the one screen that absolutely must not.
    const t = this.props.t || ((_key, fallback) => fallback);

    return (
      <div className="empty-state">
        <AlertTriangle size={28} />
        <h3>{t('errors.pageCrashed')}</h3>
        <p>{t('errors.restWorks')}</p>
        <pre className="console-error-detail">{String(this.state.error?.message || this.state.error)}</pre>
      </div>
    );
  }
}
