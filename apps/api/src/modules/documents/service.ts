// Documents: upload in any order and format, sorted documents with corrections, checklist,
// pages placed in the report, and "seen before" matches across the firm's records.
import { db, json, toJson, type Tx } from '../../db/index.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { audit, type Actor } from '../../platform/audit.js';
import { publish } from '../../platform/events.js';
import { enqueue, registerJob } from '../../platform/jobs.js';
import { saveFile } from '../../platform/storage.js';
import { DOCS, requireKind } from '../../lib/sniff.js';
import { retractPartCandidates, writeCandidates } from '../casedata/values.js';
import { docTypes, extractFields, langLabel, readDocument, syncChecklist } from './reader.js';

export async function assertCase(firmId: number, assignmentId: number, tx: Tx = db) {
  const a = await tx.selectFrom('assignments').select(['id', 'firm_id', 'signed_at', 'property_type', 'case_no']).where('id', '=', assignmentId).where('firm_id', '=', firmId).executeTakeFirst();
  if (!a) throw notFound('Assignment');
  return a;
}

export async function uploadDocuments(
  actor: Actor,
  assignmentId: number,
  files: { name: string; mime: string; buffer: Buffer }[],
  opts: { channel?: string | null; from?: string | null; role?: 'bank_docs' | 'site_sheet' | 'other' } = {},
) {
  const a = await assertCase(actor.firmId!, assignmentId);
  if (!files.length) throw badRequest('Choose at least one file');
  const max = await db.selectFrom('documents').select((eb) => eb.fn.max('batch_no').as('b')).where('assignment_id', '=', assignmentId).executeTakeFirst();
  const batch = Number(max?.b ?? 0) + 1;
  const ids: number[] = [];
  for (const f of files) {
    const mime = requireKind(f.buffer, DOCS, f.name);
    const stored = await saveFile({ firmId: a.firm_id, purpose: 'upload', folder: `a${a.id}/uploads`, buffer: f.buffer, name: f.name, mime, userId: actor.id });
    const r = await db.insertInto('documents').values({
      firm_id: a.firm_id, assignment_id: a.id, file_id: stored.id, batch_no: batch, channel: opts.channel ?? null, received_from: opts.from ?? null,
      role: opts.role ?? 'bank_docs', uploaded_by: actor.id ?? null,
    }).executeTakeFirstOrThrow();
    const id = Number(r.insertId);
    ids.push(id);
    await enqueue(opts.role === 'site_sheet' ? 'site.read_sheet' : 'document.read', { documentId: id }, { firmId: a.firm_id, dedupeKey: `doc:${id}` });
  }
  await audit(actor, { entityType: 'document', assignmentId, action: 'document.upload', summary: `${files.length} file(s) received${opts.channel ? ` on ${opts.channel}` : ''}${opts.from ? ` from ${opts.from}` : ''}: ${files.map((f) => f.name).join(', ')}. Reading and sorting pages.` });
  await publish({ type: 'document.received', firmId: a.firm_id, entityType: 'assignment', entityId: a.id, payload: { documentIds: ids } });
  return { batch, documentIds: ids };
}

/** Read a document again (after a failure, or once AI keys are fixed). */
export async function retryDocument(actor: Actor, assignmentId: number, documentId: number) {
  const a = await assertCase(actor.firmId!, assignmentId);
  if (a.signed_at) throw badRequest('The report is signed and locked. Reopen it to make changes.');
  const d = await db.selectFrom('documents').select(['id', 'role', 'status']).where('id', '=', documentId).where('assignment_id', '=', assignmentId).executeTakeFirst();
  if (!d) throw notFound('Document');
  if (d.status === 'reading') throw badRequest('This document is being read now');
  await db.updateTable('documents').set({ status: 'uploaded', error: null }).where('id', '=', documentId).execute();
  await enqueue(d.role === 'site_sheet' ? 'site.read_sheet' : 'document.read', { documentId }, { firmId: actor.firmId, dedupeKey: `doc:${documentId}:${Date.now()}` });
  await audit(actor, { entityType: 'document', entityId: documentId, assignmentId, action: 'document.retry', summary: 'Document sent for reading again.' });
}

