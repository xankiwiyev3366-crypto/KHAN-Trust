import React, { useState } from 'react';

// Multi-step modal: benefit view → inline login or signup.
// Props come from AuthProvider directly so this component never needs
// to call useAuth() — it's rendered inside the provider but we keep
// the data flow explicit.
export function AuthGateModal({ onLogin, onRegister, onClose }) {
  const [step, setStep] = useState('benefits'); // 'benefits' | 'login' | 'signup'
  const [fields, setFields] = useState({ name: '', email: '', password: '', confirm: '' });
  const [status, setStatus] = useState({ loading: false, error: '' });

  const set = (key) => (e) => setFields((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setStatus({ loading: true, error: '' });
    try {
      if (step === 'login') {
        await onLogin({ email: fields.email, password: fields.password });
        // AuthContext's useEffect fires the pending callback after user state updates
      } else if (step === 'signup') {
        if (fields.password !== fields.confirm) throw new Error('Passwords do not match');
        await onRegister({ name: fields.name, email: fields.email, password: fields.password });
      }
      setStatus({ loading: false, error: '' });
    } catch (err) {
      setStatus({ loading: false, error: err.message || 'Something went wrong. Please try again.' });
    }
  };

  const switchStep = (next) => {
    setStatus({ loading: false, error: '' });
    setStep(next);
  };

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-gate-modal" role="dialog" aria-modal="true" aria-label="Sign in to continue">
        <button className="modal-close-btn" onClick={onClose} aria-label="Close">✕</button>

        {step === 'benefits' && (
          <>
            <div className="auth-gate-header">
              <span className="brand-mark auth-gate-brand">K</span>
              <div>
                <h2 className="auth-gate-title">Sign in to continue</h2>
                <p className="auth-gate-subtitle">Create a free KHAN Trust account to:</p>
              </div>
            </div>

            <ul className="auth-gate-benefits">
              <li>Save your scan history</li>
              <li>Build your watchlist</li>
              <li>Receive alerts</li>
              <li>Download PDF reports</li>
              <li>Access premium AI features</li>
              <li>Unlock future KHAN Holder benefits</li>
            </ul>

            <p className="auth-gate-tagline">Create your free account in less than a minute.</p>

            <div className="auth-gate-actions">
              <button className="primary-button wide-button" onClick={() => switchStep('signup')}>
                Create Free Account
              </button>
              <button className="secondary-button wide-button" onClick={() => switchStep('login')}>
                Sign In
              </button>
            </div>
          </>
        )}

        {(step === 'login' || step === 'signup') && (
          <>
            <div className="auth-modal-header">
              <span className="brand-mark" style={{ fontSize: '1.6rem' }}>K</span>
              <h2>{step === 'login' ? 'Sign In' : 'Create Account'}</h2>
            </div>

            <form className="auth-form" onSubmit={submit}>
              {step === 'signup' && (
                <label className="auth-field">
                  <span>Full Name</span>
                  <input type="text" value={fields.name} onChange={set('name')} placeholder="Your name" required autoComplete="name" />
                </label>
              )}

              <label className="auth-field">
                <span>Email</span>
                <input type="email" value={fields.email} onChange={set('email')} placeholder="you@example.com" required autoComplete="email" />
              </label>

              <label className="auth-field">
                <span>Password</span>
                <input type="password" value={fields.password} onChange={set('password')} placeholder="••••••••" required minLength={8} autoComplete={step === 'login' ? 'current-password' : 'new-password'} />
              </label>

              {step === 'signup' && (
                <label className="auth-field">
                  <span>Confirm Password</span>
                  <input type="password" value={fields.confirm} onChange={set('confirm')} placeholder="••••••••" required minLength={8} autoComplete="new-password" />
                </label>
              )}

              {status.error && <p className="auth-error">{status.error}</p>}

              <button className="primary-button wide-button" type="submit" disabled={status.loading}>
                {status.loading ? 'Please wait…' : step === 'login' ? 'Sign In' : 'Create Account'}
              </button>

              <div className="auth-links">
                {step === 'login' ? (
                  <>
                    <button type="button" className="auth-link-btn" onClick={() => switchStep('signup')}>
                      Don't have an account? Create one free
                    </button>
                    <button type="button" className="auth-link-btn" onClick={() => switchStep('benefits')}>
                      ← Back
                    </button>
                  </>
                ) : (
                  <button type="button" className="auth-link-btn" onClick={() => switchStep('login')}>
                    Already have an account? Sign in
                  </button>
                )}
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
