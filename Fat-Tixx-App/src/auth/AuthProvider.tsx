import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, configureAuth, describeDevice } from '@/api/client';
import type { Account, AuthResponse, PendingRegistration } from '@/api/types';
import { forgetOrders, getSessionToken, setSessionToken } from './secure';

/**
 * Session state for the whole app. The token lives in SecureStore and in memory only; it is attached to
 * requests by the API client. A 401 from the server (revoked / expired session) signs the user out locally.
 */
type Status = 'loading' | 'guest' | 'signed-in';

interface AuthContextValue {
  status: Status;
  account: Account | null;
  /** The raw session token, for the in-app web view's one-time sign-in handoff header. Never log or display it. */
  getToken: () => string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string, startedAt: number) => Promise<{ pending: boolean; message?: string }>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used inside <AuthProvider>');
  return c;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [account, setAccount] = useState<Account | null>(null);
  const tokenRef = useRef<string | null>(null);
  const queryClient = useQueryClient();

  const clearLocal = useCallback(async () => {
    tokenRef.current = null;
    setAccount(null);
    setStatus('guest');
    await setSessionToken(null);
    // Anything fetched with the old token must not linger (orders, scanner events).
    queryClient.removeQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('me:') });
  }, [queryClient]);

  // Register with the API client once; it reads the latest token through the ref.
  useEffect(() => {
    configureAuth(() => tokenRef.current, () => { void clearLocal(); });
  }, [clearLocal]);

  const adopt = useCallback(async (r: AuthResponse) => {
    tokenRef.current = r.token;
    await setSessionToken(r.token);
    setAccount(r.account);
    setStatus('signed-in');
  }, []);

  const refresh = useCallback(async () => {
    if (!tokenRef.current) return;
    try {
      const r = await api<{ account: Account }>('/auth/me');
      setAccount(r.account);
      setStatus('signed-in');
    } catch (e) {
      // Network trouble keeps the cached account; only a rejected token signs out (handled by the client hook).
      if (e instanceof ApiError && e.isAuth) await clearLocal();
    }
  }, [clearLocal]);

  // Restore the session on launch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getSessionToken();
      if (cancelled) return;
      if (!token) { setStatus('guest'); return; }
      tokenRef.current = token;
      try {
        const r = await api<{ account: Account }>('/auth/me');
        if (!cancelled) { setAccount(r.account); setStatus('signed-in'); }
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.isAuth) await clearLocal();
        else setStatus('signed-in'); // offline: trust the stored token until the server says otherwise
      }
    })();
    return () => { cancelled = true; };
  }, [clearLocal]);

  const signIn = useCallback(async (email: string, password: string) => {
    const r = await api<AuthResponse>('/auth/login', { method: 'POST', body: { email, password, device: describeDevice() }, anonymous: true });
    await adopt(r);
  }, [adopt]);

  const signUp = useCallback(async (name: string, email: string, password: string, startedAt: number) => {
    const r = await api<AuthResponse | PendingRegistration>('/auth/register', { method: 'POST', body: { name, email, password, startedAt, device: describeDevice() }, anonymous: true });
    if ('pending' in r) return { pending: true, message: r.message };
    await adopt(r);
    return { pending: false, message: r.message };
  }, [adopt]);

  const signOut = useCallback(async () => {
    const hadToken = !!tokenRef.current;
    if (hadToken) await api('/auth/logout', { method: 'POST', timeoutMs: 6000 }).catch(() => {});
    await clearLocal();
    await forgetOrders();
    queryClient.clear();
  }, [clearLocal, queryClient]);

  const getToken = useCallback(() => tokenRef.current, []);
  const value = useMemo<AuthContextValue>(() => ({ status, account, getToken, signIn, signUp, signOut, refresh }), [status, account, getToken, signIn, signUp, signOut, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
