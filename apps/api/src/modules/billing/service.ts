// Billing & payouts (optional per firm, feature flag "billing"): ready to bill, GST tax invoices per
// case or one per bank branch, proformas for advances and their conversion, payments with TDS,
// credit notes and write-offs, ageing with reminders, GST tracking, engineer payouts. Cases move to
// Billed when a tax invoice covers them and to Paid when every such invoice is settled.
import { AGEING_BUCKETS, PROPERTY_TYPES, ddmmyyyy, fillPattern, financialYear, gstStateName, inr, interpolate, pad, type Stage } from '@vm/shared';
import { db, json, toJson, type Tx } from '../../db/index.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { audit, type Actor } from '../../platform/audit.js';
import { activeConfig } from '../../platform/config.js';
import { publish, subscribe } from '../../platform/events.js';
import { sendMail } from '../../platform/mail.js';
import { nextNumber } from '../../platform/sequences.js';
import { flagsFor, getSettings, type FirmSettings } from '../../platform/settings.js';
import { invoicePdf } from './pdf.js';
import { creditSplit, taxSplit } from './tax.js';

const r2 = (n: number) => Math.round(n * 100) / 100;
const IST = 5.5 * 3600_000;
/** Today's date in India as YYYY-MM-DD. */
export const todayIst = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const asDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
export const ymd = (d: Date | string) => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));
const fyOf = (date: string) => financialYear(new Date(`${date}T12:00:00Z`)).short;
const daysSince = (date: Date | string) => Math.floor((asDate(todayIst()).getTime() - asDate(ymd(date)).getTime()) / 86400_000);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const typeLabel = (k: string) => PROPERTY_TYPES.find((p) => p.key === k)?.label ?? k;

function checkDate(date: string | null | undefined, what: string): string {
  const d = date || todayIst();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(asDate(d).getTime())) throw badRequest(`${what}: use a date like 2026-10-21`);
  if (d > todayIst()) throw badRequest(`${what} cannot be in the future`);
  return d;
}

export async function assertBilling(firmId: number, tx: Tx = db) {
  if (!(await flagsFor(firmId, tx)).billing) throw badRequest('Billing is switched off for this firm. Switch it on in Billing & payouts.');
}

async function addresses(ids: number[], tx: Tx = db) {
  const out = new Map<number, string>();
  if (!ids.length) return out;
  const rows = await tx.selectFrom('field_values').select(['assignment_id', 'value_text']).where('assignment_id', 'in', ids).where('field_code', '=', 'PROP.ADDRESS').where('is_current', '=', 1).orderBy('confidence', 'desc').execute();
  for (const r of rows) if (!out.has(r.assignment_id) && r.value_text) out.set(r.assignment_id, r.value_text);
  return out;
}

// ---- stage ---------------------------------------------------------------------------------------

/** Billed / Paid follow the tax invoices covering a sent case; a released credit note returns it to Sent. */
export async function syncStage(assignmentId: number, actorId: number | null = null, tx: Tx = db) {
  const a = await tx.selectFrom('assignments').select(['id', 'firm_id', 'stage', 'sent_at']).where('id', '=', assignmentId).executeTakeFirst();
  if (!a?.sent_at) return;
  const inv = await tx.selectFrom('invoice_lines as il').innerJoin('invoices as i', 'i.id', 'il.invoice_id').select('i.id').distinct()
    .where('il.assignment_id', '=', assignmentId).where('i.kind', '=', 'tax').where('il.released_at', 'is', null).execute();
  let stage: Stage = 'sent';
  if (inv.length) {
    const bal = await balances(inv.map((i) => i.id), tx);
    stage = inv.every((i) => (bal.get(i.id)?.balance ?? 0) <= 0) ? 'paid' : 'billed';
  }
  if (stage === a.stage) return;
  await tx.updateTable('assignments').set({ stage, stage_changed_at: new Date() }).where('id', '=', assignmentId).execute();
  await tx.insertInto('stage_history').values({ assignment_id: assignmentId, from_stage: a.stage, to_stage: stage, actor_id: actorId }).execute();
  await publish({ type: 'assignment.stage_changed', firmId: a.firm_id, entityType: 'assignment', entityId: assignmentId, payload: { from: a.stage, to: stage } }, tx);
}

async function syncInvoiceCases(invoiceId: number, actorId: number | null, tx: Tx = db) {
  const lines = await tx.selectFrom('invoice_lines').select('assignment_id').distinct().where('invoice_id', '=', invoiceId).where('assignment_id', 'is not', null).execute();
  for (const l of lines) await syncStage(l.assignment_id!, actorId, tx);
}

// a case invoiced (from a proforma) before it was sent becomes Billed once it is sent
subscribe('report.sent', (e) => syncStage(Number(e.entityId)));

// ---- balances --------------------------------------------------------------------------------------

interface Totals { received: number; tds: number; credited: number; writtenOff: number; paid: number; balance: number; lastPaid: string | null }

/** Payments (with TDS), credit notes and write-offs per invoice; balance = total - all of them. */
export async function balances(ids: number[], tx: Tx = db): Promise<Map<number, Totals>> {
  const out = new Map<number, Totals>();
  if (!ids.length) return out;
  const [inv, pays, notes] = await Promise.all([
    tx.selectFrom('invoices').select(['id', 'total']).where('id', 'in', ids).execute(),
    tx.selectFrom('payments').select((eb) => ['invoice_id', eb.fn.sum<number>('amount').as('amount'), eb.fn.sum<number>('tds').as('tds'), eb.fn.max('received_on').as('last')]).where('invoice_id', 'in', ids).groupBy('invoice_id').execute(),
    tx.selectFrom('credit_notes').select((eb) => ['invoice_id', 'kind', eb.fn.sum<number>('total').as('total')]).where('invoice_id', 'in', ids).groupBy(['invoice_id', 'kind']).execute(),
  ]);
  for (const i of inv) {
    const p = pays.find((x) => x.invoice_id === i.id);
    const received = Number(p?.amount ?? 0);
    const tds = Number(p?.tds ?? 0);
    const credited = Number(notes.find((n) => n.invoice_id === i.id && n.kind === 'credit_note')?.total ?? 0);
    const writtenOff = Number(notes.find((n) => n.invoice_id === i.id && n.kind === 'write_off')?.total ?? 0);
    const balance = r2(Number(i.total) - received - tds - credited - writtenOff);
    out.set(i.id, { received, tds, credited, writtenOff, paid: r2(received + tds), balance: Math.abs(balance) < 0.5 ? 0 : balance, lastPaid: p?.last ? ymd(p.last as Date) : null });
  }
  return out;
}

