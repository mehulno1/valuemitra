import { db, type Tx } from '../../db/index.js';
import { activeConfig, configById } from '../../platform/config.js';

export interface Rules {
  realizable_pct: number;
  distress_pct: number;
  loading_pct: number;
  saleable_factor: number;
  building_cost_per_sqft: number;
  rental_yield_pct: number;
  building_life_years: number;
  salvage_pct: number;
  depreciation: string;
  gv_variation_pct: number;
  rate_deviation_pct: number;
  comparable_window_months: number;
  comparable_radius_km: number;
  listing_discount_pct: number;
  value_rounding_step: number;
  rate_rounding_step: number;
  rent_rounding_step: number;
  measured_area_tolerance_pct: number;
  size_adjustments: { min_ratio?: number; max_ratio?: number; pct: number }[];
  quality_adjustments: { newer_or_lift_pct: number; older_pct: number };
  source_weights: Record<string, number>;
  subject_registration_weight: number;
  [k: string]: unknown;
}

export interface RuleSetPayload {
  defaults: Rules;
  banks: Record<string, Partial<Rules>>;
}

/** The rule values that apply to one bank: firm defaults overlaid with that bank's overrides. */
export function rulesFor(payload: RuleSetPayload, bankCode: string): Rules {
  return { ...payload.defaults, ...(payload.banks?.[bankCode] ?? {}) } as Rules;
}

export async function rulesForVersion(versionId: number, bankCode: string, tx: Tx = db) {
  const v = await configById<RuleSetPayload>(versionId, tx);
  return rulesFor(v.payload, bankCode);
}

export async function activeRuleSet(firmId: number, tx: Tx = db) {
  return activeConfig<RuleSetPayload>('rule_set', 'firm', firmId, tx);
}
