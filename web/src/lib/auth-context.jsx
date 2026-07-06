// Auth context.
//
// PROD: fetches /.auth/me (SWA Entra) then /api/users/me (the BCI profile +
// effective permissions). Combines them into the user object the app consumes.
// LOCAL: with the Vite dev proxy + the backend MOCK_PRINCIPAL, /.auth/me does
// not exist, so we skip it and go straight to /api/users/me.

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';

const AuthContext = createContext(null);

// In dev the SWA auth endpoint isn't served by Vite; the Functions backend's
// MOCK_PRINCIPAL handles auth. Treat dev as "skip /.auth/me".
const IS_DEV = import.meta.env.DEV;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!IS_DEV) {
          const authMe = await fetch('/.auth/me').then((r) => r.json());
          if (!authMe.clientPrincipal) {
            window.location.href = '/.auth/login/aad?post_login_redirect_uri=/';
            return;
          }
        }
        const [profile, appSettings] = await Promise.all([api.me(), api.settings()]);
        if (!cancelled) { setUser(profile); setSettings(appSettings); }
      } catch (e) {
        if (!cancelled) setError(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist per-user UI preferences (table columns/sort). Updates local state
  // immediately (optimistic) and writes to the profile doc in the background.
  const savePreferences = async (patch) => {
    setUser((u) => (u ? { ...u, preferences: { ...(u.preferences || {}), ...patch } } : u));
    try { await api.savePrefs(patch); } catch { /* non-fatal — local state still applied */ }
  };

  const value = useMemo(() => ({ user, settings, loading, error, savePreferences }), [user, settings, loading, error]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
