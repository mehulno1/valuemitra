/**
 * Depreciation Calculator
 * Supports Straight-Line, Written-Down Value, Observed Condition, and CPWD Schedule methods.
 * All IBBI-compliant; results stored in ValuationRun for audit trail.
 */

import type { DepreciationInput, DepreciationOutput } from '@valuemitra/shared';
import { DepreciationMethod } from '@valuemitra/shared';

// CPWD Schedule-of-Rates depreciation table (useful life by structure type)
// Source: CPWD Plinth Area Rates (2021) + standard engineering practice
const CPWD_TOTAL_LIFE_YEARS: Record<string, number> = {
  RCC_FRAMED: 60,
  LOAD_BEARING: 50,
  STEEL: 55,
  PREFAB: 30,
  TEMPORARY: 20,
  DEFAULT: 60,
};

// Observed condition → implied depreciation %
const CONDITION_DEPRECIATION: Record<string, number> = {
  EXCELLENT: 0.05,
  GOOD: 0.15,
  FAIR: 0.30,
  POOR: 0.50,
  VERY_POOR: 0.70,
};

export function calculateDepreciation(input: DepreciationInput): DepreciationOutput {
  const {
    method,
    replacementCost,
    ageYears,
    totalLifeYears,
    wdvRate,
    observedCondition,
  } = input;

  let depreciationRate: number;
  let remainingLifeYears: number;

  switch (method) {
    case DepreciationMethod.STRAIGHT_LINE: {
      // dep% = age / totalLife  (capped at 80% to preserve scrap value)
      const rawRate = ageYears / totalLifeYears;
      depreciationRate = Math.min(rawRate, 0.80);
      remainingLifeYears = Math.max(totalLifeYears - ageYears, 0);
      break;
    }

    case DepreciationMethod.WDV: {
      // Written-Down Value: value = cost × (1 - r)^age
      const rate = wdvRate ?? 0.05;
      const residualFactor = Math.pow(1 - rate, ageYears);
      depreciationRate = Math.min(1 - residualFactor, 0.80);
      remainingLifeYears = Math.max(totalLifeYears - ageYears, 0);
      break;
    }

    case DepreciationMethod.OBSERVED: {
      // Based on physical inspection of condition
      depreciationRate = CONDITION_DEPRECIATION[observedCondition ?? 'FAIR'] ?? 0.30;
      remainingLifeYears = Math.max(totalLifeYears - ageYears, 0);
      break;
    }

    case DepreciationMethod.CPWD_SCHEDULE: {
      // CPWD: straight-line with structure-type life; capped at 80%
      const cpwdLife = CPWD_TOTAL_LIFE_YEARS['DEFAULT'] ?? 60;
      const rawRate = ageYears / cpwdLife;
      depreciationRate = Math.min(rawRate, 0.80);
      remainingLifeYears = Math.max(cpwdLife - ageYears, 0);
      break;
    }

    default:
      depreciationRate = 0;
      remainingLifeYears = totalLifeYears;
  }

  const depreciationAmount = Math.round(replacementCost * depreciationRate);
  const depreciatedValue = Math.max(replacementCost - depreciationAmount, 0);

  return {
    depreciationRate,
    depreciationAmount,
    depreciatedValue,
    remainingLifeYears,
    method,
  };
}
