// GST arithmetic for invoices and credit notes (pure; unit-tested).
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Tax split for a taxable value: CGST + SGST within the firm's state, IGST otherwise; total rounded to the rupee. */
export function taxSplit(taxable: number, rate: number, intra: boolean) {
  const gst = (taxable * rate) / 100;
  const cgst = intra ? r2(gst / 2) : 0;
  const sgst = intra ? r2(gst / 2) : 0;
  const igst = intra ? 0 : r2(gst);
  const gross = taxable + cgst + sgst + igst;
  const total = Math.round(gross);
  return { cgst, sgst, igst, round_off: r2(total - gross), total };
}

/** A credit note for part of an invoice reverses GST in proportion; for the whole, exactly what was charged. */
export function creditSplit(amount: number, inv: { total: number; taxable: number; cgst: number; sgst: number; igst: number; gst_rate: number }) {
  if (Math.abs(amount - inv.total) <= 0.5) return { taxable: inv.taxable, cgst: inv.cgst, sgst: inv.sgst, igst: inv.igst };
  const taxable = r2(amount / (1 + inv.gst_rate / 100));
  const g = r2(amount - taxable);
  return inv.igst > 0 ? { taxable, cgst: 0, sgst: 0, igst: g } : { taxable, cgst: r2(g / 2), sgst: r2(g - r2(g / 2)), igst: 0 };
}