export async function listDocuments(firmId: number, assignmentId: number) {
  await assertCase(firmId, assignmentId);
  const docs = await db
    .selectFrom('documents as d')
    .innerJoin('files as f', 'f.id', 'd.file_id')
    .select(['d.id', 'd.batch_no', 'd.channel', 'd.received_from', 'd.received_at', 'd.page_count', 'd.is_scanned', 'd.role', 'd.status', 'd.error', 'f.original_name', 'f.mime', 'f.id as file_id'])
    .where('d.assignment_id', '=', assignmentId)
    .orderBy('d.id')
    .execute();
  const parts = await db.selectFrom('document_parts').selectAll().where('assignment_id', '=', assignmentId).orderBy('document_id').orderBy('page_from').execute();
  const pages = docs.length
    ? await db.selectFrom('document_pages').select(['id', 'document_id', 'page_no', 'image_file_id', 'thumb_file_id', 'ocr_languages', 'ocr_confidence']).where('document_id', 'in', docs.map((d) => d.id)).orderBy('page_no').execute()
    : [];
  const types = await docTypes(firmId);
  const label = (k: string) => types.find((t) => t.key === k)?.label ?? k;
  return {
    types: types.map((t) => ({ key: t.key, label: t.label })),
    documents: docs.map((d) => ({
      ...d,
      parts: parts.filter((p) => p.document_id === d.id).map((p) => {
        const pg = json<number[]>(p.pages_json, []);
        return {
          id: p.id, detected_type: p.detected_type, corrected_type: p.corrected_type, type: p.corrected_type ?? p.detected_type,
          type_label: label(p.corrected_type ?? p.detected_type), title: p.corrected_type ? label(p.corrected_type) : p.title, pages: pg,
          languages: p.languages, confidence: p.confidence, is_kyc: !!p.is_kyc, excluded: !!p.excluded, moved_to: p.moved_to,
          in_report_pages: json<number[]>(p.in_report_pages, []),
          thumbs: p.is_kyc ? [] : pages.filter((x) => x.document_id === d.id && pg.includes(x.page_no)).map((x) => ({ page: x.page_no, thumb: x.thumb_file_id, image: x.image_file_id, languages: langLabel(x.ocr_languages) })),
        };
      }),
    })),
  };
}

/** A person corrects a document's label: its values are re-read as the new type. */
export async function correctPartLabel(actor: Actor, assignmentId: number, partId: number, newType: string | null) {
  const a = await assertCase(actor.firmId!, assignmentId);
  if (a.signed_at) throw badRequest('The report is signed and locked. Reopen it to make changes.');
  const p = await db.selectFrom('document_parts').selectAll().where('id', '=', partId).where('assignment_id', '=', assignmentId).executeTakeFirst();
  if (!p) throw notFound('Document');
  const types = await docTypes(actor.firmId!);
  if (newType && !types.some((t) => t.key === newType)) throw badRequest('Unknown document type');
  const effective = newType ?? p.detected_type;
  const t = types.find((x) => x.key === effective);
  await db.updateTable('document_parts').set({
    corrected_type: newType, corrected_by: newType ? actor.id ?? null : null, corrected_at: newType ? new Date() : null,
    is_kyc: t?.is_kyc ? 1 : 0, excluded: t?.is_kyc ? 1 : 0, moved_to: effective === 'site_photo' ? 'site_photos' : null,
  }).where('id', '=', partId).execute();
  await retractPartCandidates(assignmentId, partId);
  await db.insertInto('feedback_events').values({
    firm_id: actor.firmId!, assignment_id: assignmentId, kind: 'doc_label.correct', doc_type: effective, property_type: a.property_type,
    before_json: toJson({ type: p.corrected_type ?? p.detected_type, confidence: p.confidence, title: p.title }), after_json: toJson({ type: effective }), user_id: actor.id ?? null,
  }).execute();
  await audit(actor, { entityType: 'document_part', entityId: partId, assignmentId, action: 'document.label', summary: newType ? `Label corrected to ${t?.label ?? newType}.` : 'Label reset to the read label.' });
  if (!t?.is_kyc && effective !== 'site_photo' && effective !== 'other') await enqueue('document.reextract', { partId }, { firmId: actor.firmId, dedupeKey: `part:${partId}` });
  await syncChecklist(assignmentId);
  await publish({ type: 'document.read', firmId: actor.firmId, entityType: 'assignment', entityId: assignmentId, payload: { partId } });
}

