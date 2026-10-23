// Report & sign-off and Output: live preview, draft sharing (watermarked), valuer-only signing with
// gap-free report numbers, reopen as /R1, final Word + PDF, email/WhatsApp drafts, dispatch, register.
import { fillPattern, financialYear, pad } from '@vm/shared';
import { db, toJson, type Tx } from '../../db/index.js';
import { blocked, badRequest, forbidden, notFound } from '../../lib/errors.js';
import { docxToPdf, watermark } from '../../lib/pdf.js';
import { audit, systemActor, type Actor } from '../../platform/audit.js';
import { publish } from '../../platform/events.js';
import { enqueue, registerJob } from '../../platform/jobs.js';
import { nextNumber } from '../../platform/sequences.js';
import { sendMail } from '../../platform/mail.js';
import { getSettings } from '../../platform/settings.js';
import { readFile, saveFile } from '../../platform/storage.js';
import { scheduleKycPurge } from '../../platform/retention.js';
import { recomputeStage } from '../assignments/service.js';
import { caseData } from '../casedata/resolver.js';
import { reportFieldCodes, runChecks, summary } from '../checks/engine.js';
import { renderDocx } from '../templates/render.js';
import { buildRenderData, fileBase, type Mode } from './data.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function compiledTemplate(templateVersionId: number, tx: Tx = db) {
  const v = await tx.selectFrom('template_versions as v').innerJoin('report_templates as t', 't.id', 'v.template_id').select(['v.compiled_file_id', 't.firm_id']).where('v.id', '=', templateVersionId).executeTakeFirstOrThrow();
  if (!v.compiled_file_id) throw new Error('Template version is not compiled');
  return (await readFile(v.compiled_file_id, v.firm_id, tx)).buffer;
}

export async function renderReport(assignmentId: number, firmId: number, mode: Mode, tx: Tx = db) {
  const a = await tx.selectFrom('assignments').select(['template_version_id']).where('id', '=', assignmentId).where('firm_id', '=', firmId).executeTakeFirstOrThrow();
  const tpl = await compiledTemplate(a.template_version_id!, tx);
  const built = await buildRenderData(assignmentId, firmId, mode, tx);
  return { docx: renderDocx(tpl, built.data, built.images), snapshot: built.snapshot };
}

const previewCache = new Map<string, { at: number; docx: Buffer }>();

/** Live draft for the browser (docx with value markers for click-to-edit). Cached per draft version. */
export async function previewDocx(firmId: number, assignmentId: number) {
  const a = await db.selectFrom('assignments').select(['draft_version', 'updated_at', 'signed_at']).where('id', '=', assignmentId).where('firm_id', '=', firmId).executeTakeFirst();
  if (!a) throw notFound('Assignment');
  const latest = await db.selectFrom('audit_log').select((eb) => eb.fn.max('id').as('m')).where('assignment_id', '=', assignmentId).executeTakeFirst();
  const key = `${assignmentId}:${a.draft_version}:${latest?.m ?? 0}:${a.signed_at ? 1 : 0}`;
  const hit = previewCache.get(key);
  if (hit) return hit.docx;
  const { docx } = await renderReport(assignmentId, firmId, a.signed_at ? 'final' : 'preview');
  previewCache.set(key, { at: Date.now(), docx });
  if (previewCache.size > 50) previewCache.delete(previewCache.keys().next().value!);
  return docx;
}

