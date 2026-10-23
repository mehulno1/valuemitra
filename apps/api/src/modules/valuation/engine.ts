// Pure valuation maths: comparable adjustment and weighting, the evidence-backed proposal, and the
// values each method produces. Everything tunable comes from the pinned rule set.
import type { Rules } from '../master/rules.js';

export interface ComparableIn {
  id: number;
  isSubject: boolean;
  sourceType: string;
  isAsking: boolean;
  areaBua: number;
  price: number;
  txnDate: Date | null;
  hasLift: boolean | null;
  buildingAge: number | null;
  distanceKm: number | null;
  override?: { adjustments?: Adjustment[]; weight?: number; included?: boolean } | null;
}

export interface Adjustment { code: string; label: string; pct: number }

export interface ComparableOut {
  id: number;
  rate: number;
  adjustments: Adjustment[];
  adjustedRate: number;
  ageMonths: number | null;
  weight: number;
  weightLabel: 'High' | 'Medium' | 'Low';
  included: boolean;
  exclusionReason: string | null;
  oldFlag: boolean;
  guidance: boolean;
}

export interface Subject {
  area: number;
  hasLift: boolean | null;
  buildingAge: number | null;
  valuationDate: Date;
}

const months = (a: Date, b: Date) => (b.getTime() - a.getTime()) / (30.4375 * 86400_000);

export function adjustComparable(c: ComparableIn, s: Subject, r: Rules): ComparableOut {
  const rate = c.price / c.areaBua;
  const adj: Adjustment[] = [];
  if (!c.isSubject) {
    if (c.isAsking) adj.push({ code: 'listing', label: 'Listing (asking price)', pct: -r.listing_discount_pct });
    const ratio = c.areaBua / s.area;
    const band = r.size_adjustments.find((b) => (b.min_ratio === undefined || ratio >= b.min_ratio) && (b.max_ratio === undefined || ratio < b.max_ratio));
    if (band && band.pct) adj.push({ code: 'size', label: ratio > 1 ? 'Larger unit' : 'Smaller unit', pct: band.pct });
    const newer = c.buildingAge !== null && s.buildingAge !== null && s.buildingAge - c.buildingAge >= 10;
    const older = c.buildingAge !== null && s.buildingAge !== null && c.buildingAge - s.buildingAge >= 10;
    if (newer || (c.hasLift && s.hasLift === false)) adj.push({ code: 'quality', label: newer ? 'Newer building' : 'Building with lift', pct: r.quality_adjustments.newer_or_lift_pct });
    else if (older) adj.push({ code: 'quality', label: 'Older building', pct: r.quality_adjustments.older_pct });
  }
  const adjustments = c.override?.adjustments ?? adj;
  const adjustedRate = adjustments.reduce((x, a) => x * (1 + a.pct / 100), rate);
  const ageMonths = c.txnDate ? Math.max(0, months(c.txnDate, s.valuationDate)) : null;
  const window = r.comparable_window_months;
  let included = true;
  let reason: string | null = null;
  if (ageMonths !== null && ageMonths > window * 2) { included = false; reason = `Older than ${window * 2} months`; }
  if (c.distanceKm !== null && c.distanceKm > r.comparable_radius_km) { included = false; reason = `More than ${r.comparable_radius_km} km away`; }
  if (c.override?.included !== undefined) { included = c.override.included; reason = included ? null : reason ?? 'Excluded by valuer'; }
  // earlier reports of the firm are guidance for the valuer, never evidence for the rate or the printed range
  const guidance = !c.isSubject && (r.guidance_only_sources ?? ['own_report']).includes(c.sourceType);
  if (guidance) { included = false; reason = 'Guidance only: not used for the rate or the range'; }
  const recency = ageMonths === null || ageMonths <= window ? 1 : 0.5;
  const similarity = 1 - Math.min(Math.abs(Math.log(c.areaBua / s.area)), 1) * 0.5;
  let weight = (r.source_weights[c.sourceType] ?? 0.6) * recency * similarity * (c.isSubject ? r.subject_registration_weight : 1);
  if (c.override?.weight !== undefined) weight = c.override.weight;
  return {
    id: c.id, rate, adjustments, adjustedRate, ageMonths, weight, included, exclusionReason: reason,
    weightLabel: weight >= 0.8 ? 'High' : weight >= 0.4 ? 'Medium' : 'Low',
    oldFlag: ageMonths !== null && ageMonths > window && included,
    guidance,
  };
}

function weightedQuantile(items: { v: number; w: number }[], q: number) {
  const s = [...items].sort((a, b) => a.v - b.v);
  const total = s.reduce((t, x) => t + x.w, 0);
  let acc = 0;
  for (const x of s) { acc += x.w; if (acc >= total * q) return x.v; }
  return s[s.length - 1].v;
}