async function reextractPart(partId: number) {
  const p = await db.selectFrom('document_parts').selectAll().where('id', '=', partId).executeTakeFirstOrThrow();
  const a = await db.selectFrom('assignments').select(['id', 'firm_id', 'property_type']).where('id', '=', p.assignment_id).executeTakeFirstOrThrow();
  const type = p.corrected_type ?? p.detected_type;
  const types = await docTypes(a.firm_id);
  const pg = json<number[]>(p.pages_json, []);
  const pages = (await db.selectFrom('document_pages').selectAll().where('document_id', '=', p.document_id).where('page_no', 'in', pg).orderBy('page_no').execute())
    .map((x, i) => ({ ...x, orig_page: x.page_no, page_no: i + 1 }));
  const { values } = await extractFields(a.firm_id, type, types.find((t) => t.key === type)?.label ?? type, a.property_type, pages, new Map());
  await writeCandidates(a.id, a.firm_id, values.map((v) => ({
    fieldCode: v.field_code, value: v.value, sourceType: 'document' as const, docType: type, partId, documentId: p.document_id,
    page: pages[v.page - 1]?.orig_page ?? pg[0], snippet: v.snippet, snippetLang: v.snippet_language, confidence: Math.round(v.confidence),
  })));
  await publish({ type: 'document.read', firmId: a.firm_id, entityType: 'assignment', entityId: a.id, payload: { partId } });
}

export async function setReportPages(actor: Actor, assignmentId: number, partId: number, pages: number[]) {
  await assertCase(actor.firmId!, assignmentId);
  const p = await db.selectFrom('document_parts').select(['id', 'pages_json', 'is_kyc']).where('id', '=', partId).where('assignment_id', '=', assignmentId).executeTakeFirst();
  if (!p) throw notFound('Document');
  if (p.is_kyc) throw badRequest('KYC pages are never placed in a report');
  const valid = json<number[]>(p.pages_json, []);
  await db.updateTable('document_parts').set({ in_report_pages: toJson(pages.filter((x) => valid.includes(x))) }).where('id', '=', partId).execute();
  await publish({ type: 'value.changed', firmId: actor.firmId, entityType: 'assignment', entityId: assignmentId, payload: { reportPages: partId } });
}

export async function checklist(firmId: number, assignmentId: number) {
  await assertCase(firmId, assignmentId);
  return db.selectFrom('checklist_items').selectAll().where('assignment_id', '=', assignmentId).orderBy('sort_order').execute();
}

export async function setChecklistState(actor: Actor, assignmentId: number, itemId: number, state: 'y' | 'n' | 'na') {
  await assertCase(actor.firmId!, assignmentId);
  const it = await db.selectFrom('checklist_items').selectAll().where('id', '=', itemId).where('assignment_id', '=', assignmentId).executeTakeFirst();
  if (!it) throw notFound('Checklist item');
  await db.updateTable('checklist_items').set({ state, overridden: state === it.auto_state ? 0 : 1, updated_by: actor.id ?? null }).where('id', '=', itemId).execute();
  const word = { y: 'received', n: 'not provided', na: 'not applicable' }[state];
  await audit(actor, { entityType: 'checklist', entityId: itemId, assignmentId, action: 'checklist.set', summary: `Checklist corrected: ${it.label} marked ${word}. Remark 1 updated.` });
  await publish({ type: 'value.changed', firmId: actor.firmId, entityType: 'assignment', entityId: assignmentId, payload: { checklist: itemId } });
}

