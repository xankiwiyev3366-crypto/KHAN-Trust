import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext.jsx';

// Modes: 'login' | 'signup' | 'forgot' | 'check-email' | 'reset-password' | 'reset-done'
export function AuthModal({ initialMode = 'login', resetToken = null, onClose, onSuccess }) {
  const { login, register, forgotPassword, resetPassword } = useAuth();
  const [mode, setMode] = useState(resetToken ? 'reset-password' : initialMode);
  const [fields, setFields] = useState({ name: '', email: '', password: '', confirm: '' });
  const [status, setStatus] = useState({ loading: false, error: '' });
  const dialogRef = useRef(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (key) => (e) => setFields((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setStatus({ loading: true, error: '' });
    try {
      if (mode === 'login') {
        await login({ email: fields.email, password: fields.password });
        onSuccess?.();
        onClose();
      } else if (mode === 'signup') {
        if (fields.password !== fields.confirm) throw new Error('Passwords do not match');
        await register({ name: fields.name, email: fields.email, password: fields.password });
        onSuccess?.();
        onClose();
      } else if (mode === 'forgot') {
        await forgotPassword(fields.email);
        setMode('check-email');
      } else if (mode === 'reset-password') {
        if (fields.password !== fields.confirm) throw new Error('Passwords do not match');
        await resetPassword(resetToken, fields.password);
        setMode('reset-done');
      }
      setStatus({ loading: false, error: '' });
    } catch (err) {
      setStatus({ loading: false, error: err.message || 'Something went wrong' });
    }
  };

  const titles = {
    login: 'Sign In',
    signup: 'Create Account',
    forgot: 'Reset Password',
    'check-email': 'Check Your Email',
    'reset-password': 'Set New Password',
    'reset-done': 'Password Updated',
  };

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-label={titles[mode]}>
        <button className="modal-close-btn" onClick={onClose} aria-label="Close">✕</button>

        <div className="auth-modal-header">
          <span className="brand-mark" style={{ fontSize: '1.6rem' }}>K</span>
          <h2>{titles[mode]}</h2>
        </div>

        {mode === 'check-email' && (
          <div className="auth-info-block">
            <p>If an account exists for <strong>{fields.email}</strong>, a password reset link has been sent.</p>
            <p>Check your inbox and follow the link. It expires in 1 hour.</p>
            <button className="secondary-button" onClick={() => setMode('login')}>Back to Sign In</button>
          </div>
        )}

        {mode === 'reset-done' && (
          <div className="auth-info-block">
            <p>Your password has been updated successfully.</p>
            <button className="primary-button wide-button" onClick={() => { setMode('login'); setFields((f) => ({ ...f, password: '', confirm: '' })); }}>Sign In</button>
          </div>
        )}

        {!['check-email', 'reset-done'].includes(mode) && (
          <form className="auth-form" onSubmit={submit}>
            {mode === 'signup' && (
              <label className="auth-field">
                <span>Full Name</span>
                <input type="text" value={fields.name} onChange={set('name')} placeholder="Your name" required autoComplete="name" />
              </label>
            )}

            {['login', 'signup', 'forgot'].includes(mode) && (
              <label className="auth-field">
                <span>Email</span>
                <input type="email" value={fields.email} onChange={set('email')} placeholder="you@example.com" required autoComplete="email" />
              </label>
            )}

            {['login', 'signup', 'reset-password'].includes(mode) && (
              <label className="auth-field">
                <span>{mode === 'reset-password' ? 'New Password' : 'Password'}</span>
                <input type="password" value={fields.password} onChange={set('password')} placeholder="••••••••" required minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
              </label>
            )}

            {['signup', 'reset-password'].includes(mode) && (
              <label className="auth-field">
                <span>Confirm Password</span>
                <input type="password" value={fields.confirm} onChange={set('confirm')} placeholder="••••••••" required minLength={8} autoComplete="new-password" />
              </label>
            )}

            {status.error && <p className="auth-error">{status.error}</p>}

            <button className="primary-button wide-button" type="submit" disabled={status.loading}>
              {status.loading ? 'Please wait…' : { login: 'Sign In', signup: 'Create Account', forgot: 'Send Reset Link', 'reset-password': 'Set New Password' }[mode]}
            </button>

            {mode === 'login' && (
              <div className="auth-links">
                <button type="button" className="auth-link-btn" onClick={() => { setStatus({ loading: false, error: '' }); setMode('forgot'); }}>Forgot password?</button>
                <button type="button" className="auth-link-btn" onClick={() => { setStatus({ loading: false, error: '' }); setMode('signup'); }}>Create an account</button>
              </div>
            )}

            {mode === 'signup' && (
              <div className="auth-links">
                <button type="button" className="auth-link-btn" onClick={() => { setStatus({ loading: false, error: '' }); setMode('login'); }}>Already have an account? Sign in</button>
              </div>
            )}

            {mode === 'forgot' && (
              <div className="auth-links">
                <button type="button" className="auth-link-btn" onClick={() => { setStatus({ loading: false, error: '' }); setMode('login'); }}>Back to Sign In</button>
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
