// Accounting exports for a period (tax invoices only; proformas are not accounting documents):
// Tally sales / credit note / receipt vouchers (XML), Zoho Books invoice import (CSV), generic CSV
// of invoices, receipts and credit notes, GSTR-1 sections (B2B, B2C small, credit notes, SAC
// summary) and TDS by party for matching with Form 26AS. Each format is to be validated with a
// sample import into the firm's software before relying on it.
import { gstStateName } from '@vm/shared';
import { db } from '../../db/index.js';
import { badRequest } from '../../lib/errors.js';
import { getSettings } from '../../platform/settings.js';
import { listInvoices, ymd } from './service.js';

export const EXPORTS = {
  tally: 'Tally (XML vouchers)',
  zoho: 'Zoho Books (CSV)',
  invoices: 'Invoices (CSV)',
  receipts: 'Receipts with TDS (CSV)',
  credit_notes: 'Credit notes and write-offs (CSV)',
  gstr1_b2b: 'GSTR-1 B2B invoices',
  gstr1_b2cs: 'GSTR-1 B2C small (summary)',
  gstr1_cdnr: 'GSTR-1 credit notes (registered)',
  gstr1_hsn: 'GSTR-1 SAC summary',
  tds: 'TDS by party (Form 26AS)',
} as const;
export type ExportKind = keyof typeof EXPORTS;

