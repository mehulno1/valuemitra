import { ValuationApproach, DepreciationMethod } from './enums.js';

// ─────────────────────────────────────────────
// COMPARABLE SALES (for Market Comparison approach)
// ─────────────────────────────────────────────

export interface ComparableSale {
  id: string;
  address: string;
  locality: string;
  transactionDate: Date;
  totalArea: number;       // in sq.ft.
  salePrice: number;       // total sale price INR
  ratePerSqFt: number;     // derived
  sourceType: 'IGRS' | 'LISTING' | 'MANUAL';
  sourceUrl?: string;
  sourceScreenshotPath?: string;

  // Adjustments (% adjustments, can be negative)
  adjustmentTime?: number;
  adjustmentLocation?: number;
  adjustmentSize?: number;
  adjustmentCondition?: number;
  adjustmentAmenities?: number;
  totalAdjustment?: number;   // sum of all adjustments %
  adjustedRate?: number;      // ratePerSqFt after adjustments
}

// ─────────────────────────────────────────────
// VALUATION RUN
// ─────────────────────────────────────────────

export interface ValuationRun {
  id: string;
  assignmentId: string;
  approach: ValuationApproach;
  version: number;
  isFinalized: boolean;

  // Market Comparison
  comparables?: ComparableSale[];
  correlatedValue?: number;

  // Cost Approach — Land
  landValue?: number;
  landRateUsed?: number;
  landRateSource?: 'govt_rr' | 'market' | 'manual';
  landGovtRateId?: string;

  // Cost Approach — Building
  buildingPlinthArea?: number;
  buildingRatePerSqM?: number;
  replacementCost?: number;
  depreciationMethod?: DepreciationMethod;
  depreciationRate?: number;
  depreciationAmount?: number;
  depreciatedValue?: number;
  servicesCost?: number;
  costApproachValue?: number;

  // Income Approach
  grossRent?: number;
  vacancyRate?: number;
  effectiveGrossIncome?: number;
  operatingExpenses?: number;
  netOperatingIncome?: number;
  capitalizationRate?: number;
  incomeApproachValue?: number;

  // Final Reconciliation
  marketApproachWeight?: number;
  costApproachWeight?: number;
  incomeApproachWeight?: number;
  weightedValue?: number;
  roundedValue?: number;

  reconciliationNotes?: string;

  // Immutable audit snapshot
  inputSnapshot?: Record<string, unknown>;

  computedAt?: Date;
  computedById?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─────────────────────────────────────────────
// AI VALUATION MODEL OUTPUT
// ─────────────────────────────────────────────

export interface AIValuationResult {
  suggestedValueLow: number;
  suggestedValueMid: number;
  suggestedValueHigh: number;
  suggestedLandRateMarket?: number;  // Advisory market land rate (₹/sq.m.)
  suggestedLandRateGovt?: number;    // Advisory govt ready reckoner rate (₹/sq.m.)
  confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  reasoning: string;
  keyFactors: string[];
  caveats: string[];
  generatedAt: Date;
  modelVersion: string;
}

// ─────────────────────────────────────────────
// GOVERNMENT RATE
// ─────────────────────────────────────────────

export interface GovernmentRate {
  id: string;
  tenantId?: string;
  state: string;
  rateYear: string;          // e.g. "2024-25"
  district?: string;
  taluka?: string;
  village?: string;
  zone?: string;
  jantriZone?: string;
  surveyType?: string;
  propertyCategory: string;
  ratePerSqM?: number;
  ratePerSqFt?: number;
  ratePerAcre?: number;
  sourceUrl?: string;
  fetchedAt: Date;
  isManualOverride: boolean;
  overrideNotes?: string;
  effectiveFrom: Date;
  effectiveTo?: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ─────────────────────────────────────────────
// DEPRECIATION CALCULATOR INPUT/OUTPUT
// ─────────────────────────────────────────────

export interface DepreciationInput {
  method: DepreciationMethod;
  replacementCost: number;
  ageYears: number;
  totalLifeYears: number;        // Expected useful life
  wdvRate?: number;              // Annual WDV rate (e.g. 0.05 = 5%)
  observedCondition?: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'VERY_POOR';
}

export interface DepreciationOutput {
  depreciationRate: number;      // As decimal (0–1)
  depreciationAmount: number;    // INR
  depreciatedValue: number;      // INR
  remainingLifeYears: number;
  method: DepreciationMethod;
}
