import { describe, expect, it } from 'vitest';
import { EXPR_FNS, isPlaceholder } from '../src/modules/casedata/resolver.js';

describe('13 Nov re-test rules', () => {
  it('treats words typed to get past a screen as no value', () => {
    for (const v of ['NA', 'N.A', 'n/a', '0', 'Ok', '-', 'Not provided', 'Not provided (clear copy required)']) expect(isPlaceholder(v)).toBe(true);
    for (const v of ['Road', '37.36 sq.m.', 'Building is completed as per O.C.', 'Yes']) expect(isPlaceholder(v)).toBe(false);
    expect(isPlaceholder('no', 'answers')).toBe(true);
  });
  it('reads a name board answer', () => {
    expect(EXPR_FNS.yes_no('no')).toBe('No');
    expect(EXPR_FNS.yes_no('Name not displayed')).toBe('No');
    expect(EXPR_FNS.yes_no('Yes')).toBe('Yes');
    expect(EXPR_FNS.yes_no('Flat number displayed on the board')).toBe('Yes');
    expect(EXPR_FNS.yes_no('')).toBe(null);
  });
  it('finds the village in an address and the sq.m. figure in a text', () => {
    expect(EXPR_FNS.village_from('Flat 301, Morya Heights, Village Vasind, Tal. Shahapur, Dist. Thane')).toBe('Vasind');
    expect(EXPR_FNS.village_from('Survey No. 52, Village Gauripada, Taluka Kalyan')).toBe('Gauripada');
    expect(EXPR_FNS.village_from('Thane (W)')).toBe(null);
    expect(EXPR_FNS.first_sqm('37.36 sq.m. (RERA carpet) + balcony 2.77 sq.m.')).toBe(37.36);
  });
  it('tells a builder from a person', () => {
    expect(EXPR_FNS.is_company('M/s. Morya Developers')).toBe(true);
    expect(EXPR_FNS.is_company('Vijay Grihanirman Private Limited')).toBe(true);
    expect(EXPR_FNS.is_company('Mr. Vasudev Parameswaran')).toBe(false);
  });
});
