import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAuthStore } from '../../stores/auth.store.js';
import type { RegisterTenantInput, LoginInput } from '@valuemitra/shared';

interface LoginResponse {
  success: boolean;
  data: {
    user: { id: string; email: string; fullName: string; role: string; tenantId: string };
    tenant: { id: string; name: string; slug: string; firmCode: string };
    accessToken: string;
    refreshToken: string;
  };
}

interface RegisterResponse {
  success: boolean;
  data: {
    tenant: { id: string; name: string; slug: string };
    user: { id: string; email: string; role: string };
    accessToken: string;
    refreshToken: string;
  };
}

export function useLogin() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();

  return useMutation({
    mutationFn: (input: LoginInput) =>
      api.post<LoginResponse>('/auth/login', input).then((r) => r.data),
    onSuccess: (data) => {
      const { user, tenant, accessToken, refreshToken } = data.data;
      setAuth(user, tenant, accessToken, refreshToken);
      navigate('/dashboard');
    },
  });
}

export function useRegister() {
  const navigate = useNavigate();

  return useMutation({
    mutationFn: (input: RegisterTenantInput) =>
      api.post<RegisterResponse>('/auth/register', input).then((r) => r.data),
    onSuccess: () => {
      navigate('/login?registered=1');
    },
  });
}

export function useLogout() {
  const { refreshToken, logout } = useAuthStore();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: () =>
      api.post('/auth/logout', { refreshToken }).then((r) => r.data),
    onSettled: () => {
      logout();
      navigate('/login');
    },
  });
}
