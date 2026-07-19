import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AuthGateModal } from './AuthGateModal.jsx';
import { getGrowthContext } from '../growth.js';
import { getStoredReferralCode, clearStoredReferralCode } from '../referral.js';

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

  // `attribution`/`device` ride along on registration so the server can weld
  // the channel that originally brought this visitor here onto the new account
  // (see _growthRecord.mjs). growthFields() is defensive because auth must
  // never fail on account of analytics: if the growth context is unavailable
  // for any reason, the signup still goes through, just unattributed.
  const growthFields = () => {
    try {
      const { attribution, device } = getGrowthContext();
      return { attribution, device };
    } catch {
      return {};
    }
  };

  const register = useCallback(async ({ name, email, password }) => {
    // `referralCode` is the write-once code captured from ?ref= at first touch
    // (see referral.js). Sending it here is the one moment an anonymous visitor
    // who arrived via an invite link becomes a real account that can be credited
    // to the inviter. Absent/invalid codes are ignored server-side, so this can
    // never affect a normal sign-up.
    const referralCode = getStoredReferralCode();
    const data = await apiFetch('auth-register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, ...growthFields(), ...(referralCode ? { referralCode } : {}) }),
    });
    persist(data.user, data.token);
    // The relationship is now permanently recorded server-side; the local code
    // has done its job and is cleared so a future different sign-up on this
    // browser is not mis-attributed to the same inviter.
    clearStoredReferralCode();
    return data.user;
  }, [persist]);

  const login = useCallback(async ({ email, password }) => {
    const data = await apiFetch('auth-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, ...growthFields() }),
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

  // Retention alerts (Direction 3): toggle an email trust-alert for one token,
  // and read which tokens the user currently has alerts on. Both require auth;
  // both are best-effort at the call site so a failure never blocks the UI.
  //
  // These read the token from localStorage (its source of truth) rather than
  // only the `token` state closure: toggleTokenAlert is invoked from the gate()
  // pending-callback that fires right AFTER a user signs in from the alert
  // button, and that callback captured the logged-out render's closure (token
  // still null). persist() writes the token to localStorage synchronously
  // during login, before the callback runs, so reading it here lets the
  // resumed action succeed - which is exactly what gate() promises.
  const authToken = useCallback(() => {
    if (token) return token;
    try { return localStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
  }, [token]);

  const toggleTokenAlert = useCallback(async (tokenPayload) => {
    const tok = authToken();
    if (!tok) throw new Error('Not authenticated');
    return apiFetch('alerts-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify(tokenPayload),
    });
  }, [authToken]);

  const fetchAlertTokens = useCallback(async () => {
    const tok = authToken();
    if (!tok) return [];
    const data = await apiFetch('alerts-status', { headers: { Authorization: `Bearer ${tok}` } });
    return data.tokens || [];
  }, [authToken]);

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
    <AuthContext.Provider value={{ user, token, isLoading, register, login, logout, forgotPassword, resetPassword, verifyEmail, updateProfile, fetchUserScans, resendVerificationEmail, refreshUser, toggleTokenAlert, fetchAlertTokens, gate }}>
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