type InvoiceRow = Awaited<ReturnType<typeof loadInvoices>>[number];

function statusOf(i: { kind: string; invoice_date: Date; converted_invoice_id: number | null; cancelled_at: Date | null; total: number }, t: Totals, dueDays: number) {
  if (i.kind === 'proforma') return i.cancelled_at ? 'cancelled' : i.converted_invoice_id ? 'converted' : t.paid > 0 ? 'advance' : 'awaiting';
  if (t.balance <= 0) return t.credited + t.writtenOff >= Number(i.total) - 0.5 && t.paid === 0 ? 'credited' : 'paid';
  if (t.paid > 0) return 'part';
  return daysSince(i.invoice_date) > dueDays ? 'overdue' : 'unpaid';
}
export const STATUS_LABEL: Record<string, string> = {
  paid: 'Paid', part: 'Part paid', unpaid: 'Unpaid', overdue: 'Overdue', credited: 'Credited',
  converted: 'Converted', cancelled: 'Cancelled', advance: 'Advance received', awaiting: 'Awaiting advance',
};

async function loadInvoices(firmId: number, f: { ids?: number[]; from?: string; to?: string; kind?: 'tax' | 'proforma'; limit?: number } = {}, tx: Tx = db) {
  let q = tx.selectFrom('invoices').selectAll().where('firm_id', '=', firmId).orderBy('invoice_date', 'desc').orderBy('id', 'desc').limit(f.limit ?? 1000);
  if (f.ids) q = q.where('id', 'in', f.ids.length ? f.ids : [0]);
  if (f.from) q = q.where('invoice_date', '>=', asDate(f.from));
  if (f.to) q = q.where('invoice_date', '<=', asDate(f.to));
  if (f.kind) q = q.where('kind', '=', f.kind);
  return q.execute();
}

async function withTotals(firmId: number, rows: InvoiceRow[], tx: Tx = db) {
  const s = await getSettings(firmId, tx);
  const bal = await balances(rows.map((r) => r.id), tx);
  const counts = rows.length
    ? await tx.selectFrom('invoice_lines').select((eb) => ['invoice_id', eb.fn.countAll<number>().as('n')]).where('invoice_id', 'in', rows.map((r) => r.id)).groupBy('invoice_id').execute()
    : [];
  return rows.map((r) => {
    // a converted or cancelled proforma asks for nothing more (its advance moved to the tax invoice)
    const t = r.kind === 'proforma' && (r.converted_invoice_id || r.cancelled_at) ? { ...bal.get(r.id)!, balance: 0 } : bal.get(r.id)!;
    const status = statusOf(r, t, s.due_days);
    return { ...r, invoice_date: ymd(r.invoice_date), seller_json: undefined, lines: Number(counts.find((c) => c.invoice_id === r.id)?.n ?? 0), ...t, status, status_label: STATUS_LABEL[status], age_days: daysSince(r.invoice_date) };
  });
}

// ---- ready to bill ------------------------------------------------------------------------------------

/** Signed and sent reports not yet on a tax invoice, with payer, cycle and fee. */
export async function readyToBill(firmId: number) {
  const rows = await db.selectFrom('assignments as a').innerJoin('banks as b', 'b.id', 'a.bank_id').innerJoin('bank_branches as br', 'br.id', 'a.branch_id')
    .select(['a.id', 'a.case_no', 'a.report_no', 'a.signed_at', 'a.sent_at', 'a.borrower_name', 'a.property_type', 'a.locality_hint', 'a.fee', 'a.bill_payer', 'a.personal_data_removed_at',
      'b.code as bank_code', 'b.short_name as bank_short', 'br.id as branch_id', 'br.code as branch_code', 'br.name as branch_name', 'br.default_payer', 'br.billing_cycle', 'br.fee as branch_fee'])
    .where('a.firm_id', '=', firmId).where('a.sent_at', 'is not', null).where('a.report_no', 'is not', null)
    .where(({ not, exists, selectFrom }) => not(exists(selectFrom('invoice_lines as il').innerJoin('invoices as i', 'i.id', 'il.invoice_id').select('il.id')
      .whereRef('il.assignment_id', '=', 'a.id').where('i.kind', '=', 'tax').where('il.released_at', 'is', null))))
    .orderBy('a.sent_at').execute();
  const addr = await addresses(rows.map((r) => r.id));
  const proformas = await openProformas(rows.map((r) => r.id));
  return rows.map((r) => ({
    ...r, borrower_name: r.personal_data_removed_at ? '(personal data removed)' : r.borrower_name,
    payer: r.bill_payer ?? r.default_payer, payer_overridden: !!r.bill_payer, fee: r.fee ?? r.branch_fee, property: addr.get(r.id) ?? r.locality_hint,
    proforma: proformas.get(r.id) ?? null,
  }));
}

async function openProformas(ids: number[], tx: Tx = db) {
  const out = new Map<number, { id: number; invoice_no: string }>();
  if (!ids.length) return out;
  const rows = await tx.selectFrom('invoice_lines as il').innerJoin('invoices as i', 'i.id', 'il.invoice_id').select(['il.assignment_id', 'i.id', 'i.invoice_no'])
    .where('il.assignment_id', 'in', ids).where('i.kind', '=', 'proforma').where('i.converted_invoice_id', 'is', null).where('i.cancelled_at', 'is', null).execute();
  for (const r of rows) out.set(r.assignment_id!, { id: r.id, invoice_no: r.invoice_no });
  return out;
}

/** Cases that can get a proforma (advance) now: not yet on a tax invoice or an open proforma. */
export async function proformaCandidates(firmId: number) {
  const rows = await db.selectFrom('assignments as a').innerJoin('banks as b', 'b.id', 'a.bank_id').innerJoin('bank_branches as br', 'br.id', 'a.branch_id')
    .select(['a.id', 'a.case_no', 'a.borrower_name', 'a.stage', 'a.fee', 'a.bill_payer', 'b.code as bank_code', 'br.name as branch_name', 'br.default_payer', 'br.fee as branch_fee'])
    .where('a.firm_id', '=', firmId).where('a.stage', 'not in', ['billed', 'paid'])
    .where(({ not, exists, selectFrom }) => not(exists(selectFrom('invoice_lines as il').innerJoin('invoices as i', 'i.id', 'il.invoice_id').select('il.id')
      .whereRef('il.assignment_id', '=', 'a.id').where('il.released_at', 'is', null)
      .where((eb) => eb.or([eb('i.kind', '=', 'tax'), eb.and([eb('i.converted_invoice_id', 'is', null), eb('i.cancelled_at', 'is', null)])])))))
    .orderBy('a.id', 'desc').limit(200).execute();
  return rows.map((r) => ({ ...r, payer: r.bill_payer ?? r.default_payer, fee: r.fee ?? r.branch_fee }));
}

