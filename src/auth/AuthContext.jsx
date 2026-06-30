import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

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

  // Restore session on mount
  useEffect(() => {
    if (!token) { setIsLoading(false); return; }
    apiFetch('auth-me', { headers: { Authorization: `Bearer ${token}` } })
      .then(({ user: u }) => setUser(u))
      .catch(() => { localStorage.removeItem(TOKEN_KEY); setToken(null); })
      .finally(() => setIsLoading(false));
  }, []);

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

  return (
    <AuthContext.Provider value={{ user, token, isLoading, register, login, logout, forgotPassword, resetPassword, verifyEmail, updateProfile, fetchUserScans }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
