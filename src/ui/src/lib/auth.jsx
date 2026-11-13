/**
 * JobFinder — auth context (local session).
 *
 * The session lives in an HTTP-only cookie managed by the API; the UI only
 * needs to know WHO is logged in to protect the routes and to show the
 * account in the sidebar/header. A 401 from any request drops the session
 * and sends the user back to /login.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

import { api } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const check = useCallback(async () => {
    try {
      const data = await api.get('/auth/session');
      setUser(data.authenticated ? data.user : null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  // Any 401 (expired/revoked session) drops the user -> routes redirect.
  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener('jobfinder:unauthorized', onUnauthorized);
    return () => window.removeEventListener('jobfinder:unauthorized', onUnauthorized);
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await api.post('/auth/login', { email, password });
    setUser(data.user);
    return data;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* the session is already gone — ignore */
    }
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, check }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

/** Initials for the avatar (e-mail based). */
export function initialsFrom(email) {
  const source = String(email ?? '').split('@')[0] ?? '';
  const parts = source.split(/[._-]+/).filter(Boolean);
  if (!parts.length) return 'JF';
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
