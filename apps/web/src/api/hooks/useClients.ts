import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import type { ClientType } from '@valuemitra/shared';

const CLIENTS_KEY = 'clients';

export interface Client {
  id: string;
  clientType: ClientType;
  fullName?: string;
  companyName?: string;
  bankName?: string;
  bankBranch?: string;
  email?: string;
  phone?: string;
  pan?: string;
  gstin?: string;
  ifscCode?: string;
  city?: string;
  state?: string;
  createdAt: string;
  _count?: { assignments: number };
}

interface ListResponse {
  success: boolean;
  data: Client[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

export function useClients(filters?: Record<string, string | undefined>) {
  return useQuery({
    queryKey: [CLIENTS_KEY, filters],
    queryFn: () =>
      api.get<ListResponse>('/clients', { params: filters }).then((r) => r.data),
  });
}

export function useClient(clientId: string) {
  return useQuery({
    queryKey: [CLIENTS_KEY, clientId],
    queryFn: () =>
      api.get<{ success: boolean; data: Client }>(`/clients/${clientId}`).then((r) => r.data.data),
    enabled: !!clientId,
  });
}

export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: unknown) => api.post<{ data: Client }>('/clients', data).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [CLIENTS_KEY] }),
  });
}

export function useUpdateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: unknown }) =>
      api.put<{ data: Client }>(`/clients/${id}`, data).then((r) => r.data),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: [CLIENTS_KEY, vars.id] });
      void qc.invalidateQueries({ queryKey: [CLIENTS_KEY] });
    },
  });
}