/** Bill one case differently: fee and payer (bank or borrower). */
export async function setCaseBilling(actor: Actor, assignmentId: number, patch: { fee?: number | null; payer?: 'bank' | 'borrower' | null }) {
  const a = await db.selectFrom('assignments').select(['id', 'case_no', 'fee', 'bill_payer']).where('id', '=', assignmentId).where('firm_id', '=', actor.firmId!).executeTakeFirst();
  if (!a) throw notFound('Assignment');
  const billed = await db.selectFrom('invoice_lines as il').innerJoin('invoices as i', 'i.id', 'il.invoice_id').select('i.invoice_no').where('il.assignment_id', '=', assignmentId).where('i.kind', '=', 'tax').where('il.released_at', 'is', null).executeTakeFirst();
  if (billed) throw badRequest(`Already billed on ${billed.invoice_no}`);
  const set: Record<string, unknown> = {};
  if (patch.fee !== undefined) {
    if (patch.fee !== null && !(patch.fee > 0)) throw badRequest('Fee must be more than zero');
    set.fee = patch.fee;
  }
  if (patch.payer !== undefined) set.bill_payer = patch.payer;
  if (!Object.keys(set).length) return;
  await db.updateTable('assignments').set(set).where('id', '=', assignmentId).execute();
  await audit(actor, { entityType: 'assignment', entityId: assignmentId, assignmentId, action: 'billing.case', summary: `Billing for ${a.case_no} changed: ${[patch.fee !== undefined ? `fee Rs. ${inr(patch.fee ?? 0)}` : '', patch.payer !== undefined ? `payer ${patch.payer ?? 'as per branch'}` : ''].filter(Boolean).join(', ')}`, before: { fee: a.fee, payer: a.bill_payer }, after: set });
}

// ---- invoices ----------------------------------------------------------------------------------------

async function sellerSnapshot(firmId: number, s: FirmSettings, tx: Tx) {
  const f = await tx.selectFrom('firms').selectAll().where('id', '=', firmId).executeTakeFirstOrThrow();
  return {
    name: f.name, legal_name: f.legal_name, address: f.address, city: f.city, state_code: f.state_code, gstin: f.gstin, pan: f.pan, phone: f.phone, email: f.email,
    bank_account: s.bank_account, upi_id: s.upi_id, note: s.invoice_note, letterhead_file_id: s.letterhead_file_id, signature_file_id: s.signature_file_id, seal_file_id: s.seal_file_id,
  };
}

type CaseRow = Awaited<ReturnType<typeof casesForBilling>>[number];
async function casesForBilling(firmId: number, ids: number[], tx: Tx) {
  if (!ids.length) throw badRequest('Choose at least one case');
  const rows = await tx.selectFrom('assignments as a').innerJoin('banks as b', 'b.id', 'a.bank_id').innerJoin('bank_branches as br', 'br.id', 'a.branch_id')
    .select(['a.id', 'a.case_no', 'a.report_no', 'a.signed_at', 'a.sent_at', 'a.borrower_name', 'a.property_type', 'a.locality_hint', 'a.fee', 'a.bill_payer', 'a.bank_id', 'a.branch_id',
      'b.name as bank_name', 'b.code as bank_code', 'br.name as branch_name', 'br.address as branch_address', 'br.city as branch_city', 'br.state_code as branch_state', 'br.gstin as branch_gstin',
      'br.contact_email', 'br.contact_phone', 'br.default_payer', 'br.fee as branch_fee'])
    .where('a.firm_id', '=', firmId).where('a.id', 'in', ids).forUpdate().execute();
  if (rows.length !== new Set(ids).size) throw notFound('Assignment');
  return rows;
}

interface Group { kind: 'tax' | 'proforma'; mode: 'case' | 'batch'; payer: 'bank' | 'borrower'; cases: CaseRow[] }

function lineFor(c: CaseRow, addr: Map<number, string>, kind: 'tax' | 'proforma') {
  const fee = Number(c.fee ?? c.branch_fee);
  if (!(fee > 0)) throw badRequest(`Set the fee for ${c.case_no} first`);
  // the address up to a comma within ~110 characters keeps batch invoices readable
  const full = addr.get(c.id) ?? c.locality_hint ?? '';
  const prop = full.length <= 110 ? full : `${full.slice(0, full.lastIndexOf(',', 110) > 40 ? full.lastIndexOf(',', 110) : 110)}…`;
  return {
    assignment_id: c.id,
    ref_text: c.report_no ?? c.case_no,
    description: `${kind === 'proforma' && !c.report_no ? 'Advance towards professional fees for valuation' : 'Professional fees for valuation'} of ${typeLabel(c.property_type).toLowerCase()}${prop ? `, ${prop}` : ''}${c.borrower_name ? ` (${c.borrower_name})` : ''}`.slice(0, 500),
    amount: fee,
  };
}

function periodLabel(cases: CaseRow[]) {
  const months = [...new Set(cases.map((c) => ymd(c.signed_at ?? new Date()).slice(0, 7)))].sort();
  return months.length === 1 ? monthLabel(months[0]) : `${monthLabel(months[0]).split(' ')[0]}–${monthLabel(months[months.length - 1])}`;
}

