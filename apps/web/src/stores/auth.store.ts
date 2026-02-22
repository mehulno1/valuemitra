import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  tenantId: string;
}

interface AuthTenant {
  id: string;
  name: string;
  slug: string;
  firmCode: string;
}

interface AuthState {
  user: AuthUser | null;
  tenant: AuthTenant | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;

  setAuth: (user: AuthUser, tenant: AuthTenant, accessToken: string, refreshToken: string) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      tenant: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,

      setAuth: (user, tenant, accessToken, refreshToken) =>
        set({ user, tenant, accessToken, refreshToken, isAuthenticated: true }),

      setTokens: (accessToken, refreshToken) =>
        set({ accessToken, refreshToken }),

      logout: () =>
        set({
          user: null,
          tenant: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
        }),
    }),
    {
      name: 'vm-auth',
      // Only persist refresh token and user info — NOT the short-lived access token
      partialize: (state) => ({
        user: state.user,
        tenant: state.tenant,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);