export async function shareDraft(actor: Actor, assignmentId: number) {
  const a = await db.selectFrom('assignments').selectAll().where('id', '=', assignmentId).where('firm_id', '=', actor.firmId!).executeTakeFirst();
  if (!a) throw notFound('Assignment');
  if (a.signed_at) throw badRequest('The report is already signed; send the final report from Output');
  const { docx, snapshot } = await renderReport(assignmentId, actor.firmId!, 'draft');
  const pdf = await watermark(await docxToPdf(docx));
  const data = await caseData(assignmentId, actor.firmId!);
  const base = await fileBase(data, (await getSettings(actor.firmId!)).file_pattern);
  const pf = await saveFile({ firmId: actor.firmId!, purpose: 'report_pdf', folder: `a${assignmentId}/reports`, buffer: pdf, name: `${base}_DRAFT_v${a.draft_version}.pdf`, mime: 'application/pdf', userId: actor.id });
  await db.insertInto('report_versions').values({ assignment_id: assignmentId, draft_version: a.draft_version, kind: 'draft', template_version_id: a.template_version_id!, data_json: toJson(snapshot), pdf_file_id: pf.id, status: 'ready', created_by: actor.id ?? null }).execute();
  const tpl = data.wording.messages?.draft_share?.body ?? '';
  const message = data.wordingText(tpl, { 'VAL.FMV_DISPLAY': data.get('VAL.FMV').display, 'VAL.REALIZABLE_DISPLAY': data.get('VAL.REALIZABLE').display }) ?? '';
  await db.insertInto('messages').values({ firm_id: actor.firmId!, assignment_id: assignmentId, channel: 'email', purpose: 'draft_share', body: message, created_by: actor.id ?? null }).execute();
  await audit(actor, { entityType: 'report', assignmentId, action: 'report.draft_share', summary: `Draft v${a.draft_version} shared with bank (watermarked).` });
  return { fileId: pf.id, name: pf.original_name, message };
}

/** Watermarked draft PDF for viewing or printing (not recorded as shared with the bank). */
export async function draftPdf(firmId: number, assignmentId: number, opts: { finalLayout?: boolean } = {}) {
  const a = await db.selectFrom('assignments').select(['signed_at']).where('id', '=', assignmentId).where('firm_id', '=', firmId).executeTakeFirst();
  if (!a) throw notFound('Assignment');
  // "Preview final PDF": the pages exactly as they will be issued, marked PREVIEW, so layout is checked before signing
  const { docx } = await renderReport(assignmentId, firmId, a.signed_at ? 'final' : opts.finalLayout ? 'final_preview' : 'draft');
  const pdf = await docxToPdf(docx);
  return a.signed_at ? pdf : watermark(pdf, opts.finalLayout ? 'PREVIEW' : 'DRAFT');
}

export async function sendToValuer(actor: Actor, assignmentId: number) {
  const s = await runChecks(assignmentId, actor.firmId!);
  if (s.blocked) throw blocked(`${s.crit} item(s) to resolve before valuer review`, s.items.filter((i) => i.severity === 'crit' && i.status === 'open'));
  await db.updateTable('assignments').set({ sent_for_review_at: new Date() }).where('id', '=', assignmentId).where('firm_id', '=', actor.firmId!).execute();
  await audit(actor, { entityType: 'assignment', entityId: assignmentId, assignmentId, action: 'report.send_to_valuer', summary: 'Sent to valuer for review.' });
  await recomputeStage(assignmentId, actor.id ?? null);
}

