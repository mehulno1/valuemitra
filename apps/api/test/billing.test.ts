import { describe, expect, it } from 'vitest';
import { creditSplit, taxSplit } from '../src/modules/billing/tax.js';

describe('GST on invoices', () => {
  it('splits CGST and SGST within the state', () => {
    expect(taxSplit(3000, 18, true)).toEqual({ cgst: 270, sgst: 270, igst: 0, round_off: 0, total: 3540 });
  });
  it('charges IGST for a place of supply in another state', () => {
    expect(taxSplit(9000, 18, false)).toEqual({ cgst: 0, sgst: 0, igst: 1620, round_off: 0, total: 10620 });
  });
  it('rounds the total to the rupee and records the round off', () => {
    const t = taxSplit(2777, 18, true); // GST 499.86
    expect(t.cgst).toBe(249.93);
    expect(t.total).toBe(3277);
    expect(t.round_off).toBe(0.14);
  });
  it('reverses GST in proportion on a part credit note, exactly on a full one', () => {
    const inv = { total: 3540, taxable: 3000, cgst: 270, sgst: 270, igst: 0, gst_rate: 18 };
    expect(creditSplit(3540, inv)).toEqual({ taxable: 3000, cgst: 270, sgst: 270, igst: 0 });
    const part = creditSplit(1180, inv);
    expect(part).toEqual({ taxable: 1000, cgst: 90, sgst: 90, igst: 0 });
    expect(creditSplit(1180, { ...inv, cgst: 0, sgst: 0, igst: 540 }).igst).toBe(180);
  });
});
