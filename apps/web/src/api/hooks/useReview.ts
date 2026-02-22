import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';

export function useSubmitForReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ assignmentId, data }: { assignmentId: string; data: { reportId: string; notes?: string } }) =>
      api.post(`/review/${assignmentId}/submit`, data).then((r) => r.data),
    onSuccess: (_d, vars) => void qc.invalidateQueries({ queryKey: ['assignments', vars.assignmentId] }),
  });
}

export function useAdvanceReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ assignmentId, data }: { assignmentId: string; data?: { notes?: string } }) =>
      api.post(`/review/${assignmentId}/advance`, data ?? {}).then((r) => r.data),
    onSuccess: (_d, vars) => void qc.invalidateQueries({ queryKey: ['assignments', vars.assignmentId] }),
  });
}

export function useRejectReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ assignmentId, data }: { assignmentId: string; data: { reason: string } }) =>
      api.post(`/review/${assignmentId}/reject`, data).then((r) => r.data),
    onSuccess: (_d, vars) => void qc.invalidateQueries({ queryKey: ['assignments', vars.assignmentId] }),
  });
}

export function useDeliverFinalReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ assignmentId, data }: {
      assignmentId: string;
      data: { recipientEmail: string; recipientName: string; message?: string };
    }) => api.post(`/review/${assignmentId}/deliver`, data).then((r) => r.data),
    onSuccess: (_d, vars) => void qc.invalidateQueries({ queryKey: ['assignments', vars.assignmentId] }),
  });
}
