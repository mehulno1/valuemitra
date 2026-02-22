/**
 * Market Comparison Approach Engine
 * Adjusts comparable sales for time, location, size, condition, and amenities,
 * then correlates an indicated value via weighted average of adjusted rates.
 */

import type { ComparableSaleInput } from '@valuemitra/shared';

export interface AdjustedComparable {
  address: string;
  locality: string;
  transactionDate: string;
  totalArea: number;
  salePrice: number;
  ratePerSqFt: number;
  totalAdjustmentPct: number;
  adjustedRate: number;       // INR per sq.ft. after all adjustments
}

export interface MarketComparisonResult {
  comparables: AdjustedComparable[];
  minAdjustedRate: number;
  maxAdjustedRate: number;
  simpleAvgRate: number;
  correlatedRate: number;     // weighted: closest adjustments get more weight
  correlatedValue: number;    // correlatedRate × subject area (rounded to 1000)
  subjectAreaSqFt: number;
}

export function computeMarketComparison(
  comparables: ComparableSaleInput[],
  subjectAreaSqFt: number,
  userCorrelatedValue?: number,   // RV can override the computed correlation
): MarketComparisonResult {
  if (comparables.length === 0) {
    throw new Error('At least one comparable sale is required');
  }

  const adjusted: AdjustedComparable[] = comparables.map((c) => {
    const ratePerSqFt = c.salePrice / c.totalArea;

    // Sum all percentage adjustments
    const totalAdj =
      (c.adjustmentTime ?? 0) +
      (c.adjustmentLocation ?? 0) +
      (c.adjustmentSize ?? 0) +
      (c.adjustmentCondition ?? 0) +
      (c.adjustmentAmenities ?? 0);

    // Apply net adjustment (positive = subject is superior → rate goes up)
    const adjustedRate = Math.round(ratePerSqFt * (1 + totalAdj / 100));

    return {
      address: c.address,
      locality: c.locality,
      transactionDate: c.transactionDate,
      totalArea: c.totalArea,
      salePrice: c.salePrice,
      ratePerSqFt: Math.round(ratePerSqFt),
      totalAdjustmentPct: totalAdj,
      adjustedRate,
    };
  });

  const rates = adjusted.map((a) => a.adjustedRate);
  const minAdjustedRate = Math.min(...rates);
  const maxAdjustedRate = Math.max(...rates);
  const simpleAvgRate = Math.round(rates.reduce((s, r) => s + r, 0) / rates.length);

  // Weighted correlation: comparables with smaller net adjustment are more reliable
  // Weight = 1 / (1 + |totalAdjPct|)
  const weights = adjusted.map((a) => 1 / (1 + Math.abs(a.totalAdjustmentPct)));
  const weightSum = weights.reduce((s, w) => s + w, 0);
  const weightedRate = rates.reduce((s, r, i) => s + r * (weights[i] ?? 0), 0) / weightSum;
  const correlatedRate = Math.round(weightedRate);

  const rawValue = userCorrelatedValue ?? correlatedRate * subjectAreaSqFt;
  const correlatedValue = Math.round(rawValue / 1000) * 1000;

  return {
    comparables: adjusted,
    minAdjustedRate,
    maxAdjustedRate,
    simpleAvgRate,
    correlatedRate,
    correlatedValue,
    subjectAreaSqFt,
  };
}
