import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';

const USERS_KEY = 'users';

export interface UserSummary {
  id: string;
  fullName: string;
  email: string;
  role: string;
  isActive: boolean;
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
