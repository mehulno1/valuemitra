import { describe, expect, it } from 'vitest';
import { adjustComparable, computeValues, flagOutliers, floorNo, propose, toBua, type ComparableIn } from '../src/modules/valuation/engine';
import { parseLatLng, mapCoords } from '../src/lib/coords';
import { RULE_SET } from '../src/seed/config';
import { rulesFor } from '../src/modules/master/rules';
import { amountInWords, inr } from '@vm/shared';

const r = rulesFor(RULE_SET as any, 'SBI');
const subject = { area: 465, hasLift: false, buildingAge: 35, valuationDate: new Date('2026-03-04') };
const C = (id: number, o: Partial<ComparableIn>): ComparableIn => ({ id, isSubject: false, sourceType: 'listing', isAsking: true, areaBua: 0, price: 0, txnDate: new Date('2026-03-01'), hasLift: null, buildingAge: null, distanceKm: null, ...o });

// the prototype's five comparables (Thane flat, SBI Format-A)
const comps = [
  C(1, { isSubject: true, sourceType: 'index2', isAsking: false, areaBua: 465, price: 5960000, txnDate: new Date('2026-03-02') }),
  C(2, { sourceType: 'index2', isAsking: false, areaBua: 570, price: 7350000, txnDate: new Date('2025-04-17') }),
  C(3, { areaBua: 522, price: 7500000, hasLift: true }),
  C(4, { areaBua: 840, price: 8000000 }),
  C(5, { areaBua: 894, price: 9700000 }),
];

describe('evidence-backed rate', () => {
  const out = comps.map((c) => ({ ...adjustComparable(c, subject, r), sourceType: c.sourceType }));
  it('adjusts like the prototype', () => {
    expect(Math.round(out[1].adjustedRate)).toBe(13153); // size +2%
    expect(Math.round(out[2].adjustedRate)).toBe(12967); // listing -5%, lift -5%
    expect(Math.round(out[3].adjustedRate)).toBe(9771);  // listing -5%, size +8%
    expect(Math.round(out[4].adjustedRate)).toBe(11132);
    expect(out.map((o) => o.weightLabel)).toEqual(['High', 'Medium', 'Medium', 'Low', 'Low']);
    expect(out[1].oldFlag).toBe(true);
  });
  it('proposes 12,800 with a range around it', () => {
    const p = propose(out, r)!;
    expect(p.rate).toBe(12800);
    expect(p.lo).toBeLessThanOrEqual(12400);
    expect(p.hi).toBeGreaterThanOrEqual(13100);
    expect(p.listingsAverage).toBe(11290);
  });
});

describe('earlier reports of the firm', () => {
  it('are guidance only: never in the rate or the range, even if the valuer includes them', () => {
    const own = C(9, { sourceType: 'own_report', isAsking: false, areaBua: 465, price: 6975000, override: { included: true } });
    const out = [...comps, own].map((c) => ({ ...adjustComparable(c, subject, r), sourceType: c.sourceType }));
    expect(out[5].included).toBe(false);
    expect(out[5].guidance).toBe(true);
    expect(propose(out, r)!.rate).toBe(12800);
    expect(propose([out[5]], r)).toBeNull();
  });
});

describe('values', () => {
  it('matches the prototype at Rs. 15,000', () => {
    const v = computeValues({ method: 'market_comparison', basisArea: 465, rate: 15000, extras: [], bua: 465 }, r);
    expect(v.fmv).toBe(6975000);
    expect(v.realizable).toBe(6277500);
    expect(v.distress).toBe(5580000);
    expect(v.insurable).toBe(697500);
    expect(v.rent).toBe(17500);
    expect(inr(v.fmv)).toBe('69,75,000');
    expect(amountInWords(5952000)).toBe('Rupees Fifty Nine Lakh Fifty Two Thousand Only');
  });
  it('uses the bank rule for realizable', () => {
    const v = computeValues({ method: 'market_comparison', basisArea: 465, rate: 12800, extras: [], bua: 465 }, rulesFor(RULE_SET as any, 'UBI'));
    expect(v.realizable).toBe(Math.round(5952000 * 0.95));
  });
});

describe('area basis', () => {
  // derivations as in the dictionary: STATED.X is a value stated in a document, never one worked out
  const FIELDS = (async () => (await import('../src/seed/fields')).FIELDS)();
  const derive = async (stated: Record<string, number>) => {
    const { evalExpr } = await import('@vm/shared');
    const f = await FIELDS;
    const expr = (code: string) => f.find((x: any) => x.code === code)!.derivation!;
    const res = (n: string) => (n.startsWith('STATED.') ? stated[n.slice(7)] ?? null : n.startsWith('RULE.') ? (r as any)[n.slice(5)] : null);
    const out: Record<string, unknown> = {};
    for (const c of ['AREA.CARPET', 'AREA.BUA', 'AREA.SALEABLE']) out[c] = stated[c] ?? evalExpr(expr(c), res);
    return out;
  };
  it('works out the other areas from any one stated area', async () => {
    expect(await derive({ 'AREA.CARPET': 610 })).toEqual({ 'AREA.CARPET': 610, 'AREA.BUA': 732, 'AREA.SALEABLE': 854 });
    expect(await derive({ 'AREA.BUA': 732 })).toEqual({ 'AREA.CARPET': 610, 'AREA.BUA': 732, 'AREA.SALEABLE': 854 });
    expect(await derive({ 'AREA.SALEABLE': 854 })).toEqual({ 'AREA.CARPET': 610, 'AREA.BUA': 732, 'AREA.SALEABLE': 854 });
  });
  it('keeps a stated figure over a worked-out one', async () => {
    expect(await derive({ 'AREA.CARPET': 610, 'AREA.BUA': 750 })).toEqual({ 'AREA.CARPET': 610, 'AREA.BUA': 750, 'AREA.SALEABLE': 854 });
  });
  it('prints the working in the chosen unit', () => {
    const v = computeValues({ method: 'market_comparison', basisArea: 56.67, rate: 150000, unitLabel: 'sq.m.', extras: [], bua: 732 }, r);
    expect(v.lines[0].working).toBe('56.67 sq.m. × Rs. 150000');
    expect(v.unit).toBe(8500500);
  });
});

