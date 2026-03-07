import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import type { AssignmentStatus, PropertyType, UpdateGeneralFieldsInput } from '@valuemitra/shared';

const ASSIGNMENTS_KEY = 'assignments';

interface Assignment {
  id: string;
  assignmentNo: string;
  firmReferenceNo: string | null;
  status: AssignmentStatus;
  propertyType: PropertyType;
  isUnderConstruction: boolean;
  percentageCompletion: number | null;
  freshOrRevaluation: string | null;
  purposeOfValuation: string | null;
  bankRefNo: string | null;
  inspectionDate: string | null;
  reportDueDate: string | null;
  finalValue: string | null;
  // GEN fields (from /assignments/:id/general)
  loanType?: string | null;
  propertySubType?: string | null;
  bankBranchAddress?: string | null;
  bankRepresentative?: string | null;
  bankInstructionDate?: string | null;
  agreedFee?: number | null;
  feeGst?: number | null;
  referenceNote?: string | null;
  client: {
    fullName: string | null;
    companyName: string | null;
    bankName: string | null;
    bankCode: string | null;
    isBank: boolean;
  };
  property: { addressLine1: string | null; city: string | null; state: string | null } | null;
  assignedTo: { fullName: string } | null;
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

export function useUpdateGeneralFields() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<UpdateGeneralFieldsInput> }) =>
      api.patch(`/assignments/${id}/general`, data).then((r) => r.data),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: [ASSIGNMENTS_KEY, vars.id] });
    },
  });
}