/** Valuer approves and signs. The report number is issued here, from one gap-free series per FY. */
export async function signReport(actor: Actor & { role?: string }, assignmentId: number) {
  if (actor.role !== 'valuer') throw forbidden('Only a registered valuer can sign');
  const firmId = actor.firmId!;
  const res = await db.transaction().execute(async (tx) => {
    const a = await tx.selectFrom('assignments as a').innerJoin('banks as b', 'b.id', 'a.bank_id').innerJoin('bank_branches as br', 'br.id', 'a.branch_id')
      .selectAll('a').select(['b.code as bank_code', 'br.code as branch_code']).where('a.id', '=', assignmentId).where('a.firm_id', '=', firmId).forUpdate().executeTakeFirst();
    if (!a) throw notFound('Assignment');
    if (a.signed_at) throw badRequest(`Already signed as ${a.report_no}`);
    const s = await runChecks(assignmentId, firmId, tx);
    if (s.blocked) throw blocked('Cannot sign yet', s.items.filter((i) => i.severity === 'crit' && i.status === 'open'));
    const settings = await getSettings(firmId, tx);
    const firm = await tx.selectFrom('firms').select('code').where('id', '=', firmId).executeTakeFirstOrThrow();
    // a reissue keeps the original serial and FY and adds /R1, /R2 ...
    const fy = a.report_fy ?? financialYear().short;
    const seq = a.report_seq ?? (await nextNumber(tx, firmId, 'report', fy));
    const base = fillPattern(settings.report_pattern, { FIRM: firm.code, BANK: a.bank_code, BRANCH: a.branch_code, FY: fy, N: pad(seq) });
    const reportNo = a.report_rev > 0 ? `${base}/R${a.report_rev}` : base;
    const now = new Date();
    await tx.updateTable('assignments').set({ signed_at: now, signed_by: actor.id!, report_no: reportNo, report_fy: fy, report_seq: seq }).where('id', '=', assignmentId).execute();
    if (a.report_rev > 0) await tx.updateTable('report_register').set({ superseded_at: now }).where('assignment_id', '=', assignmentId).where('superseded_at', 'is', null).execute();
    const data = await caseData(assignmentId, firmId, tx);
    await tx.insertInto('report_register').values({ firm_id: firmId, fy, seq, rev: a.report_rev, report_no: reportNo, assignment_id: assignmentId, bank_code: a.bank_code, branch_code: a.branch_code, fmv: Number(data.value('VAL.FMV')) || null, signed_by: actor.id!, signed_at: now }).execute();
    const rv = await tx.insertInto('report_versions').values({ assignment_id: assignmentId, draft_version: a.draft_version, kind: 'final', template_version_id: a.template_version_id!, report_no: reportNo, data_json: toJson({}), status: 'queued', created_by: actor.id ?? null }).executeTakeFirstOrThrow();
    // learning: every signed report adds its property, rate and evidence to the comparables database
    const area = Number(data.value('AREA.BUA'));
    const rate = Number(data.value('VAL.RATE'));
    if (area > 0 && rate > 0) {
      await tx.insertInto('comparables').values({
        firm_id: firmId, scope: 'private', source_type: 'own_report', source_ref: reportNo, property_type: a.property_type,
        building: (data.value('PROP.BUILDING') as string) ?? null, society: (data.value('PROP.SOCIETY') as string) ?? null, village: (data.value('PROP.VILLAGE') as string) ?? null,
        lat: Number(data.value('PROP.LAT')) || null, lng: Number(data.value('PROP.LNG')) || null, txn_date: now, area_value: area, area_basis: 'bua', area_bua_sqft: area,
        price: area * rate, rate_per_sqft: rate, building_age: (data.value('PHYS.AGE') as number) ?? null, has_lift: data.value('PHYS.LIFT') === 'Yes' ? 1 : data.value('PHYS.LIFT') === 'No' ? 0 : null,
        notes: 'Valuer-adopted rate in a signed report', origin_assignment_id: assignmentId, created_by: actor.id ?? null,
      }).execute();
    }
    await tx.insertInto('feedback_events').values({
      firm_id: firmId, assignment_id: assignmentId, kind: 'report.signed', property_type: a.property_type, locality: (data.value('PROP.VILLAGE') as string) ?? null,
      after_json: toJson({ reportNo, rate, proposed: data.value('VAL.PROPOSED_RATE'), fmv: data.value('VAL.FMV') }), user_id: actor.id ?? null,
    }).execute();
    await audit(actor, { entityType: 'report', entityId: Number(rv.insertId), assignmentId, action: 'report.sign', summary: `Approved and signed by ${actor.name}. Report no. ${reportNo} issued.` }, tx);
    await publish({ type: 'report.signed', firmId, entityType: 'assignment', entityId: assignmentId, payload: { reportNo } }, tx);
    return { reportNo, reportVersionId: Number(rv.insertId) };
  });
  await recomputeStage(assignmentId, actor.id ?? null);
  await enqueue('report.render_final', { reportVersionId: res.reportVersionId }, { firmId });
  return res;
}

