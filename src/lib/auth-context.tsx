'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { api } from '@/lib/api-client';

interface AuthUser {
  id: number;
  username: string;
  displayName?: string;
  role: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  identityStatus: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  identityStatus: null,
  loading: true,
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [identityStatus, setIdentityStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ user: AuthUser; identityStatus: string }>('/auth/session');
      setUser(data.user);
      setIdentityStatus(data.identityStatus);
    } catch {
      setUser(null);
      setIdentityStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ user, identityStatus, loading, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
