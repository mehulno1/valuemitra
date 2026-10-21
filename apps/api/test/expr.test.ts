import { describe, expect, it } from 'vitest';
import { evalExpr, identifiers, interpolate, parse } from '@vm/shared';

const ctx: Record<string, unknown> = { 'AREA.BUA': 465, 'RULE.loading_pct': 20, 'VAL.FMV': 6975000, 'VAL.GUIDELINE': 5374030, L: ['Agreement', 'O.C'], E: [], NAME: 'Mr. Rohan' };
const r = (n: string) => (Object.hasOwn(ctx, n) ? ctx[n] : null);

describe('config expressions', () => {
  it('derives carpet area from BUA and loading', () => {
    expect(evalExpr('round(AREA.BUA / (1 + RULE.loading_pct / 100))', r)).toBe(388);
  });
  it('propagates missing inputs as null (pending)', () => {
    expect(evalExpr('AREA.CARPET * 1.4', r)).toBeNull();
    expect(evalExpr('MISSING > 3', r)).toBe(false);
  });
  it('evaluates the guideline variation trigger', () => {
    expect(evalExpr('abs(VAL.FMV - VAL.GUIDELINE) / VAL.GUIDELINE >= 20 / 100', r)).toBe(true);
    expect(evalExpr('pct((VAL.FMV - VAL.GUIDELINE) / VAL.GUIDELINE)', r)).toBe('30%');
  });
  it('treats words as text, numbers in text as numbers', () => {
    expect(evalExpr("' We ' + join(L, ', ')", r)).toBe(' We Agreement, O.C');
    expect(evalExpr("'Rs. 59,60,000/-' + 0", r)).toBe(5960000);
    expect(evalExpr("len(E) > 0 ? 'x' : ''", r)).toBe('');
    expect(evalExpr("', ' + 4 + ' flats per floor'", r)).toBe(', 4 flats per floor');
  });
  it('interpolates wording and reports pending blocks', () => {
    expect(interpolate('Name: {{NAME}}', r)).toBe('Name: Mr. Rohan');
    expect(interpolate('Area {{AREA.CARPET}}', r)).toBeNull();
  });
  it('lists identifiers and rejects bad syntax', () => {
    expect(identifiers('round(AREA.BUA * RULE.x)').sort()).toEqual(['AREA.BUA', 'RULE.x']);
    expect(() => parse('a +')).toThrow();
    expect(() => evalExpr('nope(1)', r)).toThrow(/Unknown function/);
  });
  it('has no access to JavaScript globals', () => {
    expect(evalExpr('constructor', r)).toBeNull();
    expect(evalExpr('process', r)).toBeNull();
  });
});
