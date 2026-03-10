import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';

const USERS_KEY = 'users';

export interface UserSummary {
  id: string;
  fullName: string;
  email: string;
  role: string;
  phone?: string;
  ibbiRegNo?: string;
  isActive: boolean;
  createdAt: string;
}

export function useUsers(enabled = true) {
  return useQuery({
    queryKey: [USERS_KEY],
    queryFn: () =>
      api
        .get<{ success: boolean; data: UserSummary[] }>('/users')
        .then((r) => r.data.data),
    enabled,
  });
}

export interface CreateUserPayload {
  email: string;
  fullName: string;
  role: string;
  password: string;
  phone?: string;
  ibbiRegNo?: string;
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateUserPayload) =>
      api.post<{ data: UserSummary }>('/users', data).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [USERS_KEY] }),
  });
}

export function useDeactivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api.delete(`/users/${userId}`).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [USERS_KEY] }),
  });
}