async function renderFinal(reportVersionId: number) {
  const rv = await db.selectFrom('report_versions').selectAll().where('id', '=', reportVersionId).executeTakeFirstOrThrow();
  const a = await db.selectFrom('assignments').select(['id', 'firm_id', 'signed_at', 'report_no']).where('id', '=', rv.assignment_id).executeTakeFirstOrThrow();
  if (!a.signed_at || a.report_no !== rv.report_no) { await db.updateTable('report_versions').set({ status: 'failed', error: 'Superseded before rendering' }).where('id', '=', rv.id).execute(); return; }
  await db.updateTable('report_versions').set({ status: 'rendering', error: null }).where('id', '=', rv.id).execute();
  const { docx, snapshot } = await renderReport(a.id, a.firm_id, 'final');
  const pdf = await docxToPdf(docx);
  const data = await caseData(a.id, a.firm_id);
  const base = await fileBase(data, (await getSettings(a.firm_id)).file_pattern);
  const df = await saveFile({ firmId: a.firm_id, purpose: 'report_docx', folder: `a${a.id}/reports`, buffer: docx, name: `${base}.docx`, mime: DOCX });
  const pf = await saveFile({ firmId: a.firm_id, purpose: 'report_pdf', folder: `a${a.id}/reports`, buffer: pdf, name: `${base}.pdf`, mime: 'application/pdf' });
  await db.updateTable('report_versions').set({ status: 'ready', docx_file_id: df.id, pdf_file_id: pf.id, data_json: toJson(snapshot) }).where('id', '=', rv.id).execute();
  await db.updateTable('report_register').set({ report_version_id: rv.id }).where('assignment_id', '=', a.id).where('report_no', '=', rv.report_no!).execute();
  await audit(systemActor(a.firm_id), { entityType: 'report', entityId: rv.id, assignmentId: a.id, action: 'report.render', summary: `Final report ${rv.report_no} generated in Word and PDF.` });
}

/** Reopen a signed report. Signing again keeps the serial and adds /R1, /R2. */
export async function reopenReport(actor: Actor & { role?: string }, assignmentId: number, reason: string) {
  if (actor.role !== 'valuer') throw forbidden('Only the valuer can reopen a signed report');
  if (!reason?.trim()) throw badRequest('Give the reason for reopening');
  const a = await db.selectFrom('assignments').selectAll().where('id', '=', assignmentId).where('firm_id', '=', actor.firmId!).executeTakeFirst();
  if (!a) throw notFound('Assignment');
  if (!a.signed_at) throw badRequest('The report is not signed');
  if (a.stage === 'billed' || a.stage === 'paid') throw badRequest('This report is billed; raise a credit note before reissuing');
  const rev = a.report_rev + 1;
  await db.transaction().execute(async (tx) => {
    await tx.updateTable('assignments').set({ signed_at: null, signed_by: null, report_no: null, report_rev: rev, sent_at: null, sent_for_review_at: null }).where('id', '=', assignmentId).execute();
    await tx.deleteFrom('comparables').where('origin_assignment_id', '=', assignmentId).where('source_type', '=', 'own_report').execute();
    await audit(actor, { entityType: 'report', assignmentId, action: 'report.reopen', summary: `Report ${a.report_no} reopened for changes. Signing again will issue ${a.report_no!.replace(/\/R\d+$/, '')}/R${rev}.`, reason }, tx);
    await publish({ type: 'report.reopened', firmId: actor.firmId, entityType: 'assignment', entityId: assignmentId, payload: { rev } }, tx);
  });
  await runChecks(assignmentId, actor.firmId!);
  await recomputeStage(assignmentId, actor.id ?? null);
}