export interface Proposal {
  rate: number;
  lo: number;
  hi: number;
  n: number;
  anchors: { id: number; adjustedRate: number; weightLabel: string }[];
  listingsAverage: number | null;
}

/** Weighted median of included comparables; range = weighted IQR widened to at least ±3%. */
export function propose(cs: (ComparableOut & { isSubject?: boolean; sourceType?: string })[], r: Rules): Proposal | null {
  const inc = cs.filter((c) => c.included && c.weight > 0);
  if (!inc.length) return null;
  const items = inc.map((c) => ({ v: c.adjustedRate, w: c.weight }));
  const step = r.rate_rounding_step || 100;
  const rate = Math.round(weightedQuantile(items, 0.5) / step) * step;
  const lo = Math.floor(Math.min(weightedQuantile(items, 0.25), rate * 0.97) / step) * step;
  const hi = Math.ceil(Math.max(weightedQuantile(items, 0.75), rate * 1.03) / step) * step;
  const listings = inc.filter((c) => c.sourceType === 'listing');
  return {
    rate, lo, hi, n: inc.length,
    anchors: [...inc].sort((a, b) => b.weight - a.weight).slice(0, 2).map((c) => ({ id: c.id, adjustedRate: Math.round(c.adjustedRate), weightLabel: c.weightLabel })),
    listingsAverage: listings.length ? Math.round(listings.reduce((t, c) => t + c.adjustedRate, 0) / listings.length) : null,
  };
}

export interface Extra { code: string; label: string; qty?: number; rate?: number; amount?: number }

export interface ValuationInput {
  method: 'market_comparison' | 'cost' | 'land_building';
  basisArea: number;
  rate: number;
  extras: Extra[];
  bua: number | null;
  // cost approach
  plotArea?: number | null;
  landRate?: number | null;
  buildingAge?: number | null;
}

export interface ValuesOut {
  unit: number;
  parking: number;
  interior: number;
  others: number;
  extrasTotal: number;
  fmv: number;
  realizable: number;
  distress: number;
  insurable: number | null;
  rent: number;
  land?: number;
  building?: number;
  depreciation_pct?: number;
  lines: { label: string; working: string; amount: number }[];
}

const roundTo = (x: number, step: number) => Math.round(x / (step || 1)) * (step || 1);
const amt = (e: Extra) => e.amount ?? (e.qty ?? 1) * (e.rate ?? 0);

export function computeValues(v: ValuationInput, r: Rules): ValuesOut {
  const lines: ValuesOut['lines'] = [];
  let unit: number;
  let land: number | undefined;
  let building: number | undefined;
  let depPct: number | undefined;
  if (v.method === 'market_comparison') {
    unit = v.basisArea * v.rate;
    lines.push({ label: 'Present value of the unit', working: `${v.basisArea} sq.ft. × Rs. ${v.rate}`, amount: unit });
  } else {
    // land + depreciated building (bungalow / L&B); depreciation straight-line by default
    land = (v.plotArea ?? 0) * (v.landRate ?? 0);
    const age = v.buildingAge ?? 0;
    const life = r.building_life_years;
    depPct = Math.min(age / life, 1) * (1 - r.salvage_pct / 100) * 100;
    building = (v.bua ?? 0) * r.building_cost_per_sqft * (1 - depPct / 100);
    unit = land + building;
    lines.push({ label: 'Land', working: `${v.plotArea} sq.ft. × Rs. ${v.landRate}`, amount: land });
    lines.push({ label: 'Building (depreciated)', working: `${v.bua} sq.ft. × Rs. ${r.building_cost_per_sqft} × (1 − ${depPct.toFixed(1)}%)`, amount: building });
  }
  const get = (code: string) => v.extras.filter((e) => e.code === code).reduce((t, e) => t + amt(e), 0);
  const parking = get('parking');
  const interior = get('interior');
  const others = v.extras.filter((e) => !['parking', 'interior'].includes(e.code)).reduce((t, e) => t + amt(e), 0);
  for (const e of v.extras) lines.push({ label: e.label, working: e.amount !== undefined ? 'lump sum' : `${e.qty ?? 1} × Rs. ${e.rate ?? 0}`, amount: amt(e) });
  const fmv = roundTo(unit + parking + interior + others, r.value_rounding_step);
  return {
    unit: roundTo(unit, r.value_rounding_step), parking, interior, others, extrasTotal: parking + interior + others, fmv,
    realizable: roundTo((fmv * r.realizable_pct) / 100, r.value_rounding_step),
    distress: roundTo((fmv * r.distress_pct) / 100, r.value_rounding_step),
    insurable: v.bua ? roundTo(v.bua * r.building_cost_per_sqft, r.value_rounding_step) : null,
    rent: roundTo((fmv * r.rental_yield_pct) / 100 / 12, r.rent_rounding_step),
    land, building, depreciation_pct: depPct, lines,
  };
}
