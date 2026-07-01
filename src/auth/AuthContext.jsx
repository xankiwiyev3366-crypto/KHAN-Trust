import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AuthGateModal } from './AuthGateModal.jsx';

const TOKEN_KEY = 'khan-trust-auth-token-v1';

const AuthContext = createContext(null);

async function apiFetch(path, options = {}) {
  const res = await fetch(`/.netlify/functions/${path}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || 'Request failed'), { status: res.status });
  return data;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => {
    try { return localStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
  });
  const [isLoading, setIsLoading] = useState(Boolean(token));

  // Gate modal state
  const [gateOpen, setGateOpen] = useState(false);
  const pendingCallback = useRef(null);

  // Restore session on mount
  useEffect(() => {
    if (!token) { setIsLoading(false); return; }
    apiFetch('auth-me', { headers: { Authorization: `Bearer ${token}` } })
      .then(({ user: u }) => setUser(u))
      .catch(() => { localStorage.removeItem(TOKEN_KEY); setToken(null); })
      .finally(() => setIsLoading(false));
  }, []);

  // When user logs in (from any path), fire the pending gated callback
  useEffect(() => {
    if (user && pendingCallback.current) {
      const cb = pendingCallback.current;
      pendingCallback.current = null;
      setGateOpen(false);
      // Small timeout lets React commit the user state before the callback
      // triggers any component that reads user from context
      setTimeout(cb, 0);
    }
  }, [user]);

  const persist = useCallback((u, tok) => {
    setUser(u);
    setToken(tok);
    try { localStorage.setItem(TOKEN_KEY, tok); } catch {}
  }, []);

  const register = useCallback(async ({ name, email, password }) => {
    const data = await apiFetch('auth-register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    persist(data.user, data.token);
    return data.user;
  }, [persist]);

  const login = useCallback(async ({ email, password }) => {
    const data = await apiFetch('auth-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    persist(data.user, data.token);
    return data.user;
  }, [persist]);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    try { localStorage.removeItem(TOKEN_KEY); } catch {}
  }, []);

  const forgotPassword = useCallback(async (email) => {
    return apiFetch('auth-forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
  }, []);

  const resetPassword = useCallback(async (resetToken, password) => {
    return apiFetch('auth-reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: resetToken, password }),
    });
  }, []);

  const verifyEmail = useCallback(async (verifyToken) => {
    const data = await apiFetch('auth-verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: verifyToken }),
    });
    persist(data.user, data.token);
    return data.user;
  }, [persist]);

  const updateProfile = useCallback(async (updates) => {
    if (!token) throw new Error('Not authenticated');
    const data = await apiFetch('auth-profile-update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(updates),
    });
    setUser(data.user);
    return data.user;
  }, [token]);

  const fetchUserScans = useCallback(async () => {
    if (!token) return [];
    const data = await apiFetch('auth-user-scans', { headers: { Authorization: `Bearer ${token}` } });
    return data.scans || [];
  }, [token]);

  const resendVerificationEmail = useCallback(async () => {
    if (!token) throw new Error('Not authenticated');
    return apiFetch('auth-resend-verification', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  }, [token]);

  // Re-fetches the current user without a full page reload - used to pick up
  // a verification completed in another tab (see the visibility effect
  // below) so the badge updates on its own instead of needing a manual
  // refresh.
  const refreshUser = useCallback(async () => {
    if (!token) return;
    try {
      const { user: u } = await apiFetch('auth-me', { headers: { Authorization: `Bearer ${token}` } });
      setUser(u);
    } catch {
      // Leave user state as-is; a genuinely expired/invalid token is already
      // handled by the session-restore effect on mount.
    }
  }, [token]);

  // Email verification commonly happens in a second tab (the user clicks the
  // link from their email client). Re-check on return to this tab so
  // "Email verified" appears automatically, without the user needing to
  // reload or click anything here.
  useEffect(() => {
    if (!user || user.emailVerified) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshUser();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [user, refreshUser]);

  // gate(callback): if logged in, run immediately; otherwise show benefit modal
  // and run callback after the user authenticates.
  const gate = useCallback((callback) => {
    if (user) {
      callback?.();
      return;
    }
    pendingCallback.current = callback;
    setGateOpen(true);
  }, [user]);

  const closeGate = useCallback(() => {
    setGateOpen(false);
    pendingCallback.current = null;
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, register, login, logout, forgotPassword, resetPassword, verifyEmail, updateProfile, fetchUserScans, resendVerificationEmail, refreshUser, gate }}>
      {children}
      {gateOpen && (
        <AuthGateModal
          onLogin={login}
          onRegister={register}
          onClose={closeGate}
        />
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