describe('outliers and floors', () => {
  const sub = { ...subject, hasLift: true, floor: 3 };
  const base = [12000, 12500, 12800, 13200].map((rate, i) => C(i + 1, { sourceType: 'index2', isAsking: false, areaBua: 465, price: 465 * rate }));
  it('highlights a comparable far from the median and still uses it by default', () => {
    const tower = C(9, { sourceType: 'index2', isAsking: false, areaBua: 465, price: 465 * 33333 });
    const out = flagOutliers([...base, tower].map((c) => ({ ...adjustComparable(c, sub, r), isSubject: false })), r);
    const t = out.find((x) => x.id === 9)!;
    expect(t.included).toBe(true);
    expect(t.outlier).toBe(true);
    expect(t.exclusionReason).toMatch(/^Outlier: \d+% above the median\. Used/);
    expect(out.filter((x) => x.outlier).length).toBe(1);
  });
  it('leaves out an outlier when the bank rule says so, unless the valuer included it', () => {
    const r = { ...rulesFor(RULE_SET as any, 'SBI'), outlier_action: 'exclude' as const };
    const tower = C(9, { sourceType: 'index2', isAsking: false, areaBua: 465, price: 465 * 33333 });
    const out = flagOutliers([...base, tower].map((c) => ({ ...adjustComparable(c, sub, r), isSubject: false })), r);
    expect(out.find((x) => x.id === 9)!.included).toBe(false);
    expect(out.find((x) => x.id === 9)!.exclusionReason).toMatch(/^Outlier/);
    expect(out.filter((x) => x.included).length).toBe(4);
    const kept = flagOutliers([...base, { ...tower, override: { included: true } }].map((c) => ({ ...adjustComparable(c, sub, r), isSubject: false })), r);
    expect(kept.find((x) => x.id === 9)!.included).toBe(true);
  });
  it('adjusts for the floor in a lift building, capped', () => {
    const lower = adjustComparable(C(1, { sourceType: 'index2', isAsking: false, areaBua: 465, price: 465 * 12000, floor: 1 }), sub, r);
    expect(lower.adjustments.find((a) => a.code === 'floor')?.pct).toBe(1);
    const far = adjustComparable(C(2, { sourceType: 'index2', isAsking: false, areaBua: 465, price: 465 * 12000, floor: 30 }), sub, r);
    expect(far.adjustments.find((a) => a.code === 'floor')?.pct).toBe(-5);
    const noLift = adjustComparable(C(3, { sourceType: 'index2', isAsking: false, areaBua: 465, price: 465 * 12000, floor: 1 }), { ...sub, hasLift: false }, r);
    expect(noLift.adjustments.some((a) => a.code === 'floor')).toBe(false);
  });
  it('reads floor numbers', () => {
    expect([floorNo('3rd Floor'), floorNo('Ground floor'), floorNo('7'), floorNo(null)]).toEqual([3, 0, 7, null]);
  });
});

describe('stated areas as built-up', () => {
  it('converts carpet and saleable by the bank factors', () => {
    expect(toBua(500, 'carpet', r)).toBeCloseTo(600);
    expect(toBua(700, 'saleable', r)).toBeCloseTo(600);
    expect(toBua(612, 'bua', r)).toBe(612);
  });
});

describe('map coordinates', () => {
  it('reads Google Maps degrees-minutes-seconds', () => {
    expect(parseLatLng(`19°11'29.2"N 73°10'43.6"E`)).toEqual({ lat: 19.191444, lng: 73.178778 });
    expect(parseLatLng('19°11′29.2″N 73°10′43.6″E')).toEqual({ lat: 19.191444, lng: 73.178778 });
  });
  it('reads degrees and decimal minutes, south / west, and decimal pairs', () => {
    expect(parseLatLng(`N 19° 11.487' E 73° 10.727'`)).toEqual({ lat: 19.19145, lng: 73.178783 });
    expect(parseLatLng(`33°52'10.0"S 151°12'30.0"E`)!.lat).toBeCloseTo(-33.869444, 5);
    expect(parseLatLng('Dropped pin 19.191923, 73.178782')).toEqual({ lat: 19.191923, lng: 73.178782 });
  });
  it('ignores text without coordinates and prefers the text over worked-out numbers', () => {
    expect(parseLatLng('55RH+MFX, Barkupada Rd, Pale Gaon, Ambernath 421506')).toBeNull();
    expect(mapCoords(null, 19.19, 73.17)).toEqual({ lat: 19.19, lng: 73.17 });
    expect(mapCoords(`19°11'29.2"N 73°10'43.6"E`, 1, 2)).toEqual({ lat: 19.191444, lng: 73.178778 });
    expect(mapCoords(null, null, null)).toBeNull();
  });
});
