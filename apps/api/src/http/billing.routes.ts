import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PAY_MODES, financialYear } from '@vm/shared';
import { db } from '../db/index.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { audit } from '../platform/audit.js';
import { actorOf, authenticate, requirePerm } from '../platform/auth.js';
import { peekNumber, setNext } from '../platform/sequences.js';
import { DEFAULT_SETTINGS, flagsFor, getSettings, setSettings, type FirmSettings } from '../platform/settings.js';
import { analytics } from '../modules/analytics/service.js';
import * as bill from '../modules/billing/service.js';
import { EXPORTS, accountingExport, type ExportKind } from '../modules/billing/exports.js';
import { IMPORTS, exportRows, importCsv, type ImportKind } from '../modules/firm/imports.js';
import { parseCsv } from './csv.js';
import { body, idParam, multipartFiles } from './util.js';

const BILLING_KEYS = ['invoice_pattern', 'proforma_pattern', 'credit_note_pattern', 'sac', 'gst_pct', 'tds_pct', 'due_days', 'upi_id', 'bank_account', 'invoice_note', 'engineer_fee', 'tally_ledgers'] as const;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish();

export async function billingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  const can = requirePerm;

  // ---- setup ----
  app.get('/api/billing/setup', { preHandler: can('bill') }, async (req) => {
    const firmId = req.auth!.firmId;
    const s = await getSettings(firmId);
    const firm = await db.selectFrom('firms').select(['name', 'gstin', 'pan', 'state_code', 'address']).where('id', '=', firmId).executeTakeFirstOrThrow();
    const fy = financialYear().short;
    return {
      enabled: (await flagsFor(firmId)).billing, firm, fy, settings: Object.fromEntries(BILLING_KEYS.map((k) => [k, s[k]])),
      next: { invoice: await peekNumber(db, firmId, 'invoice', fy), proforma: await peekNumber(db, firmId, 'proforma', fy), credit_note: await peekNumber(db, firmId, 'credit_note', fy) },
      payModes: PAY_MODES, exports: EXPORTS,
    };
  });
  app.patch('/api/billing/setup', { preHandler: can('bill') }, async (req) => {
    const b = body(req, z.object({ settings: z.record(z.string(), z.any()).optional(), pan: z.string().nullish(), nextInvoice: z.number().int().positive().optional() }));
    const firmId = req.auth!.firmId;
    // where customers pay (bank account, UPI) and the PAN on invoices need the Settings permission too
    const paymentKeys = ['bank_account', 'upi_id'].filter((k) => b.settings?.[k] !== undefined);
    if ((paymentKeys.length || b.pan !== undefined) && req.auth!.role !== 'admin' && !req.auth!.perms.has('set')) throw forbidden('Changing the bank account, UPI ID or PAN needs the Settings permission');
    const patch = Object.fromEntries(Object.entries(b.settings ?? {}).filter(([k]) => (BILLING_KEYS as readonly string[]).includes(k))) as Partial<FirmSettings>;
    for (const k of ['invoice_pattern', 'proforma_pattern', 'credit_note_pattern'] as const) if (patch[k] !== undefined && !String(patch[k]).includes('{N}')) throw badRequest('Each number pattern needs {N} for the serial');
    if (patch.sac !== undefined && !/^\d{4,8}$/.test(String(patch.sac))) throw badRequest('SAC: 4 to 8 digits');
    for (const [k, max] of [['gst_pct', 28], ['tds_pct', 30], ['due_days', 365]] as const) if (patch[k] !== undefined && !(Number(patch[k]) >= 0 && Number(patch[k]) <= max)) throw badRequest(`${k.replace('_', ' ')}: 0 to ${max}`);
    if (patch.engineer_fee !== undefined && !(Number(patch.engineer_fee) >= 0)) throw badRequest('Engineer fee must be a number');
    if (patch.bank_account) patch.bank_account = { ...DEFAULT_SETTINGS.bank_account, ...patch.bank_account };
    if (patch.tally_ledgers) patch.tally_ledgers = { ...DEFAULT_SETTINGS.tally_ledgers, ...patch.tally_ledgers };
    for (const k of ['gst_pct', 'tds_pct', 'due_days', 'engineer_fee'] as const) if (patch[k] !== undefined) (patch as any)[k] = Number(patch[k]);
    await setSettings(firmId, patch, req.auth!.userId);
    if (b.pan !== undefined) {
      if (b.pan && !/^[A-Z]{5}\d{4}[A-Z]$/i.test(b.pan)) throw badRequest('PAN like ABCDE1234F');
      await db.updateTable('firms').set({ pan: b.pan ? b.pan.toUpperCase() : null }).where('id', '=', firmId).execute();
    }
    if (b.nextInvoice !== undefined) {
      const fy = financialYear().short;
      if (b.nextInvoice < (await peekNumber(db, firmId, 'invoice', fy))) throw badRequest('Invoice numbers cannot go backwards');
      await setNext(db, firmId, 'invoice', fy, b.nextInvoice);
    }
    await audit(actorOf(req), { entityType: 'firm', entityId: firmId, action: 'billing.setup', summary: `Billing setup changed: ${[...Object.keys(patch), ...(b.pan !== undefined ? ['PAN'] : []), ...(b.nextInvoice ? ['next invoice no.'] : [])].join(', ')}`, after: b });
    return { ok: true };
  });

  // ---- work lists ----
  app.get('/api/billing/summary', { preHandler: can('bill') }, async (req) => bill.summary(req.auth!.firmId));
  app.get('/api/billing/ready', { preHandler: can('bill') }, async (req) => bill.readyToBill(req.auth!.firmId));
  app.get('/api/billing/proforma-cases', { preHandler: can('bill') }, async (req) => bill.proformaCandidates(req.auth!.firmId));
  app.patch('/api/billing/cases/:id', { preHandler: can('bill') }, async (req) => {
    const b = body(req, z.object({ fee: z.number().positive().nullable().optional(), payer: z.enum(['bank', 'borrower']).nullable().optional() }));
    await bill.setCaseBilling(actorOf(req), idParam(req), b);
    return { ok: true };
  });
  /** Billing state of one case (Output tab); visible to anyone who can open the case. */
  app.get('/api/assignments/:id/billing', async (req) => {
    const id = idParam(req);
    const a = await db.selectFrom('assignments').select(['id', 'sent_at', 'stage']).where('id', '=', id).where('firm_id', '=', req.auth!.firmId).executeTakeFirst();
    if (!a) throw badRequest('Not found');
    const rows = await db.selectFrom('invoice_lines as il').innerJoin('invoices as i', 'i.id', 'il.invoice_id').select(['i.id', 'i.kind', 'i.invoice_no', 'i.invoice_date', 'i.total', 'i.converted_invoice_id', 'i.cancelled_at', 'il.released_at'])
      .where('il.assignment_id', '=', id).orderBy('i.id').execute();
    const bal = await bill.balances(rows.map((r) => r.id));
    return {
      enabled: (await flagsFor(req.auth!.firmId)).billing, sent: !!a.sent_at, stage: a.stage,
      invoices: rows.map((r) => ({ ...r, invoice_date: bill.ymd(r.invoice_date), balance: bal.get(r.id)?.balance ?? 0, paid: bal.get(r.id)?.paid ?? 0 })),
    };
  });

  // ---- invoices ----
  app.post('/api/billing/invoices', { preHandler: can('bill') }, async (req) => {
    const b = body(req, z.object({ assignmentIds: z.array(z.number().int()).min(1).max(500), mode: z.enum(['case', 'batch']), kind: z.enum(['tax', 'proforma']), date }));
    return bill.createInvoices(actorOf(req), b);
  });
  app.get('/api/billing/invoices', { preHandler: can('bill') }, async (req) => {
    const q = req.query as any;
    return bill.listInvoices(req.auth!.firmId, { from: q.from || undefined, to: q.to || undefined, kind: ['tax', 'proforma'].includes(q.kind) ? q.kind : undefined });
  });
  app.get('/api/billing/invoices/:id', { preHandler: can('bill') }, async (req) => bill.invoiceDetail(req.auth!.firmId, idParam(req)));
  app.get('/api/billing/invoices/:id/pdf', { preHandler: can('bill') }, async (req, reply) => {
    const { pdf, name } = await bill.invoicePdfFor(req.auth!.firmId, idParam(req));
    reply.header('Content-Type', 'application/pdf').header('Cache-Control', 'no-store').header('Content-Disposition', `inline; filename="${encodeURIComponent(name)}"`);
    return reply.send(pdf);
  });
  app.get('/api/billing/invoices/:id/message', { preHandler: can('bill') }, async (req) => bill.invoiceMessage(req.auth!.firmId, idParam(req)));
  app.post('/api/billing/invoices/:id/email', { preHandler: can('bill') }, async (req) => {
    const b = body(req, z.object({ to: z.string().email(), subject: z.string().min(1), body: z.string().min(1) }));
    await bill.sendInvoiceEmail(actorOf(req), idParam(req), b);
    return { ok: true };
  });
  app.post('/api/billing/invoices/:id/whatsapp', { preHandler: can('bill') }, async (req) => {
    const b = body(req, z.object({ phone: z.string().min(8), body: z.string().min(1) }));
    await bill.logWhatsapp(actorOf(req), idParam(req), b);
    return { ok: true };
  });
  app.post('/api/billing/invoices/:id/payments', { preHandler: can('bill') }, async (req) => {
    const b = body(req, z.object({ date, amount: z.number().min(0), tds: z.number().min(0).optional(), mode: z.enum(PAY_MODES), ref: z.string().max(100).nullish(), note: z.string().max(500).nullish() }));
    await bill.recordPayment(actorOf(req), idParam(req), b);
    return bill.invoiceDetail(req.auth!.firmId, idParam(req));
  });
  app.post('/api/billing/invoices/:id/close', { preHandler: can('bill') }, async (req) => {
    const b = body(req, z.object({ kind: z.enum(['credit_note', 'write_off']), amount: z.number().positive().nullish(), reason: z.string().min(3).max(1000), release: z.boolean().optional(), date }));
    await bill.closeBalance(actorOf(req), idParam(req), b);
    return bill.invoiceDetail(req.auth!.firmId, idParam(req));
  });
  app.post('/api/billing/invoices/:id/convert', { preHandler: can('bill') }, async (req) => {
    const b = body(req, z.object({ date }));
    return bill.convertProforma(actorOf(req), idParam(req), b.date);
  });
  app.post('/api/billing/invoices/:id/cancel', { preHandler: can('bill') }, async (req) => {
    const b = body(req, z.object({ reason: z.string().min(3) }));
    await bill.cancelProforma(actorOf(req), idParam(req), b.reason);
    return { ok: true };
  });

  // ---- follow up and GST ----
  app.get('/api/billing/ageing', { preHandler: can('bill') }, async (req) => bill.ageing(req.auth!.firmId));
  app.get('/api/billing/reminder', { preHandler: can('bill') }, async (req) => bill.reminderMessage(req.auth!.firmId, String((req.query as any).party ?? '')));
  app.post('/api/billing/reminder/email', { preHandler: can('bill') }, async (req) => {
    const b = body(req, z.object({ party: z.string(), to: z.string().email(), subject: z.string().min(1), body: z.string().min(1) }));
    await bill.sendReminderEmail(actorOf(req), b.party, b);
    return { ok: true };
  });
  app.get('/api/billing/gst', { preHandler: can('bill') }, async (req) => bill.gstByMonth(req.auth!.firmId));

  // ---- engineer payouts ----
  app.get('/api/billing/payouts', { preHandler: can('bill') }, async (req) => bill.engineerPayouts(req.auth!.firmId, String((req.query as any).month ?? bill.todayIst().slice(0, 7))));
  app.post('/api/billing/payouts/:id', { preHandler: can('bill') }, async (req) => {
    const b = body(req, z.object({ month: z.string(), paidOn: date, ref: z.string().max(100).nullish() }));
    await bill.markEngineerPaid(actorOf(req), idParam(req), b.month, b);
    return bill.engineerPayouts(req.auth!.firmId, b.month);
  });

  // ---- accounting exports ----
  app.get('/api/billing/export/:kind', { preHandler: can('exp') }, async (req, reply) => {
    const q = req.query as any;
    const out = await accountingExport(req.auth!.firmId, (req.params as any).kind as ExportKind, String(q.from ?? ''), String(q.to ?? ''));
    await audit(actorOf(req), { entityType: 'export', entityId: (req.params as any).kind, action: 'billing.export', summary: `${EXPORTS[(req.params as any).kind as ExportKind]} exported for ${q.from} to ${q.to} (${out.count} rows).` });
    reply.header('Content-Type', `${out.mime}; charset=utf-8`).header('Content-Disposition', `attachment; filename="${out.name}"`).header('Cache-Control', 'no-store');
    // BOM so Excel opens UTF-8 CSV correctly
    return reply.send(out.mime === 'text/csv' ? `﻿${out.body}` : out.body);
  });

  // ---- analytics ----
  app.get('/api/analytics', async (req) => {
    const q = req.query as any;
    return analytics(req.auth!.firmId, { weeks: Number(q.weeks ?? 12), bankId: q.bankId ? Number(q.bankId) : null });
  });

  // ---- CSV imports (masters and history) ----
  app.get('/api/import', async () => IMPORTS);
  app.post('/api/import/:kind', { preHandler: can('set') }, async (req) => {
    const kind = (req.params as any).kind as ImportKind;
    if (!(kind in IMPORTS)) throw badRequest('Unknown import');
    const { files, fields } = await multipartFiles(req);
    if (!files[0]) throw badRequest('Choose a CSV file');
    return importCsv(actorOf(req), kind, parseCsv(files[0].buffer.toString('utf8')), fields.preview === 'true');
  });
  app.get('/api/import/:kind/rows', { preHandler: can('exp') }, async (req) => {
    const kind = (req.params as any).kind as ImportKind;
    if (!(kind in IMPORTS)) throw badRequest('Unknown import');
    return { columns: IMPORTS[kind].columns, rows: await exportRows(req.auth!.firmId, kind) };
  });
}
