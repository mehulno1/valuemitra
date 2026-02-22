import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import type { ValuationApproach } from '@valuemitra/shared';

const VALUATION_KEY = 'valuation';
const AI_KEY = 'ai-valuation';

export interface ValuationRun {
  id: string;
  assignmentId: string;
  approach: ValuationApproach;
  marketComparables?: unknown;
  costInputs?: unknown;
  costValue?: number;
  incomeInputs?: unknown;
  incomeValue?: number;
  aiValuationResult?: {
    suggestedValueLow: number;
    suggestedValueMid: number;
    suggestedValueHigh: number;
    approach: string;
    reasoning: string;
    confidenceLevel: string;
    marketObservations: string[];
    riskFactors: string[];
  };
  compositeWeights?: {
    marketWeight: number;
    costWeight: number;
    incomeWeight: number;
  };
  finalValue?: number;
  isFinalized: boolean;
  createdAt: string;
}

export function useValuationRuns(assignmentId: string) {
  return useQuery({
    queryKey: [VALUATION_KEY, assignmentId],
    queryFn: () =>
      api
        .get<{ success: boolean; data: ValuationRun[] }>('/valuation', { params: { assignmentId } })
        .then((r) => r.data.data),
    enabled: !!assignmentId,
  });
}

export function useCreateValuationRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { assignmentId: string; approach: ValuationApproach }) =>
      api.post<{ data: ValuationRun }>('/valuation', data).then((r) => r.data),
    onSuccess: (_d, vars) => void qc.invalidateQueries({ queryKey: [VALUATION_KEY, vars.assignmentId] }),
  });
}

export function useUpdateMarket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; assignmentId: string; data: unknown }) =>
      api.patch(`/valuation/${id}/market`, data).then((r) => r.data),
    onSuccess: (_d, vars) => void qc.invalidateQueries({ queryKey: [VALUATION_KEY, vars.assignmentId] }),
  });
}

export function useUpdateCost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; assignmentId: string; data: unknown }) =>
      api.patch(`/valuation/${id}/cost`, data).then((r) => r.data),
    onSuccess: (_d, vars) => void qc.invalidateQueries({ queryKey: [VALUATION_KEY, vars.assignmentId] }),
  });
}

export function useUpdateIncome() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; assignmentId: string; data: unknown }) =>
      api.patch(`/valuation/${id}/income`, data).then((r) => r.data),
    onSuccess: (_d, vars) => void qc.invalidateQueries({ queryKey: [VALUATION_KEY, vars.assignmentId] }),
  });
}

export function useFinalizeValuation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; assignmentId: string; data: unknown }) =>
      api.post(`/valuation/${id}/finalize`, data).then((r) => r.data),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: [VALUATION_KEY, vars.assignmentId] });
      void qc.invalidateQueries({ queryKey: ['assignments', vars.assignmentId] });
    },
  });
}

export function useRequestAIValuation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assignmentId: string) =>
      api.post<{ data: { aiValuationResult: ValuationRun['aiValuationResult'] } }>(
        '/ai-valuation',
        { assignmentId },
      ).then((r) => r.data),
    onSuccess: (_d, assignmentId) => void qc.invalidateQueries({ queryKey: [VALUATION_KEY, assignmentId] }),
  });
}

export function useAIResult(runId: string) {
  return useQuery({
    queryKey: [AI_KEY, runId],
    queryFn: () =>
      api.get<{ data: ValuationRun['aiValuationResult'] }>(`/ai-valuation/run/${runId}`).then((r) => r.data.data),
    enabled: !!runId,
  });
}