async function issue(actor: Actor, g: Group, date: string, s: FirmSettings, seller: Record<string, any>, addr: Map<number, string>, tx: Tx, from?: { proformaId: number; lines: { assignment_id: number | null; ref_text: string; description: string; amount: number }[] }) {
  const c = g.cases[0];
  const bank = g.payer === 'bank';
  const gstin = bank ? c.branch_gstin : null;
  const pos = (gstin?.slice(0, 2) || c.branch_state || seller.state_code || '27').padStart(2, '0');
  const lines = from?.lines ?? g.cases.map((x) => lineFor(x, addr, g.kind));
  const taxable = r2(lines.reduce((t, l) => t + Number(l.amount), 0));
  const tax = taxSplit(taxable, s.gst_pct, pos === seller.state_code);
  const fy = fyOf(date);
  const seq = await nextNumber(tx, actor.firmId!, g.kind === 'tax' ? 'invoice' : 'proforma', fy);
  const invoiceNo = fillPattern(g.kind === 'tax' ? s.invoice_pattern : s.proforma_pattern, { FY: fy, N: pad(seq) });
  const r = await tx.insertInto('invoices').values({
    firm_id: actor.firmId!, kind: g.kind, invoice_no: invoiceNo, fy, seq, invoice_date: asDate(date), bill_mode: g.mode, payer: g.payer, bank_id: c.bank_id, branch_id: c.branch_id,
    bill_to_name: (bank ? `${c.bank_name}, ${c.branch_name}` : c.borrower_name || 'Borrower').slice(0, 250),
    bill_to_address: bank ? [c.branch_address, c.branch_city].filter(Boolean).join(', ') || null : addr.get(c.id) ?? c.locality_hint ?? null,
    bill_to_gstin: gstin || null, bill_to_email: bank ? c.contact_email : null, bill_to_phone: bank ? c.contact_phone : null,
    pos_code: pos, sac: s.sac, gst_rate: s.gst_pct, taxable, ...tax, period_label: g.mode === 'batch' ? periodLabel(g.cases) : null,
    seller_json: toJson(seller), proforma_id: from?.proformaId ?? null, created_by: actor.id ?? null,
  }).executeTakeFirstOrThrow();
  const id = Number(r.insertId);
  await tx.insertInto('invoice_lines').values(lines.map((l, i) => ({ invoice_id: id, line_no: i + 1, assignment_id: l.assignment_id, ref_text: l.ref_text, description: l.description, amount: l.amount }))).execute();
  const what = g.kind === 'tax' ? 'Tax invoice' : 'Proforma invoice';
  for (const x of g.cases) {
    await audit(actor, { entityType: 'invoice', entityId: id, assignmentId: x.id, action: `invoice.${g.kind}`, summary: `${what} ${invoiceNo} raised${g.mode === 'batch' ? ` (batch of ${g.cases.length}, ${c.bank_code} ${c.branch_name})` : ''} for Rs. ${inr(tax.total)} incl. GST.` }, tx);
  }
  await publish({ type: 'invoice.issued', firmId: actor.firmId, entityType: 'invoice', entityId: id, payload: { invoiceNo, kind: g.kind } }, tx);
  return { id, invoiceNo, total: tax.total };
}

/**
 * Raise invoices for the chosen cases. mode "case": one per case; "batch": one per bank branch for
 * cases the bank pays (borrower-paid cases are always billed one by one). A case with an open
 * proforma is billed by converting that proforma, so the advance is adjusted.
 */
export async function createInvoices(actor: Actor, input: { assignmentIds: number[]; mode: 'case' | 'batch'; kind: 'tax' | 'proforma'; date?: string | null }) {
  const firmId = actor.firmId!;
  await assertBilling(firmId);
  const date = checkDate(input.date, 'Invoice date');
  const made = await db.transaction().execute(async (tx) => {
    const s = await getSettings(firmId, tx);
    const ids = [...new Set(input.assignmentIds)];
    const cases = await casesForBilling(firmId, ids, tx);
    const billed = await tx.selectFrom('invoice_lines as il').innerJoin('invoices as i', 'i.id', 'il.invoice_id').innerJoin('assignments as a', 'a.id', 'il.assignment_id')
      .select(['a.case_no', 'i.invoice_no']).where('il.assignment_id', 'in', ids).where('i.kind', '=', 'tax').where('il.released_at', 'is', null).execute();
    if (billed.length) throw badRequest(`${billed[0].case_no} is already billed on ${billed[0].invoice_no}`);
    const open = await openProformas(ids, tx);
    if (input.kind === 'tax') {
      const unsent = cases.find((c) => !c.sent_at && !open.has(c.id));
      if (unsent) throw badRequest(`${unsent.case_no}: the report is not sent yet. Use a proforma for an advance.`);
    } else {
      const has = cases.find((c) => open.has(c.id));
      if (has) throw badRequest(`${has.case_no} already has proforma ${open.get(has.id)!.invoice_no}`);
    }
    const seller = await sellerSnapshot(firmId, s, tx);
    const addr = await addresses(ids, tx);
    const out: { id: number; invoiceNo: string; total: number }[] = [];
    // cases with an open proforma: convert it (once per proforma)
    const viaProforma = input.kind === 'tax' ? cases.filter((c) => open.has(c.id)) : [];
    for (const pid of new Set(viaProforma.map((c) => open.get(c.id)!.id))) out.push(await convert(actor, pid, date, tx));
    const rest = cases.filter((c) => !viaProforma.includes(c));
    const groups: Group[] = [];
    for (const c of rest) {
      const payer = (c.bill_payer ?? c.default_payer) as 'bank' | 'borrower';
      const g = input.mode === 'batch' && payer === 'bank' ? groups.find((x) => x.payer === 'bank' && x.mode === 'batch' && x.cases[0].branch_id === c.branch_id) : undefined;
      if (g) g.cases.push(c);
      else groups.push({ kind: input.kind, mode: input.mode === 'batch' && payer === 'bank' ? 'batch' : 'case', payer, cases: [c] });
    }
    // a batch of one is a single-case bill
    for (const g of groups) if (g.cases.length === 1) g.mode = 'case';
    for (const g of groups) out.push(await issue(actor, g, date, s, seller, addr, tx));
    for (const c of cases) await syncStage(c.id, actor.id ?? null, tx);
    return out;
  });
  return made;
}

