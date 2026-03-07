import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import type { InspectionData, AssignInspectionInput, SaveInspectionInput } from '@valuemitra/shared';

const INSPECTION_KEY = 'inspection';
const MY_INSPECTIONS_KEY = 'my-inspections';

export type { InspectionData };

export interface MyInspectionItem {
  id: string;
  assignmentId: string;
  scheduledDate: string | null;
  assignment: {
    id: string;
    assignmentNo: string;
    purposeOfValuation: string;
    property: {
      addressLine1: string;
      city: string;
      state: string;
      propertyType: string;
    };
    client: {
      fullName?: string | null;
      companyName?: string | null;
      bankName?: string | null;
    };
  };
}

export function useInspection(assignmentId: string) {
  return useQuery({
    queryKey: [INSPECTION_KEY, assignmentId],
    queryFn: () =>
      api
        .get<{ success: boolean; data: InspectionData | null }>(`/inspections/${assignmentId}`)
        .then((r) => r.data.data),
    enabled: !!assignmentId,
  });
}

export function useMyInspections() {
  return useQuery({
    queryKey: [MY_INSPECTIONS_KEY],
    queryFn: () =>
      api
        .get<{ success: boolean; data: MyInspectionItem[] }>('/inspections/my')
        .then((r) => r.data.data),
  });
}

export function useAssignInspection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ assignmentId, data }: { assignmentId: string; data: AssignInspectionInput }) =>
      api.post<{ success: boolean; data: InspectionData }>(`/inspections/${assignmentId}`, data).then((r) => r.data),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: [INSPECTION_KEY, vars.assignmentId] });
      void qc.invalidateQueries({ queryKey: ['assignments', vars.assignmentId] });
    },
  });
}

export function useUpdateInspection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ assignmentId, data }: { assignmentId: string; data: Partial<SaveInspectionInput> }) =>
      api.patch<{ success: boolean; data: InspectionData }>(`/inspections/${assignmentId}`, data).then((r) => r.data),
    onSuccess: (_d, vars) => void qc.invalidateQueries({ queryKey: [INSPECTION_KEY, vars.assignmentId] }),
  });
}

export function useSubmitInspection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assignmentId: string) =>
      api.post<{ success: boolean; data: InspectionData }>(`/inspections/${assignmentId}/submit`).then((r) => r.data),
    onSuccess: (_d, assignmentId) => {
      void qc.invalidateQueries({ queryKey: [INSPECTION_KEY, assignmentId] });
      void qc.invalidateQueries({ queryKey: ['assignments', assignmentId] });
    },
  });
}
