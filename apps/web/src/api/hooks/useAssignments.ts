import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import type { AssignmentStatus, PropertyType } from '@valuemitra/shared';

const ASSIGNMENTS_KEY = 'assignments';

interface Assignment {
  id: string;
  assignmentNo: string;
  status: AssignmentStatus;
  propertyType: PropertyType;
  propertyAddress: string;
  propertyCity: string;
  inspectionDate: string | null;
  reportDueDate: string | null;
  client: { name: string; bankCode: string | null };
  assignedTo: { firstName: string; lastName: string } | null;
  createdAt: string;
}

interface ListResponse {
  data: Assignment[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

export function useAssignments(filters?: Record<string, string | undefined>) {
  return useQuery({
    queryKey: [ASSIGNMENTS_KEY, filters],
    queryFn: () =>
      api
        .get<{ success: boolean } & ListResponse>('/assignments', { params: filters })
        .then((r) => r.data),
  });
}

export function useAssignment(assignmentId: string) {
  return useQuery({
    queryKey: [ASSIGNMENTS_KEY, assignmentId],
    queryFn: () =>
      api
        .get<{ success: boolean; data: Assignment }>(`/assignments/${assignmentId}`)
        .then((r) => r.data.data),
    enabled: !!assignmentId,
  });
}

export function useCreateAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: unknown) => api.post('/assignments', data).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [ASSIGNMENTS_KEY] }),
  });
}

export function useUpdateAssignmentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, comment }: { id: string; status: AssignmentStatus; comment?: string }) =>
      api.patch(`/assignments/${id}/status`, { status, comment }).then((r) => r.data),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: [ASSIGNMENTS_KEY, vars.id] });
      void qc.invalidateQueries({ queryKey: [ASSIGNMENTS_KEY] });
    },
  });
}
