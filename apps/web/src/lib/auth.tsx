import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, onSignedOut, setAccessToken, tryRestore } from './api';

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: 'coordinator' | 'valuer' | 'accounts' | 'admin';
  firm_id: number;
  firm_name: string;
  firm_code: string;
  perms: string[];
  totp_enabled: boolean;
}

interface Ctx {
  user: SessionUser | null;
  flags: Record<string, boolean>;
  ready: boolean;
  signIn: (s: { accessToken: string; user: SessionUser; flags: Record<string, boolean> }) => void;
  signOut: () => Promise<void>;
  can: (perm: string) => boolean;
}

const AuthCtx = createContext<Ctx>(null as unknown as Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    tryRestore().then((s) => {
      if (s) { setUser(s.user); setFlags(s.flags); }
      setReady(true);
    });
    return onSignedOut(() => { setAccessToken(null); setUser(null); });
  }, []);

  const signIn = useCallback((s: { accessToken: string; user: SessionUser; flags: Record<string, boolean> }) => {
    setAccessToken(s.accessToken);
    setUser(s.user);
    setFlags(s.flags);
  }, []);

  const signOut = useCallback(async () => {
    await api.post('/api/auth/logout').catch(() => undefined);
    setAccessToken(null);
    setUser(null);
  }, []);

  const can = useCallback((perm: string) => !!user && (user.perms.includes(perm) || (user.role === 'admin' && perm !== 'sign')), [user]);

  return <AuthCtx.Provider value={{ user, flags, ready, signIn, signOut, can }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
