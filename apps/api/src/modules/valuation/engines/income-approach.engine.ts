/**
 * Income Approach (Capitalisation of Net Income) Engine
 * Formula: Value = Net Operating Income / Capitalisation Rate
 *
 * Used primarily for commercial and rental properties.
 */

import type { UpdateIncomeApproachInput } from '@valuemitra/shared';

export interface IncomeApproachResult {
  grossRentAnnual: number;          // INR
  vacancyLoss: number;              // INR
  effectiveGrossIncome: number;     // INR
  operatingExpenses: number;        // INR
  netOperatingIncome: number;       // INR
  capitalizationRate: number;       // Decimal (e.g. 0.08 = 8%)
  incomeApproachValue: number;      // INR (rounded to 1000)
}

export function computeIncomeApproach(input: UpdateIncomeApproachInput): IncomeApproachResult {
  const { grossRent, vacancyRate, operatingExpenses, capitalizationRate } = input;

  const grossRentAnnual = Math.round(grossRent * 12);
  const vacancyLoss = Math.round(grossRentAnnual * vacancyRate);
  const effectiveGrossIncome = grossRentAnnual - vacancyLoss;
  const netOperatingIncome = Math.max(effectiveGrossIncome - operatingExpenses, 0);

  const rawValue = netOperatingIncome / capitalizationRate;
  const incomeApproachValue = Math.round(rawValue / 1000) * 1000;

  return {
    grossRentAnnual,
    vacancyLoss,
    effectiveGrossIncome,
    operatingExpenses,
    netOperatingIncome,
    capitalizationRate,
    incomeApproachValue,
  };
}
