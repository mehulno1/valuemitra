import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import type { ValuationApproach } from '@valuemitra/shared';

const VALUATION_KEY = 'valuation';
const AI_KEY = 'ai-valuation';

export interface ComparableSale {
  id?: string;
  address: string;
  locality: string;
  transactionDate: string;
  totalArea: number;
  salePrice: number;
  ratePerSqFt?: number;
  sourceType: 'IGRS' | 'LISTING' | 'MANUAL';
  sourceUrl?: string;
  adjustmentTime?: number;
  adjustmentLocation?: number;
  adjustmentSize?: number;
  adjustmentCondition?: number;
  adjustmentAmenities?: number;
  adjustedValue?: number;
}

export interface ValuationRun {
  id: string;
  assignmentId: string;
  approach: ValuationApproach;
  version: number;
  isFinalized: boolean;
  comparables?: ComparableSale[];
  correlatedValue?: number;
  landValue?: number;
  landRateUsed?: number;
  landRateSource?: string;
  buildingPlinthArea?: number;
  buildingRatePerSqM?: number;
  replacementCost?: number;
  depreciationMethod?: string;
  depreciationRate?: number;
  depreciationAmount?: number;
  depreciatedValue?: number;
  servicesCost?: number;
  costApproachValue?: number;
  grossRent?: number;
  vacancyRate?: number;
  effectiveGrossIncome?: number;
  operatingExpenses?: number;
  netOperatingIncome?: number;
  capitalizationRate?: number;
  incomeApproachValue?: number;
  marketApproachWeight?: number;
  costApproachWeight?: number;
  incomeApproachWeight?: number;
  weightedValue?: number;
  roundedValue?: number;
  reconciliationNotes?: string;
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
  createdAt: string;
  updatedAt: string;
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