/** Proforma → tax invoice with the same lines; advances received move to the tax invoice. */
async function convert(actor: Actor, proformaId: number, date: string, tx: Tx) {
  const p = await tx.selectFrom('invoices').selectAll().where('id', '=', proformaId).where('firm_id', '=', actor.firmId!).forUpdate().executeTakeFirst();
  if (!p || p.kind !== 'proforma') throw notFound('Proforma invoice');
  if (p.converted_invoice_id || p.cancelled_at) throw badRequest(`${p.invoice_no} is already ${p.cancelled_at ? 'cancelled' : 'converted'}`);
  if (date < ymd(p.invoice_date)) throw badRequest('The tax invoice date cannot be before the proforma date');
  const lines = await tx.selectFrom('invoice_lines').selectAll().where('invoice_id', '=', p.id).orderBy('line_no').execute();
  const ids = lines.map((l) => l.assignment_id).filter((x): x is number => x !== null);
  const s = await getSettings(actor.firmId!, tx);
  const cases = ids.length ? await casesForBilling(actor.firmId!, ids, tx) : [];
  if (!cases.length) throw badRequest('The proforma has no case to bill');
  const billed = await tx.selectFrom('invoice_lines as il').innerJoin('invoices as i', 'i.id', 'il.invoice_id').select('i.invoice_no').where('il.assignment_id', 'in', ids).where('i.kind', '=', 'tax').where('il.released_at', 'is', null).executeTakeFirst();
  if (billed) throw badRequest(`Already billed on ${billed.invoice_no}`);
  // the tax invoice is addressed like the proforma and keeps its amounts
  const seller = await sellerSnapshot(actor.firmId!, s, tx);
  const g: Group = { kind: 'tax', mode: p.bill_mode, payer: p.payer, cases };
  const made = await issue(actor, g, date, { ...s, gst_pct: Number(p.gst_rate) }, seller, await addresses(ids, tx), tx, {
    proformaId: p.id, lines: lines.map((l) => ({ assignment_id: l.assignment_id, ref_text: cases.find((c) => c.id === l.assignment_id)?.report_no ?? l.ref_text, description: l.description.replace(/^Advance towards professional fees/, 'Professional fees'), amount: Number(l.amount) })),
  });
  await tx.updateTable('invoices').set({ bill_to_name: p.bill_to_name, bill_to_address: p.bill_to_address, bill_to_gstin: p.bill_to_gstin, bill_to_email: p.bill_to_email, bill_to_phone: p.bill_to_phone }).where('id', '=', made.id).execute();
  await tx.updateTable('payments').set({ invoice_id: made.id, note: `Advance against ${p.invoice_no}` }).where('invoice_id', '=', p.id).execute();
  await tx.updateTable('invoices').set({ converted_invoice_id: made.id }).where('id', '=', p.id).execute();
  await audit(actor, { entityType: 'invoice', entityId: p.id, assignmentId: ids[0] ?? null, action: 'invoice.convert', summary: `Proforma ${p.invoice_no} converted to tax invoice ${made.invoiceNo}; advance adjusted.` }, tx);
  return made;
}

export async function convertProforma(actor: Actor, proformaId: number, date?: string | null) {
  await assertBilling(actor.firmId!);
  const d = checkDate(date, 'Invoice date');
  return db.transaction().execute(async (tx) => {
    const made = await convert(actor, proformaId, d, tx);
    await syncInvoiceCases(made.id, actor.id ?? null, tx);
    return made;
  });
}

export async function cancelProforma(actor: Actor, proformaId: number, reason: string) {
  if (!reason?.trim()) throw badRequest('Give the reason for cancelling');
  const p = await db.selectFrom('invoices').selectAll().where('id', '=', proformaId).where('firm_id', '=', actor.firmId!).executeTakeFirst();
  if (!p || p.kind !== 'proforma') throw notFound('Proforma invoice');
  if (p.converted_invoice_id || p.cancelled_at) throw badRequest(`${p.invoice_no} is already ${p.cancelled_at ? 'cancelled' : 'converted'}`);
  const paid = (await balances([p.id])).get(p.id)!;
  if (paid.paid > 0) throw badRequest('An advance was received on this proforma; convert it to a tax invoice instead');
  await db.updateTable('invoices').set({ cancelled_at: new Date() }).where('id', '=', p.id).execute();
  await audit(actor, { entityType: 'invoice', entityId: p.id, action: 'invoice.cancel', summary: `Proforma ${p.invoice_no} cancelled.`, reason });
}

export async function listInvoices(firmId: number, f: { from?: string; to?: string; kind?: 'tax' | 'proforma' } = {}) {
  return withTotals(firmId, await loadInvoices(firmId, f));
}

export async function invoiceDetail(firmId: number, id: number, tx: Tx = db) {
  const [inv] = await loadInvoices(firmId, { ids: [id] }, tx);
  if (!inv) throw notFound('Invoice');
  const [row] = await withTotals(firmId, [inv], tx);
  const [lines, payments, notes] = await Promise.all([
    tx.selectFrom('invoice_lines as il').leftJoin('assignments as a', 'a.id', 'il.assignment_id').select(['il.id', 'il.line_no', 'il.assignment_id', 'il.ref_text', 'il.description', 'il.amount', 'il.released_at', 'a.case_no']).where('il.invoice_id', '=', id).orderBy('il.line_no').execute(),
    tx.selectFrom('payments').selectAll().where('invoice_id', '=', id).orderBy('received_on').orderBy('id').execute(),
    tx.selectFrom('credit_notes').selectAll().where('invoice_id', '=', id).orderBy('id').execute(),
  ]);
  const linked = inv.proforma_id || inv.converted_invoice_id
    ? await tx.selectFrom('invoices').select(['id', 'invoice_no', 'kind']).where('id', 'in', [inv.proforma_id, inv.converted_invoice_id].filter((x): x is number => !!x)).execute() : [];
  const s = await getSettings(firmId, tx);
  return {
    ...row, seller: json<Record<string, any>>(inv.seller_json, {}), pos_name: gstStateName(inv.pos_code), lines,
    payments: payments.map((p) => ({ ...p, received_on: ymd(p.received_on) })), notes: notes.map((n) => ({ ...n, note_date: ymd(n.note_date) })), linked,
    default_tds: inv.payer === 'bank' && inv.kind === 'tax' ? Math.round((Number(inv.taxable) * s.tds_pct) / 100) : 0, tds_pct: s.tds_pct,
  };
}
export type InvoiceDetail = Awaited<ReturnType<typeof invoiceDetail>>;

export async function invoicePdfFor(firmId: number, id: number) {
  const inv = await invoiceDetail(firmId, id);
  return { pdf: await invoicePdf(inv, firmId), name: `${inv.invoice_no.replace(/[\\/]+/g, '-')}.pdf` };
}

// ---- payments, credit notes, write-offs -------------------------------------------------------------