export async function reportStatus(firmId: number, assignmentId: number) {
  const a = await db.selectFrom('assignments').select(['id', 'draft_version', 'signed_at', 'report_no', 'report_rev', 'report_seq', 'report_fy', 'sent_for_review_at', 'stage']).where('id', '=', assignmentId).where('firm_id', '=', firmId).executeTakeFirst();
  if (!a) throw notFound('Assignment');
  const versions = await db.selectFrom('report_versions').select(['id', 'kind', 'draft_version', 'report_no', 'status', 'error', 'docx_file_id', 'pdf_file_id', 'created_at']).where('assignment_id', '=', assignmentId).where('kind', '!=', 'preview').orderBy('id', 'desc').execute();
  const s = await summary(assignmentId);
  const data = await caseData(assignmentId, firmId);
  const codes = await reportFieldCodes(data.case.template_version_id);
  const pending = data.all(codes).filter((r) => r.state === 'pending').map((r) => ({ code: r.code, label: r.label, pendingLabel: r.pendingLabel }));
  return {
    ...a, checks: { blocked: s.blocked, crit: s.crit, warn: s.warn }, pending,
    values: ['VAL.FMV', 'VAL.REALIZABLE', 'VAL.DISTRESS', 'VAL.GUIDELINE', 'VAL.RATE', 'VAL.BASIS_AREA', 'VAL.RATE_REASON'].map((c) => { const r = data.get(c); return { code: c, label: r.label, display: r.display, state: r.state }; }),
    rules: { realizable_pct: data.rules.realizable_pct, distress_pct: data.rules.distress_pct },
    versions,
  };
}

// ---- Output and dispatch -------------------------------------------------------------------

export async function outputView(firmId: number, assignmentId: number) {
  const a = await db.selectFrom('assignments as a').innerJoin('bank_branches as br', 'br.id', 'a.branch_id').select(['a.id', 'a.signed_at', 'a.report_no', 'a.sent_at', 'a.bank_contact', 'br.contact_email', 'br.name as branch_name']).where('a.id', '=', assignmentId).where('a.firm_id', '=', firmId).executeTakeFirst();
  if (!a) throw notFound('Assignment');
  if (!a.signed_at) return { signed: false };
  const final = await db.selectFrom('report_versions').selectAll().where('assignment_id', '=', assignmentId).where('kind', '=', 'final').where('report_no', '=', a.report_no!).orderBy('id', 'desc').executeTakeFirst();
  const data = await caseData(assignmentId, firmId);
  const msgs = data.wording.messages ?? {};
  const dispatch = await db.selectFrom('dispatches').selectAll().where('assignment_id', '=', assignmentId).where('report_no', '=', a.report_no!).executeTakeFirst();
  const files = final?.status === 'ready' ? await db.selectFrom('files').select(['id', 'original_name', 'mime', 'size_bytes']).where('id', 'in', [final.pdf_file_id!, final.docx_file_id!]).execute() : [];
  return {
    signed: true, reportNo: a.report_no, sentAt: a.sent_at, render: final ? { status: final.status, error: final.error } : null, files,
    email: { to: a.contact_email, subject: data.wordingText(msgs.report_email?.subject ?? '') ?? '', body: data.wordingText(msgs.report_email?.body ?? '') ?? '' },
    whatsapp: data.wordingText(msgs.report_whatsapp?.body ?? '') ?? '',
    dispatch: dispatch ?? null,
  };
}

export async function updateDispatch(actor: Actor, assignmentId: number, patch: { email_sent?: boolean; whatsapp_sent?: boolean; printed?: boolean; couriered?: boolean; awb?: string | null; courier_name?: string | null }) {
  const a = await db.selectFrom('assignments').select(['report_no', 'signed_at']).where('id', '=', assignmentId).where('firm_id', '=', actor.firmId!).executeTakeFirst();
  if (!a?.signed_at) throw badRequest('Sign the report first');
  const set: Record<string, unknown> = {};
  for (const k of ['email_sent', 'whatsapp_sent', 'printed', 'couriered'] as const) if (patch[k] !== undefined) set[k] = patch[k] ? 1 : 0;
  if (patch.email_sent) set.email_sent_at = new Date();
  if (patch.awb !== undefined) set.awb = patch.awb;
  if (patch.courier_name !== undefined) set.courier_name = patch.courier_name;
  await db.insertInto('dispatches').values({ assignment_id: assignmentId, report_no: a.report_no!, ...set } as any).onDuplicateKeyUpdate(set as any).execute();
}

