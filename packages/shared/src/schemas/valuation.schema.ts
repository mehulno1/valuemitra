import { z } from 'zod';
import { ValuationApproach, DepreciationMethod } from '../types/enums.js';

// ─────────────────────────────────────────────
// Comparable Sale (for Market Comparison)
// ─────────────────────────────────────────────

export const ComparableSaleSchema = z.object({
  id: z.string().optional(),
  address: z.string().min(5).max(500),
  locality: z.string().min(2).max(200),
  transactionDate: z.string().datetime(),
  totalArea: z.number().positive(),         // sq.ft.
  salePrice: z.number().positive(),          // INR
  sourceType: z.enum(['IGRS', 'LISTING', 'MANUAL']),
  sourceUrl: z.string().url().optional(),
  // Adjustments (%) — can be negative
  adjustmentTime: z.number().min(-50).max(50).optional(),
  adjustmentLocation: z.number().min(-50).max(50).optional(),
  adjustmentSize: z.number().min(-50).max(50).optional(),
  adjustmentCondition: z.number().min(-50).max(50).optional(),
  adjustmentAmenities: z.number().min(-50).max(50).optional(),
});

// ─────────────────────────────────────────────
// Create / Update ValuationRun
// ─────────────────────────────────────────────

export const CreateValuationRunSchema = z.object({
  assignmentId: z.string().uuid(),
  approach: z.nativeEnum(ValuationApproach),
});

export const UpdateMarketComparisonSchema = z.object({
  comparables: z.array(ComparableSaleSchema).min(1).max(10),
  correlatedValue: z.number().positive().optional(),
  // Market analysis (MKT_009-012)
  marketabilityRating: z.enum(['Good', 'Average', 'Poor', 'Low']).optional().nullable(),
  positiveFactors: z.string().max(2000).optional().or(z.literal('')),
  negativeFactors: z.string().max(2000).optional().or(z.literal('')),
  marketAnalysisNarrative: z.string().max(5000).optional().or(z.literal('')),
});

export const UpdateCostApproachSchema = z.object({
  // Land
  landArea: z.number().positive().optional(),          // sq.m.
  landRatePerSqM: z.number().positive().optional(),
  landRateSource: z.enum(['govt_rr', 'market', 'manual']).optional(),
  landGovtRateId: z.string().uuid().optional(),
  // Building
  buildingPlinthArea: z.number().positive().optional(), // sq.m.
  buildingRatePerSqM: z.number().positive().optional(),
  ageYears: z.number().min(0).max(200).optional(),
  totalLifeYears: z.number().min(1).max(200).optional(),
  depreciationMethod: z.nativeEnum(DepreciationMethod).optional(),
  wdvRate: z.number().min(0).max(1).optional(),
  observedCondition: z.enum(['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'VERY_POOR']).optional(),
  servicesCostPercent: z.number().min(0).max(20).optional(), // % of replacement cost
});

export const UpdateIncomeApproachSchema = z.object({
  grossRent: z.number().positive(),          // Monthly INR
  vacancyRate: z.number().min(0).max(1),     // 0.05 = 5%
  operatingExpenses: z.number().min(0),      // Annual INR
  capitalizationRate: z.number().min(0.01).max(0.30),
});

export const FinalizeValuationSchema = z.object({
  marketApproachWeight: z.number().min(0).max(1).optional(),
  costApproachWeight: z.number().min(0).max(1).optional(),
  incomeApproachWeight: z.number().min(0).max(1).optional(),
  reconciliationNotes: z.string().max(2000).optional(),
}).refine((data) => {
  const total =
    (data.marketApproachWeight ?? 0) +
    (data.costApproachWeight ?? 0) +
    (data.incomeApproachWeight ?? 0);
  return total === 0 || Math.abs(total - 1) < 0.001;
}, { message: 'Approach weights must sum to 1.0' });

// ─────────────────────────────────────────────
// AI Valuation request
// ─────────────────────────────────────────────

export const RequestAIValuationSchema = z.object({
  assignmentId: z.string().uuid(),
  valuationRunId: z.string().uuid().optional(),
  additionalContext: z.string().max(1000).optional(),
});

export type CreateValuationRunInput = z.infer<typeof CreateValuationRunSchema>;
export type UpdateMarketComparisonInput = z.infer<typeof UpdateMarketComparisonSchema>;
export type UpdateCostApproachInput = z.infer<typeof UpdateCostApproachSchema>;
export type UpdateIncomeApproachInput = z.infer<typeof UpdateIncomeApproachSchema>;
export type FinalizeValuationInput = z.infer<typeof FinalizeValuationSchema>;
export type RequestAIValuationInput = z.infer<typeof RequestAIValuationSchema>;
export type ComparableSaleInput = z.infer<typeof ComparableSaleSchema>;
