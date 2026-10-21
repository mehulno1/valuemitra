import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PROPERTY_TYPES } from '@vm/shared';
import { db } from '../db/index.js';
import { badRequest } from '../lib/errors.js';
import { actorOf, authenticate, requirePerm } from '../platform/auth.js';
import { readFile } from '../platform/storage.js';
import * as asg from '../modules/assignments/service.js';
import { caseData } from '../modules/casedata/resolver.js';
import { acceptValue, resolveConflict, setManualValue } from '../modules/casedata/values.js';
import { acceptCheck, reportFieldCodes, runChecks, summary } from '../modules/checks/engine.js';
import * as docs from '../modules/documents/service.js';
import * as reports from '../modules/reports/service.js';
import * as site from '../modules/site/service.js';
import * as val from '../modules/valuation/service.js';
import { body, idParam, multipartFiles } from './util.js';

export async function caseRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  const can = requirePerm;

  // ---- board and intake ----
  app.get('/api/assignments', async (req) => {
    const q = req.query as any;
    return asg.board(req.auth!.firmId, { stage: q.stage || undefined, q: q.q || undefined });
  });
  app.get('/api/assignments/alerts', async (req) => asg.alerts(req.auth!.firmId));
  app.get('/api/assignments/id-preview', async (req) => {
    const q = req.query as any;
    return asg.idPreview(req.auth!.firmId, q.bankId ? Number(q.bankId) : undefined, q.branchId ? Number(q.branchId) : undefined);
  });
  app.post('/api/assignments', { preHandler: can('create') }, async (req) => {
    const b = body(req, z.object({
      bankId: z.number().int(), branchId: z.number().int(), bankContact: z.string().nullish(), receivedVia: z.string().nullish(), bankRefNo: z.string().nullish(),
      borrowerName: z.string().nullish(), propertyType: z.enum(PROPERTY_TYPES.map((p) => p.key) as [string, ...string[]]), localityHint: z.string().nullish(),
      purpose: z.string().nullish(), engineerId: z.number().int().nullish(),
    }));
    return db.transaction().execute((tx) => asg.createAssignment(actorOf(req), b, tx));
  });
  app.get('/api/assignments/:id', async (req) => asg.assignmentHeader(req.auth!.firmId, idParam(req)));
  app.patch('/api/assignments/:id', { preHandler: can('edit') }, async (req) => {
    const b = body(req, z.object({ bankContact: z.string().nullish(), borrowerName: z.string().nullish(), engineerId: z.number().int().nullish(), purpose: z.string().nullish(), bankRefNo: z.string().nullish(), localityHint: z.string().nullish() }));
    await asg.updateAssignment(actorOf(req), idParam(req), b as any);
    return { ok: true };
  });
  app.get('/api/assignments/:id/activity', async (req) => asg.activity(req.auth!.firmId, idParam(req)));

  // ---- documents ----
  app.get('/api/assignments/:id/documents', async (req) => docs.listDocuments(req.auth!.firmId, idParam(req)));
  app.post('/api/assignments/:id/documents', { preHandler: can('edit') }, async (req) => {
    const { files, fields } = await multipartFiles(req);
    return docs.uploadDocuments(actorOf(req), idParam(req), files, { channel: fields.channel || null, from: fields.from || null });
  });
  app.post('/api/assignments/:id/documents/:did/retry', { preHandler: can('edit') }, async (req) => {
    await docs.retryDocument(actorOf(req), idParam(req), idParam(req, 'did'));
    return { ok: true };
  });
  app.patch('/api/assignments/:id/parts/:pid', { preHandler: can('edit') }, async (req) => {
    const b = body(req, z.object({ type: z.string().nullable().optional(), reportPages: z.array(z.number().int()).optional() }));
    if (b.type !== undefined) await docs.correctPartLabel(actorOf(req), idParam(req), idParam(req, 'pid'), b.type);
    if (b.reportPages) await docs.setReportPages(actorOf(req), idParam(req), idParam(req, 'pid'), b.reportPages);
    return { ok: true };
  });
  app.get('/api/assignments/:id/checklist', async (req) => docs.checklist(req.auth!.firmId, idParam(req)));
  app.patch('/api/assignments/:id/checklist/:iid', { preHandler: can('edit') }, async (req) => {
    const b = body(req, z.object({ state: z.enum(['y', 'n', 'na']) }));
    await docs.setChecklistState(actorOf(req), idParam(req), idParam(req, 'iid'), b.state);
    return { ok: true };
  });
  app.post('/api/assignments/:id/checklist', { preHandler: can('edit') }, async (req) => {
    const b = body(req, z.object({ label: z.string() }));
    await docs.addChecklistItem(actorOf(req), idParam(req), b.label);
    return { ok: true };
  });
  app.get('/api/assignments/:id/seen-before', async (req) => docs.seenBefore(req.auth!.firmId, idParam(req)));

  // ---- messages (copy-ready drafts) ----
  app.post('/api/assignments/:id/messages/:purpose', { preHandler: can('edit') }, async (req) => {
    const id = idParam(req);
    await docs.assertCase(req.auth!.firmId, id);
    const purpose = (req.params as any).purpose as string;
    const data = await caseData(id, req.auth!.firmId);
    if (purpose === 'engineer_link') return site.createVisitLink(actorOf(req), id);
    const tpl = data.wording.messages?.[purpose];
    if (!tpl) throw badRequest('Unknown message');
    let extra: Record<string, unknown> = {};
    if (purpose === 'doc_reminder') {
      const chase = new Map<string, boolean>(((data.profile.checklist ?? []) as any[]).map((c) => [c.code, c.chase !== false]));
      const items = await db.selectFrom('checklist_items').select(['item_code', 'label', 'state']).where('assignment_id', '=', id).where('state', '=', 'n').execute();
      extra = { CHASE_LIST: items.filter((i) => chase.get(i.item_code) !== false).map((i) => i.label) };
    }
    const text = data.wordingText(tpl.body, extra) ?? data.wordingText(tpl.body.replace(/\{\{CUST\.NAME\}\}/g, '{{CASE.NO}}'), extra) ?? '';
    await db.insertInto('messages').values({ firm_id: req.auth!.firmId, assignment_id: id, channel: 'whatsapp', purpose, body: text, created_by: req.auth!.userId }).execute();
    return { title: tpl.title, subject: tpl.subject ? data.wordingText(tpl.subject) : null, message: text };
  });

  // ---- extracted details (resolved fields) ----
  app.get('/api/assignments/:id/fields', async (req) => {
    const id = idParam(req);
    const data = await caseData(id, req.auth!.firmId);
    const sections = ((data.profile.sections ?? []) as { title: string; fields: string[] }[]).map((s) => ({ title: s.title, fields: data.all(s.fields).filter((f) => f.state !== 'not_applicable') }));
    const inSections = new Set(sections.flatMap((s) => s.fields.map((f) => f.code)));
    const reportCodes = await reportFieldCodes(data.case.template_version_id);
    const other = data.all(reportCodes.filter((c) => !inSections.has(c))).filter((f) => f.state !== 'not_applicable');
    const all = [...sections.flatMap((s) => s.fields), ...other];
    return {
      sections: other.length ? [...sections, { title: 'Other report fields', fields: other }] : sections,
      filled: all.filter((f) => f.state === 'filled').length,
      total: all.length,
      fromDocuments: all.filter((f) => f.source === 'document' || f.source === 'site_sheet').length,
      signed: !!data.case.signed_at,
    };
  });
  app.put('/api/assignments/:id/fields/:code', { preHandler: can('edit') }, async (req) => {
    const b = body(req, z.object({ value: z.string().nullable(), reason: z.string().nullish(), kind: z.enum(['manual', 'report_edit']).optional() }));
    const code = (req.params as any).code as string;
    if (code.startsWith('VAL.') && !req.auth!.perms.has('val') && req.auth!.role !== 'admin') throw badRequest('Values change on the Valuation tab');
    await setManualValue(actorOf(req), idParam(req), code, b.value, { reason: b.reason ?? null, kind: b.kind });
    return { ok: true };
  });
  app.post('/api/assignments/:id/fields/:code/accept', { preHandler: can('edit') }, async (req) => {
    await acceptValue(actorOf(req), idParam(req), (req.params as any).code);
    return { ok: true };
  });
  app.post('/api/assignments/:id/fields/:code/resolve', { preHandler: can('edit') }, async (req) => {
    const b = body(req, z.object({ option: z.number().int(), reason: z.string().nullish() }));
    await resolveConflict(actorOf(req), idParam(req), (req.params as any).code, b.option, b.reason ?? null);
    await runChecks(idParam(req), req.auth!.firmId);
    await asg.recomputeStage(idParam(req), req.auth!.userId);
    return { ok: true };
  });

  // ---- site visit ----
  app.get('/api/assignments/:id/site', async (req) => site.listPhotos(req.auth!.firmId, idParam(req)));
  app.post('/api/assignments/:id/site/link', { preHandler: can('edit') }, async (req) => site.createVisitLink(actorOf(req), idParam(req)));
  app.post('/api/assignments/:id/site/photos', { preHandler: can('edit') }, async (req) => {
    const { files } = await multipartFiles(req);
    await site.officeUploadPhotos(actorOf(req), idParam(req), files);
    return { ok: true };
  });
  app.post('/api/assignments/:id/site/sheet', { preHandler: can('edit') }, async (req) => {
    const { files } = await multipartFiles(req);
    return docs.uploadDocuments(actorOf(req), idParam(req), files.slice(0, 1), { channel: 'Upload', role: 'site_sheet' });
  });
  app.patch('/api/assignments/:id/site/photos/:pid', { preHandler: can('edit') }, async (req) => {
    const b = body(req, z.object({ selected: z.boolean().optional(), caption: z.string().max(200).optional() }));
    await site.updatePhoto(actorOf(req), idParam(req), idParam(req, 'pid'), b);
    return { ok: true };
  });
  app.put('/api/assignments/:id/site/order', { preHandler: can('edit') }, async (req) => {
    const b = body(req, z.object({ ids: z.array(z.number().int()) }));
    await site.reorderPhotos(actorOf(req), idParam(req), b.ids);
    return { ok: true };
  });

  // ---- market evidence and valuation ----
  app.get('/api/assignments/:id/evidence', async (req) => val.evidence(req.auth!.firmId, idParam(req)));
  app.post('/api/assignments/:id/evidence', { preHandler: can('edit') }, async (req) => {
    const { files, fields } = await multipartFiles(req);
    const kind = (['igr', 'listing', 'other'].includes(fields.kind) ? fields.kind : 'listing') as 'igr' | 'listing' | 'other';
    return { ids: await val.captureEvidence(actorOf(req), idParam(req), files, kind, fields.source || null, fields.url || null) };
  });
  app.post('/api/assignments/:id/evidence/refresh', { preHandler: can('edit') }, async (req) => {
    await val.lookupReadyReckoner(idParam(req), req.auth!.firmId);
    return { proposal: await val.refreshEvidence(idParam(req), req.auth!.firmId) };
  });
  app.patch('/api/assignments/:id/evidence/:cid', { preHandler: can('val') }, async (req) => {
    const b = body(req, z.object({ included: z.boolean().optional(), weight: z.number().min(0).max(3).optional(), adjustments: z.array(z.object({ code: z.string(), label: z.string(), pct: z.number() })).optional(), reason: z.string().optional() }));
    await val.overrideComparable(actorOf(req), idParam(req), idParam(req, 'cid'), b);
    return { ok: true };
  });
  app.patch('/api/assignments/:id/captures/:cid', { preHandler: can('edit') }, async (req) => {
    const b = body(req, z.object({ inReport: z.boolean() }));
    const a = await docs.assertCase(req.auth!.firmId, idParam(req));
    if (a.signed_at) throw badRequest('The report is signed and locked. Reopen it to make changes.');
    await db.updateTable('evidence_captures').set({ in_report: b.inReport ? 1 : 0 }).where('id', '=', idParam(req, 'cid')).where('assignment_id', '=', idParam(req)).execute();
    return { ok: true };
  });
  app.get('/api/assignments/:id/valuation', async (req) => val.valuationView(req.auth!.firmId, idParam(req)));
  app.post('/api/assignments/:id/valuation', { preHandler: can('val') }, async (req) => {
    const b = body(req, z.object({
      rate: z.number(), reason: z.string().nullish(), landRate: z.number().nullish(),
      extras: z.array(z.object({ code: z.string(), label: z.string(), qty: z.number().optional(), rate: z.number().optional(), amount: z.number().optional() })).optional(),
    }));
    return val.applyValuation(actorOf(req), idParam(req), b);
  });

  // ---- checks ----
  app.get('/api/assignments/:id/checks', async (req) => {
    await docs.assertCase(req.auth!.firmId, idParam(req));
    const s = await summary(idParam(req));
    return s.items.length ? s : runChecks(idParam(req), req.auth!.firmId);
  });
  app.post('/api/assignments/:id/checks/run', async (req) => runChecks(idParam(req), req.auth!.firmId));
  app.post('/api/assignments/:id/checks/:cid/accept', { preHandler: can('edit') }, async (req) => {
    const b = body(req, z.object({ reason: z.string() }));
    await acceptCheck(actorOf(req), idParam(req), idParam(req, 'cid'), b.reason);
    return runChecks(idParam(req), req.auth!.firmId);
  });

  // ---- report and sign-off ----
  app.get('/api/assignments/:id/report', async (req) => reports.reportStatus(req.auth!.firmId, idParam(req)));
  app.get('/api/assignments/:id/report/preview.docx', async (req, reply) => {
    const docx = await reports.previewDocx(req.auth!.firmId, idParam(req));
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document').header('Cache-Control', 'no-store');
    return reply.send(docx);
  });
  app.post('/api/assignments/:id/report/share-draft', { preHandler: can('edit') }, async (req) => reports.shareDraft(actorOf(req), idParam(req)));
  app.post('/api/assignments/:id/report/send-to-valuer', { preHandler: can('edit') }, async (req) => { await reports.sendToValuer(actorOf(req), idParam(req)); return { ok: true }; });
  app.post('/api/assignments/:id/report/sign', { preHandler: can('sign') }, async (req) => reports.signReport({ ...actorOf(req), role: req.auth!.role }, idParam(req)));
  app.post('/api/assignments/:id/report/reopen', { preHandler: can('sign') }, async (req) => {
    const b = body(req, z.object({ reason: z.string() }));
    await reports.reopenReport({ ...actorOf(req), role: req.auth!.role }, idParam(req), b.reason);
    return { ok: true };
  });

  // ---- output ----
  app.get('/api/assignments/:id/output', async (req) => reports.outputView(req.auth!.firmId, idParam(req)));
  app.patch('/api/assignments/:id/output/dispatch', { preHandler: can('edit') }, async (req) => {
    const b = body(req, z.object({ email_sent: z.boolean().optional(), whatsapp_sent: z.boolean().optional(), printed: z.boolean().optional(), couriered: z.boolean().optional(), awb: z.string().nullish(), courier_name: z.string().nullish() }));
    await reports.updateDispatch(actorOf(req), idParam(req), b);
    return { ok: true };
  });
  app.post('/api/assignments/:id/output/email', { preHandler: can('edit') }, async (req) => {
    const b = body(req, z.object({ to: z.string().email(), subject: z.string(), body: z.string() }));
    await reports.sendReportEmail(actorOf(req), idParam(req), b);
    return { ok: true };
  });
  app.post('/api/assignments/:id/output/sent', { preHandler: can('edit') }, async (req) => { await reports.markSent(actorOf(req), idParam(req)); return { ok: true }; });
  app.get('/api/register', async (req) => reports.register(req.auth!.firmId, (req.query as any).fy));

  // ---- files (firm-scoped; KYC never served) ----
  app.get('/api/files/:id', async (req, reply) => {
    const { file, buffer } = await readFile(idParam(req), req.auth!.firmId);
    const kyc = await db.selectFrom('files').select('is_kyc').where('id', '=', file.id).executeTakeFirst();
    if (kyc?.is_kyc) throw badRequest('KYC pages are not shown');
    const inline = /^image\/(jpeg|png|webp)$/.test(file.mime) || file.mime === 'application/pdf';
    reply.header('Content-Type', file.mime).header('Cache-Control', 'private, max-age=3600').header('X-Content-Type-Options', 'nosniff');
    if (!inline || (req.query as any).download) reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(file.original_name ?? `file-${file.id}`)}"`);
    return reply.send(buffer);
  });
}