// Zoho Books takes the two-letter state code as place of supply
const ZOHO_STATE: Record<string, string> = {
  '01': 'JK', '02': 'HP', '03': 'PB', '04': 'CH', '05': 'UK', '06': 'HR', '07': 'DL', '08': 'RJ', '09': 'UP', '10': 'BR', '11': 'SK', '12': 'AR', '13': 'NL', '14': 'MN',
  '15': 'MZ', '16': 'TR', '17': 'ML', '18': 'AS', '19': 'WB', '20': 'JH', '21': 'OR', '22': 'CG', '23': 'MP', '24': 'GJ', '26': 'DN', '27': 'MH', '29': 'KA', '30': 'GA',
  '31': 'LD', '32': 'KL', '33': 'TN', '34': 'PY', '35': 'AN', '36': 'TS', '37': 'AD', '38': 'LA', '97': 'OT',
};
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const gstDate = (d: string) => `${d.slice(8, 10)}-${MON[Number(d.slice(5, 7)) - 1]}-${d.slice(2, 4)}`; // 21-Oct-26
const pos = (code: string) => `${code}-${gstStateName(code)}`;
const n2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const cell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (head: string[], rows: unknown[][]) => [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
const xml = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function accountingExport(firmId: number, kind: ExportKind, from: string, to: string) {
  if (!(kind in EXPORTS)) throw badRequest('Unknown export');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw badRequest('Choose a period: from and to dates');
  const s = await getSettings(firmId);
  const inv = await listInvoices(firmId, { kind: 'tax', from, to });
  const ids = inv.map((i) => i.id);
  const [receipts, notes] = await Promise.all([
    db.selectFrom('payments as p').innerJoin('invoices as i', 'i.id', 'p.invoice_id').select(['p.id', 'p.received_on', 'p.amount', 'p.tds', 'p.pay_mode', 'p.ref_no', 'p.note', 'i.id as invoice_id', 'i.invoice_no', 'i.bill_to_name', 'i.bill_to_gstin', 'i.taxable'])
      .where('p.firm_id', '=', firmId).where('i.kind', '=', 'tax').where('p.received_on', '>=', new Date(`${from}T00:00:00Z`)).where('p.received_on', '<=', new Date(`${to}T00:00:00Z`)).orderBy('p.received_on').execute(),
    db.selectFrom('credit_notes as c').innerJoin('invoices as i', 'i.id', 'c.invoice_id').select(['c.id', 'c.kind', 'c.note_no', 'c.note_date', 'c.taxable', 'c.cgst', 'c.sgst', 'c.igst', 'c.total', 'c.reason', 'i.invoice_no', 'i.invoice_date', 'i.bill_to_name', 'i.bill_to_gstin', 'i.pos_code', 'i.gst_rate', 'i.sac'])
      .where('c.firm_id', '=', firmId).where('c.note_date', '>=', new Date(`${from}T00:00:00Z`)).where('c.note_date', '<=', new Date(`${to}T00:00:00Z`)).orderBy('c.note_date').execute(),
  ]);
  const tag = `${from}_to_${to}`;
  const out = (name: string, body: string, mime = 'text/csv') => ({ name: `${name}_${tag}.${mime === 'text/csv' ? 'csv' : 'xml'}`, mime, body, count: kind === 'receipts' || kind === 'tds' ? receipts.length : kind.includes('cdnr') || kind === 'credit_notes' ? notes.length : inv.length });
  const L = s.tally_ledgers;

  if (kind === 'tally') {
    const entry = (ledger: string, amount: number) => `     <ALLLEDGERENTRIES.LIST><LEDGERNAME>${xml(ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${amount < 0 ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${n2(amount)}</AMOUNT></ALLLEDGERENTRIES.LIST>\n`;
    const voucher = (type: string, date: string, no: string, party: string, gstin: string | null, posCode: string | null, narration: string, entries: [string, number][]) =>
      `   <TALLYMESSAGE xmlns:UDF="TallyUDF">\n    <VOUCHER VCHTYPE="${type}" ACTION="Create" OBJVIEW="Accounting Voucher View">\n     <DATE>${date.replace(/-/g, '')}</DATE>\n     <VOUCHERTYPENAME>${type}</VOUCHERTYPENAME>\n     <VOUCHERNUMBER>${xml(no)}</VOUCHERNUMBER>\n     <PARTYLEDGERNAME>${xml(party)}</PARTYLEDGERNAME>\n${gstin ? `     <PARTYGSTIN>${xml(gstin)}</PARTYGSTIN>\n` : ''}${posCode ? `     <PLACEOFSUPPLY>${xml(gstStateName(posCode))}</PLACEOFSUPPLY>\n` : ''}     <NARRATION>${xml(narration)}</NARRATION>\n     <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>\n${entries.filter(([, a]) => Math.abs(a) >= 0.005).map(([l, a]) => entry(l, a)).join('')}    </VOUCHER>\n   </TALLYMESSAGE>\n`;
    // Tally: debits are negative with ISDEEMEDPOSITIVE Yes, credits positive
    const sales = inv.map((i) => voucher('Sales', i.invoice_date, i.invoice_no, i.bill_to_name, i.bill_to_gstin, i.pos_code, `${i.lines} valuation report(s)${i.period_label ? `, ${i.period_label}` : ''}`,
      [[i.bill_to_name, -Number(i.total)], [L.sales, Number(i.taxable)], [L.cgst, Number(i.cgst)], [L.sgst, Number(i.sgst)], [L.igst, Number(i.igst)], [L.round_off, Number(i.round_off)]]));
    const cns = notes.filter((c) => c.kind === 'credit_note').map((c) => voucher('Credit Note', ymd(c.note_date), c.note_no ?? '', c.bill_to_name, c.bill_to_gstin, c.pos_code, `Against ${c.invoice_no}: ${c.reason}`,
      [[c.bill_to_name, Number(c.total)], [L.sales, -Number(c.taxable)], [L.cgst, -Number(c.cgst)], [L.sgst, -Number(c.sgst)], [L.igst, -Number(c.igst)], [L.round_off, -(Number(c.total) - Number(c.taxable) - Number(c.cgst) - Number(c.sgst) - Number(c.igst))]]));
    const rec = receipts.map((r) => voucher('Receipt', ymd(r.received_on), `R-${r.id}`, r.bill_to_name, null, null, `Against ${r.invoice_no}${r.ref_no ? `, ${r.pay_mode} ${r.ref_no}` : `, ${r.pay_mode}`}`,
      [[r.bill_to_name, Number(r.amount) + Number(r.tds)], [L.bank, -Number(r.amount)], [L.tds, -Number(r.tds)]]));
    const body = `<ENVELOPE>\n <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>\n <BODY><IMPORTDATA>\n  <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC>\n  <REQUESTDATA>\n${[...sales, ...cns, ...rec].join('')}  </REQUESTDATA>\n </IMPORTDATA></BODY>\n</ENVELOPE>\n`;
    return { ...out('tally_vouchers', body, 'application/xml'), count: sales.length + cns.length + rec.length };
  }

  if (kind === 'zoho') {
    const lines = ids.length ? await db.selectFrom('invoice_lines').select(['invoice_id', 'ref_text', 'description', 'amount']).where('invoice_id', 'in', ids).orderBy('invoice_id').orderBy('line_no').execute() : [];
    return out('zoho_invoices', csv(
      ['Invoice Date', 'Invoice Number', 'Invoice Status', 'Customer Name', 'GST Treatment', 'GST Identification Number (GSTIN)', 'Place of Supply', 'Item Name', 'Item Desc', 'SAC', 'Quantity', 'Item Price', 'Item Tax', 'Item Tax %', 'Item Tax Type', 'Is Inclusive Tax', 'Currency Code', 'Adjustment'],
      inv.flatMap((i) => lines.filter((l) => l.invoice_id === i.id).map((l, k) => [
        i.invoice_date, i.invoice_no, 'Sent', i.bill_to_name, i.bill_to_gstin ? 'business_gst' : 'consumer', i.bill_to_gstin ?? '', ZOHO_STATE[i.pos_code] ?? i.pos_code,
        'Valuation services', `${l.ref_text}: ${l.description}`, i.sac, 1, n2(Number(l.amount)), Number(i.igst) > 0 ? `IGST${Number(i.gst_rate)}` : `GST${Number(i.gst_rate)}`, Number(i.gst_rate), 'Tax Group', 'false', 'INR', k === 0 ? n2(Number(i.round_off)) : '',
      ])),
    ));
  }

  if (kind === 'invoices') {
    return out('invoices', csv(
      ['invoice_no', 'date', 'type', 'payer', 'bill_to', 'gstin', 'place_of_supply', 'reports', 'taxable', 'cgst', 'sgst', 'igst', 'round_off', 'total', 'received', 'tds', 'credit_notes', 'written_off', 'balance', 'status'],
      inv.map((i) => [i.invoice_no, i.invoice_date, i.bill_mode === 'batch' ? 'batch' : 'single', i.payer, i.bill_to_name, i.bill_to_gstin ?? '', pos(i.pos_code), i.lines, n2(Number(i.taxable)), n2(Number(i.cgst)), n2(Number(i.sgst)), n2(Number(i.igst)), n2(Number(i.round_off)), n2(Number(i.total)), n2(i.received), n2(i.tds), n2(i.credited), n2(i.writtenOff), n2(i.balance), i.status_label]),
    ));
  }
  if (kind === 'receipts') {
    return out('receipts', csv(['date', 'invoice_no', 'from', 'gstin', 'mode', 'reference', 'received', 'tds', 'total_credited', 'note'],
      receipts.map((r) => [ymd(r.received_on), r.invoice_no, r.bill_to_name, r.bill_to_gstin ?? '', r.pay_mode, r.ref_no ?? '', n2(Number(r.amount)), n2(Number(r.tds)), n2(Number(r.amount) + Number(r.tds)), r.note ?? ''])));
  }
  if (kind === 'credit_notes') {
    return out('credit_notes', csv(['date', 'kind', 'note_no', 'invoice_no', 'party', 'gstin', 'taxable', 'cgst', 'sgst', 'igst', 'total', 'reason'],
      notes.map((c) => [ymd(c.note_date), c.kind === 'credit_note' ? 'Credit note' : 'Write-off', c.note_no ?? '', c.invoice_no, c.bill_to_name, c.bill_to_gstin ?? '', n2(Number(c.taxable)), n2(Number(c.cgst)), n2(Number(c.sgst)), n2(Number(c.igst)), n2(Number(c.total)), c.reason])));
  }

  if (kind === 'gstr1_b2b') {
    return out('gstr1_b2b', csv(['GSTIN/UIN of Recipient', 'Receiver Name', 'Invoice Number', 'Invoice date', 'Invoice Value', 'Place Of Supply', 'Reverse Charge', 'Applicable % of Tax Rate', 'Invoice Type', 'E-Commerce GSTIN', 'Rate', 'Taxable Value', 'Cess Amount'],
      inv.filter((i) => i.bill_to_gstin).map((i) => [i.bill_to_gstin, i.bill_to_name, i.invoice_no, gstDate(i.invoice_date), n2(Number(i.total)), pos(i.pos_code), 'N', '', 'Regular B2B', '', Number(i.gst_rate), n2(Number(i.taxable)), ''])));
  }
  if (kind === 'gstr1_b2cs') {
    // B2C supplies are reported as a summary per place of supply and rate, net of B2C credit notes
    const g = new Map<string, { pos: string; rate: number; taxable: number }>();
    for (const i of inv.filter((x) => !x.bill_to_gstin)) {
      const k = `${i.pos_code}|${i.gst_rate}`;
      const r = g.get(k) ?? { pos: i.pos_code, rate: Number(i.gst_rate), taxable: 0 };
      r.taxable += Number(i.taxable);
      g.set(k, r);
    }
    for (const c of notes.filter((x) => x.kind === 'credit_note' && !x.bill_to_gstin)) {
      const k = `${c.pos_code}|${c.gst_rate}`;
      const r = g.get(k) ?? { pos: c.pos_code, rate: Number(c.gst_rate), taxable: 0 };
      r.taxable -= Number(c.taxable);
      g.set(k, r);
    }
    return out('gstr1_b2cs', csv(['Type', 'Place Of Supply', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount', 'E-Commerce GSTIN'], [...g.values()].map((r) => ['OE', pos(r.pos), '', r.rate, n2(r.taxable), '', ''])));
  }
  if (kind === 'gstr1_cdnr') {
    return out('gstr1_cdnr', csv(['GSTIN/UIN of Recipient', 'Receiver Name', 'Note Number', 'Note Date', 'Note Type', 'Place Of Supply', 'Reverse Charge', 'Note Supply Type', 'Note Value', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount'],
      notes.filter((c) => c.kind === 'credit_note' && c.bill_to_gstin).map((c) => [c.bill_to_gstin, c.bill_to_name, c.note_no, gstDate(ymd(c.note_date)), 'C', pos(c.pos_code), 'N', 'Regular B2B', n2(Number(c.total)), '', Number(c.gst_rate), n2(Number(c.taxable)), ''])));
  }
  if (kind === 'gstr1_hsn') {
    const g = new Map<string, { sac: string; rate: number; n: number; value: number; taxable: number; igst: number; cgst: number; sgst: number }>();
    const add = (sac: string, rate: number, sign: number, x: { total: number; taxable: number; igst: number; cgst: number; sgst: number }, count: number) => {
      const k = `${sac}|${rate}`;
      const r = g.get(k) ?? { sac, rate, n: 0, value: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
      r.n += count; r.value += sign * x.total; r.taxable += sign * x.taxable; r.igst += sign * x.igst; r.cgst += sign * x.cgst; r.sgst += sign * x.sgst;
      g.set(k, r);
    };
    for (const i of inv) add(i.sac, Number(i.gst_rate), 1, { total: Number(i.total), taxable: Number(i.taxable), igst: Number(i.igst), cgst: Number(i.cgst), sgst: Number(i.sgst) }, i.lines);
    for (const c of notes.filter((x) => x.kind === 'credit_note')) add(c.sac, Number(c.gst_rate), -1, { total: Number(c.total), taxable: Number(c.taxable), igst: Number(c.igst), cgst: Number(c.cgst), sgst: Number(c.sgst) }, 0);
    return out('gstr1_hsn', csv(['HSN', 'Description', 'UQC', 'Total Quantity', 'Total Value', 'Rate', 'Taxable Value', 'Integrated Tax Amount', 'Central Tax Amount', 'State/UT Tax Amount', 'Cess Amount'],
      [...g.values()].map((r) => [r.sac, 'Valuation services', 'NA', r.n, n2(r.value), r.rate, n2(r.taxable), n2(r.igst), n2(r.cgst), n2(r.sgst), ''])));
  }
  // TDS deducted by each payer in the period, for matching with Form 26AS
  const g = new Map<string, { party: string; gstin: string; n: number; received: number; tds: number; first: string; last: string }>();
  for (const r of receipts.filter((x) => Number(x.tds) > 0)) {
    const k = `${r.bill_to_name}|${r.bill_to_gstin ?? ''}`;
    const d = ymd(r.received_on);
    const x = g.get(k) ?? { party: r.bill_to_name, gstin: r.bill_to_gstin ?? '', n: 0, received: 0, tds: 0, first: d, last: d };
    x.n++; x.received += Number(r.amount); x.tds += Number(r.tds); if (d < x.first) x.first = d; if (d > x.last) x.last = d;
    g.set(k, x);
  }
  return { ...out('tds_by_party', csv(['party', 'gstin', 'receipts', 'received', 'tds_deducted', 'first_receipt', 'last_receipt'], [...g.values()].map((x) => [x.party, x.gstin, x.n, n2(x.received), n2(x.tds), x.first, x.last]))), count: g.size };
}