export async function recordPayment(actor: Actor, invoiceId: number, p: { date?: string | null; amount: number; tds?: number; mode: string; ref?: string | null; note?: string | null }) {
  await assertBilling(actor.firmId!);
  const date = checkDate(p.date, 'Payment date');
  const amount = r2(Number(p.amount) || 0);
  const tds = r2(Number(p.tds) || 0);
  if (amount < 0 || tds < 0 || amount + tds <= 0) throw badRequest('Enter the amount received');
  return db.transaction().execute(async (tx) => {
    const inv = await tx.selectFrom('invoices').selectAll().where('id', '=', invoiceId).where('firm_id', '=', actor.firmId!).forUpdate().executeTakeFirst();
    if (!inv) throw notFound('Invoice');
    if (inv.converted_invoice_id || inv.cancelled_at) throw badRequest(`${inv.invoice_no} is ${inv.cancelled_at ? 'cancelled' : 'converted'}; record payments on the tax invoice`);
    if (date < ymd(inv.invoice_date)) throw badRequest('The payment date cannot be before the invoice date');
    const t = (await balances([inv.id], tx)).get(inv.id)!;
    if (t.balance <= 0) throw badRequest(`${inv.invoice_no} has no balance`);
    if (amount + tds > t.balance + 0.5) throw badRequest(`That is more than the balance of Rs. ${inr(t.balance)}`);
    await tx.insertInto('payments').values({ firm_id: actor.firmId!, invoice_id: inv.id, received_on: asDate(date), amount, tds, pay_mode: p.mode, ref_no: p.ref?.trim() || null, note: p.note?.trim() || null, created_by: actor.id ?? null }).execute();
    const left = r2(t.balance - amount - tds);
    await audit(actor, { entityType: 'invoice', entityId: inv.id, action: 'payment.record', summary: `Payment on ${inv.invoice_no}: Rs. ${inr(amount)} by ${p.mode}${p.ref ? ` (${p.ref})` : ''}${tds ? ` + TDS Rs. ${inr(tds)}` : ''}. ${left > 0.5 ? `Balance Rs. ${inr(left)}.` : 'Fully paid.'}` }, tx);
    await publish({ type: 'payment.recorded', firmId: actor.firmId, entityType: 'invoice', entityId: inv.id, payload: { amount, tds } }, tx);
    await syncInvoiceCases(inv.id, actor.id ?? null, tx);
  });
}

/**
 * Credit note (numbered, GST reversed in proportion) or write-off (no GST effect) for part or all of
 * the balance. A credit note for the whole of an unpaid invoice can release its cases to be billed again.
 */
