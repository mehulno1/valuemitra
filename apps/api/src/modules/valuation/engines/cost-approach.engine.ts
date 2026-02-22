/**
 * Cost Approach Valuation Engine
 * Formula: Property Value = Land Value + Depreciated Building Value + Services Cost
 *
 * Used for residential, commercial, and industrial properties.
 * Land rate sourced from GovernmentRate (ASR/Jantri) or market evidence.
 */

import { calculateDepreciation } from './depreciation.engine.js';
import { DepreciationMethod } from '@valuemitra/shared';
import type { UpdateCostApproachInput } from '@valuemitra/shared';

export interface CostApproachResult {
  // Land
  landArea: number;             // sq.m.
  landRatePerSqM: number;
  landValue: number;            // INR

  // Building
  buildingPlinthArea: number;   // sq.m.
  buildingRatePerSqM: number;   // CPWD replacement cost rate
  replacementCost: number;      // INR
  depreciationMethod: DepreciationMethod;
  depreciationRate: number;     // Decimal
  depreciationAmount: number;   // INR
  depreciatedValue: number;     // INR

  // Services (water, sanitation, electrification — % of replacement cost)
  servicesCost: number;

  // Total
  costApproachValue: number;    // INR (rounded to nearest 1000)
}

export function computeCostApproach(input: UpdateCostApproachInput): CostApproachResult {
  const {
    landArea = 0,
    landRatePerSqM = 0,
    buildingPlinthArea = 0,
    buildingRatePerSqM = 0,
    ageYears = 0,
    totalLifeYears = 60,
    depreciationMethod = DepreciationMethod.STRAIGHT_LINE,
    wdvRate,
    observedCondition,
    servicesCostPercent = 5,
  } = input;

  // ── Land value ────────────────────────────────────────────────────────────
  const landValue = Math.round(landArea * landRatePerSqM);

  // ── Building replacement cost ────────────────────────────────────────────
  const replacementCost = Math.round(buildingPlinthArea * buildingRatePerSqM);

  // ── Depreciation ─────────────────────────────────────────────────────────
  const deprResult = calculateDepreciation({
    method: depreciationMethod,
    replacementCost,
    ageYears,
    totalLifeYears,
    wdvRate,
    observedCondition,
  });

  // ── Services cost (external services: water, sewage, power, road) ────────
  const servicesCost = Math.round(replacementCost * (servicesCostPercent / 100));

  // ── Total ─────────────────────────────────────────────────────────────────
  const rawTotal = landValue + deprResult.depreciatedValue + servicesCost;
  const costApproachValue = Math.round(rawTotal / 1000) * 1000;

  return {
    landArea,
    landRatePerSqM,
    landValue,
    buildingPlinthArea,
    buildingRatePerSqM,
    replacementCost,
    depreciationMethod,
    depreciationRate: deprResult.depreciationRate,
    depreciationAmount: deprResult.depreciationAmount,
    depreciatedValue: deprResult.depreciatedValue,
    servicesCost,
    costApproachValue,
  };
}
