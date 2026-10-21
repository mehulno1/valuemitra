import { db, toJson, type Tx } from '../../db/index.js';
import { badRequest } from '../../lib/errors.js';
import { audit, type Actor } from '../../platform/audit.js';
import { publish } from '../../platform/events.js';
import { evalExpr } from '@vm/shared';
import { dictionary } from '../master/dictionary.js';
import { caseData, EXPR_FNS } from './resolver.js';

const NUMERIC = new Set(['number', 'area', 'money']);

export interface CandidateInput {
  fieldCode: string;
  value: string | number | null;
  sourceType: 'document' | 'site_sheet' | 'valuation' | 'evidence';
  docType?: string | null;
  partId?: number | null;
  documentId?: number | null;
  page?: number | null;
  snippet?: string | null;
  snippetLang?: string | null;
  confidence?: number | null;
}

const toNum = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** Store machine-read candidates. A new read of the same field from the same source replaces the old one. */
export async function writeCandidates(assignmentId: number, firmId: number, items: CandidateInput[], tx: Tx = db) {
  const fields = await dictionary(firmId, tx);
  for (const it of items) {
    const f = fields.get(it.fieldCode);
    if (!f || it.value === null || it.value === undefined || it.value === '') continue;
    let q = tx
      .updateTable('field_values')
      .set({ is_current: 0, status: 'superseded' })
      .where('assignment_id', '=', assignmentId)
      .where('field_code', '=', it.fieldCode)
      .where('source_type', '=', it.sourceType)
      .where('is_current', '=', 1);
    if (it.sourceType === 'document') q = it.partId ? q.where('part_id', '=', it.partId) : q.where('source_doc_type', '=', it.docType ?? '');
    await q.execute();
    await tx
      .insertInto('field_values')
      .values({
        assignment_id: assignmentId,
        field_code: it.fieldCode,
        value_text: f.type === 'list' ? toJson(it.value) : String(it.value),
        value_num: NUMERIC.has(f.type) ? toNum(it.value) : null,
        source_type: it.sourceType,
        source_doc_type: it.docType ?? null,
        part_id: it.partId ?? null,
        document_id: it.documentId ?? null,
        page_no: it.page ?? null,
        snippet: it.snippet ?? null,
        snippet_lang: it.snippetLang ?? null,
        confidence: it.confidence ?? null,
        status: 'proposed',
      })
      .execute();
  }
}

/** Remove machine candidates that came from a document part (e.g. after its label is corrected). */
export async function retractPartCandidates(assignmentId: number, partId: number, tx: Tx = db) {
  await tx
    .updateTable('field_values')
    .set({ is_current: 0, status: 'superseded' })
    .where('assignment_id', '=', assignmentId)
    .where('part_id', '=', partId)
    .where('is_current', '=', 1)
    .execute();
}