export async function closeBalance(actor: Actor, invoiceId: number, c: { kind: 'credit_note' | 'write_off'; amount?: number | null; reason: string; release?: boolean; date?: string | null }) {
  await assertBilling(actor.firmId!);
  if (!c.reason?.trim()) throw badRequest('Give the reason');
  const date = checkDate(c.date, 'Date');
  return db.transaction().execute(async (tx) => {
    const inv = await tx.selectFrom('invoices').selectAll().where('id', '=', invoiceId).where('firm_id', '=', actor.firmId!).forUpdate().executeTakeFirst();
    if (!inv) throw notFound('Invoice');
    if (inv.kind !== 'tax') throw badRequest('Credit notes and write-offs are for tax invoices; cancel a proforma instead');
    if (date < ymd(inv.invoice_date)) throw badRequest('The date cannot be before the invoice date');
    const t = (await balances([inv.id], tx)).get(inv.id)!;
    if (t.balance <= 0) throw badRequest(`${inv.invoice_no} has no balance`);
    const amount = r2(c.amount ?? t.balance);
    if (!(amount > 0) || amount > t.balance + 0.5) throw badRequest(`Amount must be between 1 and the balance of Rs. ${inr(t.balance)}`);
    const release = !!c.release && c.kind === 'credit_note';
    if (release && (t.paid > 0 || Math.abs(amount - Number(inv.total)) > 0.5 || t.credited + t.writtenOff > 0)) throw badRequest('Only a credit note for the whole of an unpaid invoice can release its cases to be billed again');
    const s = await getSettings(actor.firmId!, tx);
    let row: Record<string, unknown> = { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    let noteNo: string | null = null;
    let fy: string | null = null;
    let seq: number | null = null;
    if (c.kind === 'credit_note') {
      row = creditSplit(amount, { total: Number(inv.total), taxable: Number(inv.taxable), cgst: Number(inv.cgst), sgst: Number(inv.sgst), igst: Number(inv.igst), gst_rate: Number(inv.gst_rate) });
      fy = fyOf(date);
      seq = await nextNumber(tx, actor.firmId!, 'credit_note', fy);
      noteNo = fillPattern(s.credit_note_pattern, { FY: fy, N: pad(seq) });
    }
    const r = await tx.insertInto('credit_notes').values({ firm_id: actor.firmId!, invoice_id: inv.id, kind: c.kind, note_no: noteNo, fy, seq, note_date: asDate(date), ...row, total: amount, reason: c.reason.trim(), released_cases: release ? 1 : 0, created_by: actor.id ?? null } as any).executeTakeFirstOrThrow();
    if (release) await tx.updateTable('invoice_lines').set({ released_at: new Date() }).where('invoice_id', '=', inv.id).execute();
    await audit(actor, {
      entityType: 'invoice', entityId: inv.id, action: c.kind === 'credit_note' ? 'invoice.credit_note' : 'invoice.write_off',
      summary: c.kind === 'credit_note' ? `Credit note ${noteNo} for Rs. ${inr(amount)} against ${inv.invoice_no}.${release ? ' Cases released to be billed again.' : ''}` : `Rs. ${inr(amount)} written off on ${inv.invoice_no}.`,
      reason: c.reason.trim(),
    }, tx);
    await syncInvoiceCases(inv.id, actor.id ?? null, tx);
    return { id: Number(r.insertId), noteNo };
  });
}

// ---- messages and sending ------------------------------------------------------------------------------

async function messageTemplates(firmId: number) {
  const w = await activeConfig('wording', 'default', firmId);
  return (w?.payload as any)?.messages ?? {};
}
const fill = (t: string | undefined, vars: Record<string, unknown>) => (t ? interpolate(t, (n) => (Object.hasOwn(vars, n) ? vars[n] : null), { allowMissing: true }) ?? '' : '');

export async function invoiceMessage(firmId: number, id: number) {
  const inv = await invoiceDetail(firmId, id);
  const msgs = await messageTemplates(firmId);
  const tpl = inv.payer === 'bank' ? msgs.invoice_bank : msgs.invoice_borrower;
  const vars = {
    'INV.NO': inv.invoice_no, 'INV.DATE': ddmmyyyy(inv.invoice_date), 'INV.KIND': inv.kind, 'INV.PAYER': inv.payer, 'INV.TO': inv.bill_to_name,
    'INV.FOR': inv.lines.length > 1 ? `${inv.lines.length} valuation reports${inv.period_label ? ` (${inv.period_label})` : ''}` : `valuation report ${inv.lines[0]?.ref_text ?? ''}`.trim(),
    'INV.TOTAL': inr(Number(inv.total)), 'INV.BALANCE': inr(inv.balance), 'INV.UPI': inv.seller.upi_id || null, 'FIRM.NAME': inv.seller.name,
  };
  return { to: inv.bill_to_email, phone: inv.bill_to_phone, subject: fill(tpl?.subject, vars), body: fill(tpl?.body, vars) };
}

export async function sendInvoiceEmail(actor: Actor, id: number, m: { to: string; subject: string; body: string }) {
  const { pdf, name } = await invoicePdfFor(actor.firmId!, id);
  const inv = await db.selectFrom('invoices').select(['invoice_no', 'bill_to_email']).where('id', '=', id).where('firm_id', '=', actor.firmId!).executeTakeFirstOrThrow();
  await sendMail({ to: m.to, subject: m.subject, text: m.body, attachments: [{ filename: name, content: pdf }] });
  await db.insertInto('messages').values({ firm_id: actor.firmId!, channel: 'email', purpose: 'invoice_email', to_text: m.to, subject: m.subject, body: m.body, status: 'sent', created_by: actor.id ?? null }).execute();
  await db.updateTable('invoices').set({ sent_at: new Date(), ...(inv.bill_to_email ? {} : { bill_to_email: m.to }) }).where('id', '=', id).execute();
  await audit(actor, { entityType: 'invoice', entityId: id, action: 'invoice.email', summary: `Invoice ${inv.invoice_no} emailed to ${m.to} with PDF.` });
}

/** WhatsApp has no sending API here: the text opens in WhatsApp; this records that it was sent. */
export async function logWhatsapp(actor: Actor, id: number, m: { phone: string; body: string }) {
  const inv = await db.selectFrom('invoices').select(['invoice_no', 'bill_to_phone']).where('id', '=', id).where('firm_id', '=', actor.firmId!).executeTakeFirst();
  if (!inv) throw notFound('Invoice');
  await db.insertInto('messages').values({ firm_id: actor.firmId!, channel: 'whatsapp', purpose: 'invoice_whatsapp', to_text: m.phone, body: m.body, status: 'copied', created_by: actor.id ?? null }).execute();
  await db.updateTable('invoices').set({ sent_at: new Date(), ...(inv.bill_to_phone ? {} : { bill_to_phone: m.phone }) }).where('id', '=', id).execute();
  await audit(actor, { entityType: 'invoice', entityId: id, action: 'invoice.whatsapp', summary: `Invoice ${inv.invoice_no} sent on WhatsApp to ${m.phone}.` });
}

// ---- follow up: ageing, outstanding by party, reminders ----------------------------------------------------

export async function ageing(firmId: number) {
  const inv = (await listInvoices(firmId, { kind: 'tax' })).filter((i) => i.balance > 0);
  const buckets = AGEING_BUCKETS.map((b) => {
    const items = inv.filter((i) => i.age_days >= b.from && i.age_days <= b.to);
    return { key: b.key, label: b.label, amount: r2(items.reduce((t, i) => t + i.balance, 0)), count: items.length };
  });
  const parties = new Map<string, { party: string; gstin: string | null; email: string | null; phone: string | null; invoices: typeof inv; amount: number; oldest: string }>();
  for (const i of inv) {
    const k = `${i.bill_to_name}|${i.bill_to_gstin ?? ''}`;
    const p = parties.get(k) ?? { party: i.bill_to_name, gstin: i.bill_to_gstin, email: i.bill_to_email, phone: i.bill_to_phone, invoices: [], amount: 0, oldest: i.invoice_date };
    p.invoices.push(i);
    p.amount = r2(p.amount + i.balance);
    if (i.invoice_date < p.oldest) p.oldest = i.invoice_date;
    p.email ??= i.bill_to_email;
    p.phone ??= i.bill_to_phone;
    parties.set(k, p);
  }
  const receipts = await db.selectFrom('payments as p').innerJoin('invoices as i', 'i.id', 'p.invoice_id')
    .select(['p.id', 'p.received_on', 'p.amount', 'p.tds', 'p.pay_mode', 'p.ref_no', 'p.note', 'i.id as invoice_id', 'i.invoice_no', 'i.bill_to_name'])
    .where('p.firm_id', '=', firmId).orderBy('p.received_on', 'desc').orderBy('p.id', 'desc').limit(200).execute();
  return {
    buckets,
    parties: [...parties.values()].sort((a, b) => b.amount - a.amount).map((p) => ({ ...p, invoices: p.invoices.map((i) => ({ id: i.id, invoice_no: i.invoice_no, invoice_date: i.invoice_date, balance: i.balance, age_days: i.age_days })) })),
    receipts: receipts.map((r) => ({ ...r, received_on: ymd(r.received_on) })),
  };
}

export async function reminderMessage(firmId: number, party: string) {
  const a = await ageing(firmId);
  const p = a.parties.find((x) => x.party === party);
  if (!p) throw notFound('Outstanding party');
  const firm = await db.selectFrom('firms').select('name').where('id', '=', firmId).executeTakeFirstOrThrow();
  const tpl = (await messageTemplates(firmId)).payment_reminder;
  const vars = {
    'PARTY.NAME': p.party, 'PARTY.TOTAL': inr(p.amount), 'FIRM.NAME': firm.name,
    'PARTY.LIST': p.invoices.map((i, n) => `${n + 1}. ${i.invoice_no} dated ${ddmmyyyy(i.invoice_date)}: Rs. ${inr(i.balance)} (${i.age_days} days)`).join('\n'),
  };
  return { to: p.email, phone: p.phone, subject: fill(tpl?.subject, vars), body: fill(tpl?.body, vars) };
}

export async function sendReminderEmail(actor: Actor, party: string, m: { to: string; subject: string; body: string }) {
  await sendMail({ to: m.to, subject: m.subject, text: m.body });
  await db.insertInto('messages').values({ firm_id: actor.firmId!, channel: 'email', purpose: 'payment_reminder', to_text: m.to, subject: m.subject, body: m.body, status: 'sent', created_by: actor.id ?? null }).execute();
  await audit(actor, { entityType: 'invoice', action: 'payment.reminder', summary: `Payment reminder emailed to ${party} (${m.to}).` });
}

// ---- dashboard and GST tracking -------------------------------------------------------------------------------

export async function summary(firmId: number) {
  const [ready, inv] = await Promise.all([readyToBill(firmId), listInvoices(firmId, { kind: 'tax' })]);
  const open = inv.filter((i) => i.balance > 0);
  return {
    readyCount: ready.length, readyAmount: r2(ready.reduce((t, r) => t + Number(r.fee ?? 0), 0)),
    outstanding: r2(open.reduce((t, i) => t + i.balance, 0)), overdue: r2(open.filter((i) => i.status === 'overdue').reduce((t, i) => t + i.balance, 0)),
    tds: r2(inv.reduce((t, i) => t + i.tds, 0)),
  };
}

/** Month by month: GST charged (net of credit notes), GST share of payments received, GST still to collect. */
export async function gstByMonth(firmId: number) {
  const inv = await listInvoices(firmId, { kind: 'tax' });
  const cns = await db.selectFrom('credit_notes').select(['invoice_id', 'cgst', 'sgst', 'igst', 'kind']).where('firm_id', '=', firmId).where('kind', '=', 'credit_note').execute();
  const m = new Map<string, { month: string; label: string; invoices: number; taxable: number; gst: number; credit: number; received: number; toCollect: number }>();
  for (const i of inv) {
    const k = i.invoice_date.slice(0, 7);
    const row = m.get(k) ?? { month: k, label: monthLabel(k), invoices: 0, taxable: 0, gst: 0, credit: 0, received: 0, toCollect: 0 };
    const gst = Number(i.cgst) + Number(i.sgst) + Number(i.igst);
    const credit = cns.filter((c) => c.invoice_id === i.id).reduce((t, c) => t + Number(c.cgst) + Number(c.sgst) + Number(c.igst), 0);
    const received = Number(i.total) > 0 ? (gst * Math.min(1, i.paid / Number(i.total))) : 0;
    row.invoices++;
    row.taxable = r2(row.taxable + Number(i.taxable));
    row.gst = r2(row.gst + gst);
    row.credit = r2(row.credit + credit);
    row.received = r2(row.received + received);
    // written-off GST was still due to the government, so it stays in "to collect" only while a balance is open
    row.toCollect = r2(row.toCollect + (i.balance > 0 ? Math.max(0, gst - credit - received) : 0));
    m.set(k, row);
  }
  const months = [...m.values()].sort((a, b) => b.month.localeCompare(a.month));
  return {
    months,
    totals: { gst: r2(months.reduce((t, x) => t + x.gst - x.credit, 0)), received: r2(months.reduce((t, x) => t + x.received, 0)), toCollect: r2(months.reduce((t, x) => t + x.toCollect, 0)) },
  };
}

// ---- engineer payouts ---------------------------------------------------------------------------------------

const monthRange = (ym: string) => {
  if (!/^\d{4}-\d{2}$/.test(ym)) throw badRequest('Month like 2026-10');
  const [y, mo] = ym.split('-').map(Number);
  // months are counted in India time
  return { from: new Date(Date.UTC(y, mo - 1, 1) - IST), to: new Date(Date.UTC(y, mo, 1) - IST) };
};

export async function engineerPayouts(firmId: number, ym: string) {
  const { from, to } = monthRange(ym);
  const s = await getSettings(firmId);
  const visits = await db.selectFrom('site_visits as v').innerJoin('assignments as a', 'a.id', 'v.assignment_id')
    .select((eb) => [eb.fn.coalesce('v.engineer_id', 'a.engineer_id').as('engineer_id'), eb.fn.countAll<number>().as('n')])
    .where('a.firm_id', '=', firmId).where('v.status', '=', 'submitted').where('v.submitted_at', '>=', from).where('v.submitted_at', '<', to)
    .groupBy((eb) => eb.fn.coalesce('v.engineer_id', 'a.engineer_id')).execute();
  const [engs, paid] = await Promise.all([
    db.selectFrom('engineers').select(['id', 'name', 'phone', 'fee_per_visit', 'status']).where('firm_id', '=', firmId).orderBy('name').execute(),
    db.selectFrom('engineer_payouts').selectAll().where('firm_id', '=', firmId).where('period_month', '=', ym).execute(),
  ]);
  return {
    month: ym, label: monthLabel(ym), defaultFee: s.engineer_fee,
    rows: engs.map((e) => {
      const n = Number(visits.find((v) => Number(v.engineer_id) === e.id)?.n ?? 0);
      const fee = Number(e.fee_per_visit ?? s.engineer_fee);
      const p = paid.find((x) => x.engineer_id === e.id);
      return { engineer_id: e.id, name: e.name, phone: e.phone, visits: p ? p.visits : n, fee: p ? Number(p.fee_per_visit) : fee, amount: p ? Number(p.amount) : r2(n * fee), paid_on: p ? ymd(p.paid_on) : null, ref_no: p?.ref_no ?? null, current_visits: n };
    }).filter((r) => r.visits > 0 || r.paid_on),
  };
}

export async function markEngineerPaid(actor: Actor, engineerId: number, ym: string, p: { paidOn?: string | null; ref?: string | null }) {
  await assertBilling(actor.firmId!);
  const date = checkDate(p.paidOn, 'Paid on');
  const e = await db.selectFrom('engineers').select(['id', 'name']).where('id', '=', engineerId).where('firm_id', '=', actor.firmId!).executeTakeFirst();
  if (!e) throw notFound('Engineer');
  const row = (await engineerPayouts(actor.firmId!, ym)).rows.find((r) => r.engineer_id === engineerId);
  if (!row || row.paid_on) throw badRequest(row ? `Already marked paid on ${ddmmyyyy(row.paid_on)}` : `No visits for ${e.name} in ${monthLabel(ym)}`);
  await db.insertInto('engineer_payouts').values({ firm_id: actor.firmId!, engineer_id: engineerId, period_month: ym, visits: row.visits, fee_per_visit: row.fee, amount: row.amount, paid_on: asDate(date), ref_no: p.ref?.trim() || null, created_by: actor.id ?? null }).execute();
  await audit(actor, { entityType: 'engineer', entityId: engineerId, action: 'payout.paid', summary: `${e.name}: ${row.visits} visits in ${monthLabel(ym)} × Rs. ${inr(row.fee)} = Rs. ${inr(row.amount)} marked paid.` });
}