export async function sendReportEmail(actor: Actor, assignmentId: number, input: { to: string; subject: string; body: string }) {
  const out = await outputView(actor.firmId!, assignmentId);
  if (!out.signed || out.render?.status !== 'ready') throw badRequest('The final report is not ready yet');
  const attachments = [];
  for (const f of out.files!) attachments.push({ filename: f.original_name ?? 'report', content: (await readFile(f.id, actor.firmId!)).buffer });
  await sendMail({ to: input.to, subject: input.subject, text: input.body, attachments });
  await db.insertInto('messages').values({ firm_id: actor.firmId!, assignment_id: assignmentId, channel: 'email', purpose: 'report_email', to_text: input.to, subject: input.subject, body: input.body, status: 'sent', created_by: actor.id ?? null }).execute();
  await updateDispatch(actor, assignmentId, { email_sent: true });
  await db.updateTable('dispatches').set({ email_to: input.to }).where('assignment_id', '=', assignmentId).execute();
  await audit(actor, { entityType: 'report', assignmentId, action: 'report.email', summary: `Report emailed to ${input.to} with PDF and Word.` });
}

export async function markSent(actor: Actor, assignmentId: number) {
  const a = await db.selectFrom('assignments').select(['report_no', 'signed_at', 'sent_at']).where('id', '=', assignmentId).where('firm_id', '=', actor.firmId!).executeTakeFirst();
  if (!a?.signed_at) throw badRequest('Sign the report first');
  const d = await db.selectFrom('dispatches').selectAll().where('assignment_id', '=', assignmentId).where('report_no', '=', a.report_no!).executeTakeFirst();
  if (!d?.email_sent || !d.printed || !d.couriered) throw badRequest('Tick email, print and courier first');
  await db.updateTable('dispatches').set({ marked_sent_at: new Date(), marked_sent_by: actor.id ?? null }).where('id', '=', d.id).execute();
  await db.updateTable('assignments').set({ sent_at: new Date() }).where('id', '=', assignmentId).execute();
  await scheduleKycPurge(actor.firmId!, assignmentId);
  await audit(actor, { entityType: 'report', assignmentId, action: 'report.sent', summary: `Case marked as sent. Hard copy: ${d.awb || 'by hand'}.` });
  await publish({ type: 'report.sent', firmId: actor.firmId, entityType: 'assignment', entityId: assignmentId, payload: { reportNo: a.report_no } });
  await recomputeStage(assignmentId, actor.id ?? null);
}

export async function register(firmId: number, fy?: string) {
  return db.selectFrom('report_register as r').innerJoin('assignments as a', 'a.id', 'r.assignment_id').leftJoin('users as u', 'u.id', 'r.signed_by')
    .select(['r.id', 'r.fy', 'r.seq', 'r.rev', 'r.report_no', 'r.bank_code', 'r.branch_code', 'r.fmv', 'r.signed_at', 'r.superseded_at', 'a.case_no', 'a.id as assignment_id', 'u.name as signed_by'])
    .where('r.firm_id', '=', firmId).where('r.fy', '=', fy ?? financialYear().short).orderBy('r.seq', 'desc').orderBy('r.rev', 'desc').execute();
}

registerJob('report.render_final', async ({ reportVersionId }) => {
  try { await renderFinal(reportVersionId); } catch (e) {
    await db.updateTable('report_versions').set({ status: 'failed', error: (e as Error).message.slice(0, 1000) }).where('id', '=', reportVersionId).execute();
    throw e;
  }
});