/** A person sets or corrects a value (Extracted details, or in place in the report). */
export async function setManualValue(
  actor: Actor,
  assignmentId: number,
  code: string,
  value: string | null,
  opts: { kind?: 'manual' | 'report_edit'; reason?: string | null } = {},
  tx: Tx = db,
) {
  const firmId = actor.firmId!;
  const data = await caseData(assignmentId, firmId, tx);
  const f = data.fields.get(code);
  if (!f) throw badRequest(`Unknown field ${code}`);
  if (data.case.signed_at) throw badRequest('The report is signed and locked. Reopen it to make changes.');
  const before = data.get(code);
  const clean = value === null ? null : String(value).trim();
  if (clean !== null && NUMERIC.has(f.type) && toNum(clean) === null) throw badRequest(`${f.label} must be a number`);
  for (const v of f.validation) {
    if (clean === null) break;
    const ok = evalExpr(v.expr, (n) => (n === 'value' ? (NUMERIC.has(f.type) ? toNum(clean) : clean) : data.resolver(n)), EXPR_FNS);
    if (!ok) throw badRequest(v.message);
  }
  await tx
    .updateTable('field_values')
    .set({ is_current: 0, status: 'superseded' })
    .where('assignment_id', '=', assignmentId)
    .where('field_code', '=', code)
    .where('source_type', 'in', ['manual', 'report_edit'])
    .where('is_current', '=', 1)
    .execute();
  if (clean !== null && clean !== '') {
    await tx
      .insertInto('field_values')
      .values({
        assignment_id: assignmentId,
        field_code: code,
        value_text: clean,
        value_num: NUMERIC.has(f.type) ? toNum(clean) : null,
        source_type: opts.kind ?? 'manual',
        status: 'edited',
        reason: opts.reason ?? null,
        created_by: actor.id ?? null,
        confirmed_by: actor.id ?? null,
        confirmed_at: new Date(),
      })
      .execute();
  }
  // the learning system records what the machine proposed and what the person decided
  await tx
    .insertInto('feedback_events')
    .values({
      firm_id: firmId,
      assignment_id: assignmentId,
      kind: before.source === 'document' || before.source === 'site_sheet' ? 'extraction.edit' : 'value.edit',
      field_code: code,
      doc_type: before.sourceDocType,
      property_type: data.case.property_type,
      before_json: toJson({ value: before.value, source: before.source, confidence: before.confidence, page: before.page }),
      after_json: toJson({ value: clean }),
      context_json: toJson({ snippet: before.snippet, kind: opts.kind ?? 'manual' }),
      user_id: actor.id ?? null,
    })
    .execute();
  await audit(actor, {
    entityType: 'field_value', entityId: code, assignmentId, action: opts.kind === 'report_edit' ? 'report.edit' : 'value.edit',
    summary: clean ? `${f.label} ${opts.kind === 'report_edit' ? 'corrected in the report' : 'edited'}; draft updated.` : `${f.label} reset to the value read from sources.`,
    reason: opts.reason ?? null, before: before.display, after: clean,
  }, tx);
  await publish({ type: 'value.changed', firmId, entityType: 'assignment', entityId: assignmentId, payload: { code } }, tx);
}

/** Accept a machine value as read (feeds the learning system as a positive label). */
export async function acceptValue(actor: Actor, assignmentId: number, code: string, tx: Tx = db) {
  const data = await caseData(assignmentId, actor.firmId!, tx);
  const r = data.get(code);
  const cand = r.candidates.find((c) => c.sourceType === r.source && c.page === r.page && c.partId === r.partId);
  if (!cand) return;
  await tx.updateTable('field_values').set({ status: 'accepted', confirmed_by: actor.id ?? null, confirmed_at: new Date() }).where('id', '=', cand.id).execute();
  await tx.insertInto('feedback_events').values({
    firm_id: actor.firmId!, assignment_id: assignmentId, kind: 'extraction.accept', field_code: code, doc_type: r.sourceDocType,
    property_type: data.case.property_type, before_json: toJson({ value: r.value, confidence: r.confidence }), after_json: toJson({ value: r.value }),
    context_json: toJson({ snippet: r.snippet, page: r.page }), user_id: actor.id ?? null,
  }).execute();
}

/** Resolve a conflict by picking one of the offered options. */
export async function resolveConflict(actor: Actor, assignmentId: number, code: string, optionIndex: number, reason: string | null, tx: Tx = db) {
  const data = await caseData(assignmentId, actor.firmId!, tx);
  const r = data.get(code);
  const opt = r.conflict?.options[optionIndex];
  if (!opt) throw badRequest('That choice is no longer available');
  if (opt.candidateId) {
    await tx.updateTable('field_values').set({ is_chosen: 0 }).where('assignment_id', '=', assignmentId).where('field_code', '=', code).execute();
    await tx.updateTable('field_values').set({ is_chosen: 1, confirmed_by: actor.id ?? null, confirmed_at: new Date(), reason }).where('id', '=', opt.candidateId).execute();
    await audit(actor, { entityType: 'field_value', entityId: code, assignmentId, action: 'conflict.resolve', summary: `${r.label}: kept ${opt.display} (${opt.label}).`, reason }, tx);
  } else {
    await setManualValue(actor, assignmentId, code, String(opt.value), { reason: reason ?? `Chosen basis: ${opt.basis}` }, tx);
    const basisField = data.fields.get(code)?.rules?.agree?.basis_field;
    if (basisField && opt.basis) await setManualValue(actor, assignmentId, basisField, opt.basis, { reason: 'Follows the chosen basis' }, tx);
  }
  await tx.insertInto('feedback_events').values({
    firm_id: actor.firmId!, assignment_id: assignmentId, kind: 'conflict.resolve', field_code: code, property_type: data.case.property_type,
    before_json: toJson(r.conflict), after_json: toJson(opt), user_id: actor.id ?? null,
  }).execute();
}