export async function addChecklistItem(actor: Actor, assignmentId: number, label: string) {
  await assertCase(actor.firmId!, assignmentId);
  if (!label.trim()) throw badRequest('Type the document name first');
  const n = await db.selectFrom('checklist_items').select((eb) => eb.fn.max('sort_order').as('m')).where('assignment_id', '=', assignmentId).executeTakeFirst();
  await db.insertInto('checklist_items').values({
    assignment_id: assignmentId, item_code: `x${Date.now().toString(36)}`, label: label.trim(), remark_label: label.trim(), doc_types: toJson([]),
    state: 'y', auto_state: 'y', is_manual: 1, sort_order: Number(n?.m ?? 0) + 1, updated_by: actor.id ?? null,
  }).execute();
  await audit(actor, { entityType: 'checklist', assignmentId, action: 'checklist.add', summary: `${label.trim()} received by hand; added to the checklist.` });
  await publish({ type: 'value.changed', firmId: actor.firmId, entityType: 'assignment', entityId: assignmentId, payload: {} });
}

/** Earlier cases with the same survey no., building or society (internal guidance, never cited as evidence). */
export async function seenBefore(firmId: number, assignmentId: number) {
  await assertCase(firmId, assignmentId);
  const mine = await db.selectFrom('document_parts').select('key_facts_json').where('assignment_id', '=', assignmentId).execute();
  const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const facts = { survey: new Set<string>(), building: new Set<string>(), society: new Set<string>(), unit: new Set<string>() };
  for (const m of mine) {
    const k = json<any>(m.key_facts_json, {});
    if (norm(k.survey_no).length > 1) facts.survey.add(norm(k.survey_no));
    if (norm(k.building).length > 1) facts.building.add(norm(k.building));
    if (norm(k.society).length > 3) facts.society.add(norm(k.society));
    if (norm(k.unit_no)) facts.unit.add(norm(k.unit_no));
  }
  if (!facts.society.size && !facts.building.size && !facts.survey.size) return [];
  const others = await db
    .selectFrom('document_parts as p')
    .innerJoin('assignments as a', 'a.id', 'p.assignment_id')
    .innerJoin('banks as b', 'b.id', 'a.bank_id')
    .innerJoin('bank_branches as br', 'br.id', 'a.branch_id')
    .select(['a.id', 'a.case_no', 'a.signed_at', 'a.report_no', 'b.short_name as bank', 'br.name as branch', 'p.key_facts_json'])
    .where('a.firm_id', '=', firmId)
    .where('a.id', '!=', assignmentId)
    .execute();
  const out = new Map<number, any>();
  for (const o of others) {
    const k = json<any>(o.key_facts_json, {});
    const sameSociety = facts.society.has(norm(k.society));
    const sameBuilding = sameSociety && facts.building.has(norm(k.building));
    const sameSurvey = facts.survey.has(norm(k.survey_no));
    if (!sameSociety && !sameSurvey) continue;
    const sameUnit = sameBuilding && facts.unit.has(norm(k.unit_no));
    const match = sameUnit ? 'same flat' : sameBuilding ? 'same building' : sameSociety ? 'same society' : 'same survey no.';
    const prev = out.get(o.id);
    const rank = { 'same flat': 4, 'same building': 3, 'same society': 2, 'same survey no.': 1 } as Record<string, number>;
    if (!prev || rank[match] > rank[prev.match]) out.set(o.id, { assignmentId: o.id, caseNo: o.case_no, reportNo: o.report_no, signedAt: o.signed_at, bank: o.bank, branch: o.branch, unit: k.unit_no, building: k.building, match });
  }
  const list = [...out.values()];
  if (list.length) {
    const vals = await db.selectFrom('valuations').select(['assignment_id', 'adopted_rate']).where('assignment_id', 'in', list.map((l) => l.assignmentId)).where('is_current', '=', 1).execute();
    const rate = new Map(vals.map((v) => [v.assignment_id, v.adopted_rate]));
    list.forEach((l) => (l.rate = rate.get(l.assignmentId) ?? null));
  }
  return list.sort((x, y) => (y.signedAt?.getTime?.() ?? 0) - (x.signedAt?.getTime?.() ?? 0)).slice(0, 10);
}

registerJob('document.read', async ({ documentId }) => {
  try {
    await readDocument(documentId);
  } catch (e) {
    await db.updateTable('documents').set({ status: 'failed', error: (e as Error).message.slice(0, 1000) }).where('id', '=', documentId).execute();
    throw e;
  }
});
registerJob('document.reextract', async ({ partId }) => reextractPart(partId));
