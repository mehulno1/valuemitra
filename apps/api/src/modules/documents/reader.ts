// Reading pipeline for one uploaded file: pages → OCR → sort into documents → extract fields with
// source page, snippet and confidence. Runs as a job so slow AI calls never block a request.
import sharp from 'sharp';
import { z } from 'zod';
import { imageBlock, structured, textBlock, type Block } from '../../ai/claude.js';
import { LANG_NAME, ocrImages } from '../../ai/vision.js';
import type { Kysely } from 'kysely';
import { db, json, sql, toJson, type Tx } from '../../db/index.js';
import type { DB } from '../../db/types.js';
import { enqueue, registerJob } from '../../platform/jobs.js';
import { extractPages, pdfPageCount, pdfToImages } from '../../lib/pdf.js';
import { audit, systemActor } from '../../platform/audit.js';
import { activeConfig } from '../../platform/config.js';
import { publish } from '../../platform/events.js';
import { purgeFile, readFile, saveFile } from '../../platform/storage.js';
import { getSettings } from '../../platform/settings.js';
import { dictionary } from '../master/dictionary.js';
import { writeCandidates } from '../casedata/values.js';
import { caseData, EXPR_FNS, type CaseData } from '../casedata/resolver.js';
import { evalExpr } from '@vm/shared';

export interface DocType { key: string; label: string; hint: string; in_report: boolean; is_kyc?: boolean }

export async function docTypes(firmId: number): Promise<DocType[]> {
  const c = await activeConfig<{ types: DocType[] }>('doc_types', 'default', firmId);
  return c?.payload.types ?? [];
}

const MAX_PAGE_CHARS = 3500;

/**
 * Split the stored file into page images and OCR text; stores document_pages. Always reads the stored
 * copy (already redacted if KYC was found before), never the original upload, so page numbers refer
 * to exactly the file that redaction later works on.
 */
export async function preparePages(documentId: number): Promise<number> {
  const d = await db.selectFrom('documents').selectAll().where('id', '=', documentId).executeTakeFirstOrThrow();
  const { file, buffer } = await readFile(d.file_id, d.firm_id);
  let images: Buffer[];
  if (file.mime === 'application/pdf') {
    const n = await pdfPageCount(buffer);
    if (n > 300) throw new Error(`This PDF has ${n} pages; split it before uploading (limit 300)`);
    images = await pdfToImages(buffer, { dpi: 150 });
  } else if (file.mime.startsWith('image/')) {
    images = [await sharp(buffer, { failOn: 'none' }).rotate().jpeg({ quality: 88 }).toBuffer()];
  } else {
    throw new Error(`Cannot read ${file.mime}; upload PDF or images`);
  }
  const prepared: { pageNo: number; image: Buffer }[] = [];
  for (let i = 0; i < images.length; i++) {
    const img = await sharp(images[i]).resize({ width: 1800, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    prepared.push({ pageNo: i + 1, image: img });
  }
  const ocr = await ocrImages(prepared.map((p) => p.image));
  await db.deleteFrom('document_pages').where('document_id', '=', documentId).execute();
  for (const p of prepared) {
    const meta = await sharp(p.image).metadata();
    const imgFile = await saveFile({ firmId: d.firm_id, purpose: 'page_image', folder: `a${d.assignment_id}/pages`, buffer: p.image, mime: 'image/jpeg' });
    const thumb = await sharp(p.image).resize({ width: 260 }).jpeg({ quality: 70 }).toBuffer();
    const thumbFile = await saveFile({ firmId: d.firm_id, purpose: 'page_thumb', folder: `a${d.assignment_id}/pages`, buffer: thumb, mime: 'image/jpeg' });
    const o = ocr[p.pageNo - 1];
    await db.insertInto('document_pages').values({
      document_id: documentId, page_no: p.pageNo, image_file_id: imgFile.id, thumb_file_id: thumbFile.id,
      ocr_text: o?.text ?? '', ocr_languages: (o?.languages ?? []).join(','), ocr_confidence: o?.confidence !== null && o?.confidence !== undefined ? Math.round(o.confidence * 100) : null,
      width_px: meta.width ?? null, height_px: meta.height ?? null,
    }).execute();
  }
  await db.updateTable('documents').set({ page_count: prepared.length, is_scanned: ocr.some((o) => (o.confidence ?? 1) < 0.97) ? 1 : 0 }).where('id', '=', documentId).execute();
  return prepared.length;
}

const pageDigest = (pages: { page_no: number; ocr_text: string | null; ocr_languages: string | null; ocr_confidence: number | null }[]) =>
  pages.map((p) => `=== PAGE ${p.page_no} (OCR confidence ${p.ocr_confidence ?? '?'}%, languages: ${p.ocr_languages || 'unknown'}) ===\n${(p.ocr_text ?? '').slice(0, MAX_PAGE_CHARS) || '(no text found on this page)'}`).join('\n\n');

const PartSchema = z.object({
  parts: z.array(z.object({
    doc_type: z.string().describe('One of the document type keys'),
    title: z.string().describe('Short human label, e.g. "Index II (current registration)"'),
    pages: z.array(z.number().int()).describe('1-based page numbers belonging to this document'),
    languages: z.array(z.string()).describe('Language names, e.g. Marathi, English'),
    confidence: z.number().describe('0-100: how sure the document type is right'),
    report_pages: z.array(z.number().int()).describe('Pages worth placing in the report annexure: usually the first page, and for an agreement the page with the schedule of property'),
    key_facts: z.object({
      survey_no: z.string().nullable(), building: z.string().nullable(), society: z.string().nullable(),
      unit_no: z.string().nullable(), registration_no: z.string().nullable(),
    }),
  })),
});

/** Sort the pages of a bundle into logical documents. */
async function classify(firmId: number, pages: any[], types: DocType[], images: Map<number, Buffer>) {
  const content: Block[] = [];
  for (const [pageNo, img] of images) { content.push(textBlock(`Image of page ${pageNo}:`)); content.push(imageBlock(img)); }
  content.push(textBlock(pageDigest(pages)));
  const system = [
    'You sort the pages of document bundles that banks in India send to property valuers for home-loan valuation.',
    'Assign every page to exactly one document. Documents can be in any order and a document can span several pages.',
    'Pages can be in English, Marathi, Hindi or Gujarati, scanned, photographed or partly handwritten.',
    'Identity documents (Aadhaar, PAN, passport, voter ID, photographs of people) are type "kyc" and must be kept separate.',
    'A photograph of the property itself (not of a document) is type "site_photo".',
    'A document bound inside a larger one is still a document of its own: a floor plan, approved plan, commencement certificate, RERA certificate or Index II annexed to an agreement gets its own entry with its own pages, and the agreement keeps the rest.',
    'An Index II is "index2" only when it is the registration of the property this file is about (same flat and parties as the agreement). An Index II of an earlier sale of the same flat is "index2_prev". An Index II of a different flat or building, given as a comparable sale, is "index2_comp".',
    'Document types:',
    ...types.map((t) => `- ${t.key}: ${t.label}. ${t.hint}`),
  ].join('\n');
  const r = await structured({ system, content, schema: PartSchema, effort: 'medium' });
  // every page exactly once; unassigned pages become "other"
  const seen = new Set<number>();
  const parts = r.data.parts
    .map((p) => ({ ...p, doc_type: types.some((t) => t.key === p.doc_type) ? p.doc_type : 'other', pages: p.pages.filter((n) => n >= 1 && n <= pages.length && !seen.has(n) && (seen.add(n), true)) }))
    .filter((p) => p.pages.length);
  const missing = pages.map((p) => p.page_no).filter((n) => !seen.has(n));
  if (missing.length) parts.push({ doc_type: 'other', title: 'Other / unreadable', pages: missing, languages: [], confidence: 40, report_pages: [], key_facts: { survey_no: null, building: null, society: null, unit_no: null, registration_no: null } });
  return { parts, model: r.model };
}

/** Fields a document type can supply, from the dictionary's source lists. */
export async function targetsFor(firmId: number, docType: string, propertyType: string, extraCodes: string[] = []) {
  const fields = await dictionary(firmId);
  return [...fields.values()].filter(
    (f) => f.status === 'active' && (f.applies.includes('*') || f.applies.includes(propertyType)) &&
      (f.sources.includes(docType) || extraCodes.includes(f.code)) && !['wording', 'derived'].includes(f.type),
  );
}

/** Extract canonical fields from one document's pages. */
export async function extractFields(firmId: number, docType: string, docLabel: string, propertyType: string, pages: any[], images: Map<number, Buffer>, extraCodes: string[] = []) {
  const targets = await targetsFor(firmId, docType, propertyType, extraCodes);
  if (!targets.length) return { values: [], model: null as string | null };
  const codes = targets.map((t) => t.code) as [string, ...string[]];
  const schema = z.object({
    values: z.array(z.object({
      field_code: z.enum(codes),
      value: z.string().describe('Normalised value in English: dates as YYYY-MM-DD, areas and money as plain digits, names with honorifics'),
      page: z.number().int().describe('1-based page number within this document where the value appears'),
      snippet: z.string().describe('The exact words from the page that support the value, in the original language and script, at most 200 characters'),
      snippet_language: z.string().describe('Language of the snippet, e.g. Marathi'),
      confidence: z.number().describe('0-100: how sure you are that the value is read correctly'),
      rank: z.number().int().nullable().describe('Normally 1 or null. Only where the field asks for ranks (a certificate with several dated endorsements): 1 for the latest dated entry, 2, 3, … for each earlier one, as separate values of the same field'),
    })),
  });
  const content: Block[] = [];
  for (const [pageNo, img] of images) { content.push(textBlock(`Image of page ${pageNo}:`)); content.push(imageBlock(img)); }
  content.push(textBlock(pageDigest(pages)));
  content.push(textBlock('Fields to extract (omit any field the document does not state; never guess):\n' + targets.map((t) => `- ${t.code}: ${t.label}${t.unit ? ` [${t.unit}]` : ''}${t.enum ? ` (one of: ${t.enum.join(', ')})` : ''}${t.hint ? ` — ${t.hint}` : ''}`).join('\n')));
  const system = [
    `You read a "${docLabel}" from an Indian property loan file and extract facts for a valuation report.`,
    'Read OCR text together with the page images when given; prefer the image where OCR is garbled or handwritten.',
    'Marathi numerals (०-९) must be converted to digits. Transliterate Marathi names and places to English for the value; keep the snippet in the original script.',
    'Areas: give square feet. If only square metres are stated, convert ×10.764 and round. Built-up and carpet are different; only use what the document labels.',
    'Report each field once, from the page that states it most clearly, unless the field asks for ranked entries. Confidence reflects legibility and how explicit the document is.',
  ].join('\n');
  const r = await structured({ system, content, schema, effort: 'medium' });
  return { values: r.data.values, model: r.model };
}

/** Several readings of one field from one document (dated endorsements of a C.C.): the latest (rank 1) first and in
 *  use; the earlier ones are kept beside it, on offer under "Use this". Fields read once pass through unchanged. */
export function ranked<T extends { field_code: string; value: string; rank?: number | null }>(values: T[]): (T & { keep?: boolean; chosen?: boolean })[] {
  const by = new Map<string, T[]>();
  for (const v of values) by.set(v.field_code, [...(by.get(v.field_code) ?? []), v]);
  const out: (T & { keep?: boolean; chosen?: boolean })[] = [];
  for (const list of by.values()) {
    const sorted = [...list].sort((x, y) => (x.rank ?? 1) - (y.rank ?? 1));
    const distinct = sorted.filter((v, i) => sorted.findIndex((o) => o.value.trim().toLowerCase() === v.value.trim().toLowerCase()) === i);
    distinct.forEach((v, i) => out.push(distinct.length > 1 ? { ...v, keep: i > 0, chosen: i === 0 } : v));
  }
  return out;
}

/** The flat's own number from "B-2303", "Flat 1001, 10th floor" or "3102, 31st floor": the first run of digits
 *  (the wing letter and the floor written after it are not part of it). */
export const unitNo = (s: unknown) => /\d+/.exec(String(s ?? '').replace(/\d+\s*(st|nd|rd|th)\b/gi, ' '))?.[0].replace(/^0+(?=\d)/, '') ?? '';
/** Serial and year of a registration number: "TNN2/11700/2021", "THN1-13802-2026" and "11700/2021" → "11700/2021". */
export const regNo = (s: unknown) => { const m = /(\d{3,6})\s*[/\-]\s*((?:19|20)\d{2})\b/.exec(String(s ?? '')); return m ? `${Number(m[1])}/${m[2]}` : ''; };
/** Is an Index II for another property than the agreement? The same registration number settles it (same document);
 *  else different flat numbers; else, with no flat number to compare, different buyers in a different building. */
export function otherProperty(idx: { unit: string; reg: string; building: string; buyer: Set<string> }, ref: { unit: string; reg: string; building: string; buyer: Set<string> }): boolean {
  if (idx.reg && ref.reg) return idx.reg !== ref.reg && !(idx.unit && idx.unit === ref.unit);
  if (idx.unit && ref.unit) return idx.unit !== ref.unit;
  if (idx.buyer.size && ref.buyer.size && ![...idx.buyer].some((w) => ref.buyer.has(w))) return !(idx.building && ref.building && idx.building === ref.building);
  return false;
}
const normId = (s: unknown) => String(s ?? '').toLowerCase().replace(/\b(flat|unit|shop|office|no|number|room|building|bldg|wing)\b/g, '').replace(/[^a-z0-9]/g, '');
const nameTokens = (s: unknown) => new Set(String(s ?? '').toLowerCase().replace(/\b(mr|mrs|ms|miss|shri|smt|m\/s|and|pvt|ltd|llp)\b/g, ' ').split(/[^a-z]+/).filter((w) => w.length >= 3));

/** An Index II that came with the file but belongs to another flat (a comparable sale) must not give this property's
 *  agreement value, guideline value, floor or parties. Each "index2" document is matched with the agreement (flat
 *  no., then buyer, then building); one that does not match is relabelled as a comparable: its values are withdrawn,
 *  it leaves the documents annexure and its pages go to Market evidence, where they are read as a sale transaction. */
export async function reconcileIndex2(assignmentId: number, firmId: number) {
  const parts = await db.selectFrom('document_parts').selectAll().where('assignment_id', '=', assignmentId).where('excluded', '=', 0).execute();
  const typeOf = (p: (typeof parts)[number]) => p.corrected_type ?? p.detected_type;
  const a = await db.selectFrom('assignments').select(['borrower_name', 'signed_at']).where('id', '=', assignmentId).executeTakeFirstOrThrow();
  if (a.signed_at) return;
  const idx = parts.filter((p) => typeOf(p) === 'index2' && !p.corrected_type);
  // read as a comparable's Index II straight away: only its pages still have to go to Market evidence
  const direct = parts.filter((p) => typeOf(p) === 'index2_comp' && p.moved_to !== 'market_evidence');
  if (!idx.length && !direct.length) return;
  const vals = await db.selectFrom('field_values').select(['part_id', 'field_code', 'value_text']).where('assignment_id', '=', assignmentId).where('is_current', '=', 1).where('source_type', '=', 'document')
    .where('field_code', 'in', ['DOC.AGREEMENT.BUYER', 'PROP.UNIT_NO', 'PROP.BUILDING']).execute();
  const of = (partId: number, code: string) => vals.find((v) => v.part_id === partId && v.field_code === code)?.value_text ?? null;
  const facts = (p: (typeof parts)[number]) => {
    const k = json<any>(p.key_facts_json, {});
    return { unit: unitNo(of(p.id, 'PROP.UNIT_NO') ?? k.unit_no), reg: regNo(k.registration_no), building: normId(of(p.id, 'PROP.BUILDING') ?? k.building), buyer: nameTokens(of(p.id, 'DOC.AGREEMENT.BUYER')) };
  };
  const agr = parts.find((p) => ['agreement', 'sale_deed'].includes(typeOf(p)));
  const ref = agr ? facts(agr) : { unit: '', reg: '', building: '', buyer: new Set<string>() };
  if (!ref.buyer.size) ref.buyer = nameTokens(a.borrower_name);
  const overlap = (x: Set<string>, y: Set<string>) => [...x].some((w) => y.has(w));
  const mismatch = (p: (typeof parts)[number]) => otherProperty(facts(p), ref);
  // with no agreement to compare, two Index II of different flats: the one naming the borrower is the property's own
  let other = idx.filter(mismatch);
  if (!agr && !other.length && idx.length > 1) {
    const mine = idx.find((p) => overlap(facts(p).buyer, ref.buyer));
    if (mine) other = idx.filter((p) => p !== mine && facts(p).unit && facts(mine).unit && facts(p).unit !== facts(mine).unit);
  }
  if (other.length === idx.length && !agr) other = []; // nothing certain to compare with
  const { retractPartCandidates } = await import('../casedata/values.js');
  for (const p of [...other, ...direct]) {
    await db.updateTable('document_parts').set({ ...(direct.includes(p) ? {} : { corrected_type: 'index2_comp' }), in_report_pages: toJson([]), moved_to: 'market_evidence' }).where('id', '=', p.id).execute();
    await retractPartCandidates(assignmentId, p.id);
    // its pages become a captured sale transaction on Market evidence
    const pg = json<number[]>(p.pages_json, []);
    const doc = await db.selectFrom('documents').select(['file_id']).where('id', '=', p.document_id).executeTakeFirstOrThrow();
    const { file, buffer } = await readFile(doc.file_id, firmId);
    let fileId = doc.file_id;
    if (file.mime === 'application/pdf' && pg.length && pg.length < (await pdfPageCount(buffer))) {
      fileId = (await saveFile({ firmId, purpose: 'evidence', folder: `a${assignmentId}/evidence`, buffer: await extractPages(buffer, pg), name: `Index II (comparable) p${pg[0]}.pdf`, mime: 'application/pdf' })).id;
    }
    const r = await db.insertInto('evidence_captures').values({ assignment_id: assignmentId, file_id: fileId, source_kind: 'igr', source_name: 'Index II received with the documents', status: 'uploaded' }).executeTakeFirstOrThrow();
    await enqueue('evidence.read', { captureId: Number(r.insertId) }, { firmId });
    await audit(systemActor(firmId), { entityType: 'document_part', entityId: p.id, assignmentId, action: 'document.index2_comparable', summary: `${p.title ?? 'Index II'} (p. ${pg.join(', ')}) is for another flat or other parties than the agreement: treated as a comparable sale. Its values are not used for this property; it is read on Market evidence and prints under Sale transactions.` });
  }
  if (other.length) await syncChecklist(assignmentId);
  if (other.length) await publish({ type: 'document.read', firmId, entityType: 'assignment', entityId: assignmentId, payload: { index2: other.map((p) => p.id) } });
}

/** Pages whose OCR is weak, or handwritten-prone documents, are also sent as images. */
async function pageImages(pages: any[], pick: (p: any) => boolean, max = 8): Promise<Map<number, Buffer>> {
  const out = new Map<number, Buffer>();
  for (const p of pages.filter(pick).slice(0, max)) {
    if (!p.image_file_id) continue;
    const { buffer } = await readFile(p.image_file_id, p.firm_id);
    out.set(p.page_no, await sharp(buffer).resize({ width: 1400, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer());
  }
  return out;
}

/** The job: read one uploaded bank document file end to end. */
export async function readDocument(documentId: number) {
  const d = await db.selectFrom('documents').selectAll().where('id', '=', documentId).executeTakeFirstOrThrow();
  const a = await db.selectFrom('assignments').select(['id', 'firm_id', 'property_type', 'case_no']).where('id', '=', d.assignment_id).executeTakeFirstOrThrow();
  await db.updateTable('documents').set({ status: 'reading', error: null }).where('id', '=', documentId).execute();
  const pageCount = await preparePages(documentId);
  const pages = (await db.selectFrom('document_pages').selectAll().where('document_id', '=', documentId).orderBy('page_no').execute()).map((p) => ({ ...p, firm_id: d.firm_id }));
  const types = await docTypes(a.firm_id);
  const weak = (p: any) => (p.ocr_confidence ?? 0) < 80 || (p.ocr_text ?? '').length < 40;

  // 1. sort into documents (a single photo is one document; skip the classification call only if it is clearly one page)
  const { parts } = await classify(a.firm_id, pages, types, await pageImages(pages, weak, 6));
  await db.deleteFrom('document_parts').where('document_id', '=', documentId).execute();
  const summary: (string | { title: string; pages: number[] })[] = [];
  const kycSet = new Set<number>();
  let kycPages = 0;
  for (const p of parts) {
    const t = types.find((x) => x.key === p.doc_type);
    const isKyc = !!t?.is_kyc;
    const sorted = [...p.pages].sort((x, y) => x - y);
    const r = await db.insertInto('document_parts').values({
      assignment_id: a.id, document_id: documentId, detected_type: p.doc_type, title: p.title, page_from: sorted[0], page_to: sorted[sorted.length - 1],
      pages_json: toJson(sorted), languages: p.languages.join(', '), confidence: Math.round(p.confidence), is_kyc: isKyc ? 1 : 0, excluded: isKyc ? 1 : 0,
      moved_to: p.doc_type === 'site_photo' ? 'site_photos' : null, key_facts_json: toJson(p.key_facts),
      in_report_pages: toJson(t?.in_report ? (p.report_pages.length ? p.report_pages.filter((x) => sorted.includes(x)) : [sorted[0]]) : []),
    }).executeTakeFirstOrThrow();
    const partId = Number(r.insertId);
    if (isKyc) {
      kycPages += sorted.length;
      for (const x of sorted) kycSet.add(x);
      // KYC is never placed in a report; mark its page images so retention deletes them
      const ids = pages.filter((x) => sorted.includes(x.page_no)).flatMap((x) => [x.image_file_id, x.thumb_file_id]).filter(Boolean) as number[];
      if (ids.length) await db.updateTable('files').set({ is_kyc: 1 }).where('id', 'in', ids).execute();
      if ((await getSettings(a.firm_id)).kyc_policy === 'never') for (const fid of ids) await purgeFile(fid);
      await db.updateTable('document_pages').set({ ocr_text: null }).where('document_id', '=', documentId).where('page_no', 'in', sorted).execute();
      continue;
    }
    if (p.doc_type === 'site_photo') {
      for (const pg of pages.filter((x) => sorted.includes(x.page_no))) {
        await db.insertInto('site_photos').values({ assignment_id: a.id, file_id: pg.image_file_id!, thumb_file_id: pg.thumb_file_id, source: 'document', caption: p.title, ai_caption: p.title }).execute();
      }
      summary.push(`${p.title} moved to site photos`);
      continue;
    }
    summary.push({ title: p.title, pages: sorted });
    // 2. extract fields from this document
    const partPages = pages.filter((x) => sorted.includes(x.page_no)).map((x, i) => ({ ...x, page_no: i + 1, orig_page: x.page_no }));
    const imgs = await pageImages(partPages, (x) => weak(x) || ['oc', 'index2', 'index2_prev'].includes(p.doc_type), 6);
    const { values } = await extractFields(a.firm_id, p.doc_type, t?.label ?? p.doc_type, a.property_type, partPages, imgs);
    await writeCandidates(a.id, a.firm_id, ranked(values).map((v) => ({
      fieldCode: v.field_code, value: v.value, sourceType: 'document' as const, docType: p.doc_type, partId, documentId,
      page: partPages[v.page - 1]?.orig_page ?? sorted[0], snippet: v.snippet, snippetLang: v.snippet_language, confidence: Math.round(v.confidence), keep: v.keep, chosen: v.chosen,
    })));
  }
  await reconcileIndex2(a.id, a.firm_id);
  if (kycPages) await applyKyc(documentId, a.firm_id);
  // page numbers as the document list shows them: after KYC pages are taken out of the stored file
  const renumber = (n: number) => n - [...kycSet].filter((k) => k < n).length;
  const said = summary.map((x) => (typeof x === 'string' ? x : `${x.title} (${x.pages.length > 1 ? 'pp.' : 'p.'} ${x.pages.map(renumber).join(', ')})`));
  await db.updateTable('documents').set({ status: 'read' }).where('id', '=', documentId).execute();
  await syncChecklist(a.id);
  const actor = systemActor(a.firm_id);
  const docs = parts.filter((p) => !types.find((t) => t.key === p.doc_type)?.is_kyc && p.doc_type !== 'site_photo').length;
  await audit(actor, {
    entityType: 'document', entityId: documentId, assignmentId: a.id, action: 'document.read',
    summary: `${d.channel ? `Received on ${d.channel}` : 'Uploaded'}: ${pageCount} page(s). Sorted into ${docs} document(s)${kycPages ? `; KYC pages (${kycPages}) removed; page numbers below are after removal` : ''}. ${said.join('; ')}.`,
  });
  await publish({ type: 'document.read', firmId: a.firm_id, entityType: 'assignment', entityId: a.id, payload: { documentId } });
}

/**
 * Take KYC pages out of a document. Page numbers always refer to the current stored file
 * (documents.file_id); after redaction every page reference is renumbered to the new file in one
 * transaction, so a later re-read or a manual KYC label works on consistent numbers.
 * Fail-closed: the stored file is flagged KYC before anything that can fail.
 */
export async function applyKyc(documentId: number, firmId: number) {
  // fail-closed first, before any lock: hide (flag + clear text) but never delete here. If page numbers
  // shift concurrently the worst case is hiding an extra page; deletion happens only under the lock.
  await hideKycPages(db, documentId, firmId, { purge: false });
  // then one redaction per document at a time; all locked work runs on the connection holding the lock
  await db.connection().execute(async (conn) => {
    const lock = `vm_kyc_${documentId}`;
    const got = await sql<{ l: number }>`SELECT GET_LOCK(${lock}, 30) AS l`.execute(conn);
    if (got.rows[0]?.l !== 1) {
      // busy: try again shortly; a fresh key per attempt so a running job never swallows the retry
      await enqueue('document.kyc', { documentId, firmId }, { firmId, delayMs: 60_000, dedupeKey: `kyc:${documentId}:${Date.now()}` });
      return;
    }
    try {
      await applyKycLocked(conn, documentId, firmId);
    } finally {
      await sql`SELECT RELEASE_LOCK(${lock})`.execute(conn);
    }
  });
}

/** Flag the stored file and KYC page images, clear their text, and delete them under "never stored". */
async function hideKycPages(tx: Tx, documentId: number, firmId: number, opts: { purge: boolean } = { purge: true }) {
  const d = await tx.selectFrom('documents').select(['file_id', 'page_count']).where('id', '=', documentId).executeTakeFirstOrThrow();
  const parts = await tx.selectFrom('document_parts').select('pages_json').where('document_id', '=', documentId).where('is_kyc', '=', 1).execute();
  const kyc = [...new Set(parts.flatMap((x) => json<number[]>(x.pages_json, [])))].filter((p) => p >= 1 && p <= d.page_count);
  // the stored file counts as KYC until a clean copy replaces it
  await tx.updateTable('files').set({ is_kyc: 1 }).where('id', '=', d.file_id).execute();
  if (!kyc.length) return [];
  const pg = await tx.selectFrom('document_pages').select(['image_file_id', 'thumb_file_id']).where('document_id', '=', documentId).where('page_no', 'in', kyc).execute();
  const imgIds = pg.flatMap((x) => [x.image_file_id, x.thumb_file_id]).filter(Boolean) as number[];
  if (imgIds.length) await tx.updateTable('files').set({ is_kyc: 1 }).where('id', 'in', imgIds).execute();
  await tx.updateTable('document_pages').set({ ocr_text: null, ocr_json: null }).where('document_id', '=', documentId).where('page_no', 'in', kyc).execute();
  if (opts.purge && (await getSettings(firmId, tx)).kyc_policy === 'never') for (const id of imgIds) await purgeFile(id, tx);
  return kyc;
}

async function applyKycLocked(conn: Tx, documentId: number, firmId: number) {
  const d = await conn.selectFrom('documents').select(['file_id', 'original_file_id', 'assignment_id', 'page_count']).where('id', '=', documentId).executeTakeFirstOrThrow();
  // KYC pages in the current numbering, read under the lock
  const kyc = await hideKycPages(conn, documentId, firmId);
  if (!kyc.length) return;
  const never = (await getSettings(firmId, conn)).kyc_policy === 'never';
  const { file, buffer } = await readFile(d.file_id, firmId, conn);
  const keep = Array.from({ length: d.page_count }, (_, i) => i + 1).filter((p) => !kyc.includes(p));
  if (file.mime !== 'application/pdf' || !keep.length) {
    // nothing to keep (e.g. a photo of an Aadhaar card): the stored file itself is KYC
    if (never) await purgeFile(d.file_id, conn);
    return;
  }
  if ((await pdfPageCount(buffer)) !== d.page_count) throw new Error('Stored file and page records disagree; KYC redaction stopped (file stays flagged KYC)');
  const redacted = await extractPages(buffer, keep);
  const f = await saveFile({ firmId, purpose: 'upload', folder: `a${d.assignment_id}/uploads`, buffer: redacted, name: (file.original_name ?? 'document.pdf').replace(/( \(KYC removed\))?\.pdf$/i, '') + ' (KYC removed).pdf', mime: 'application/pdf' }, conn);
  const map = new Map(keep.map((old, i) => [old, i + 1]));
  const remap = (xs: number[]) => xs.map((x) => map.get(x)).filter((x): x is number => x !== undefined);
  try {
    await (conn as Kysely<DB>).transaction().execute(async (tx) => {
      const cur = await tx.selectFrom('documents').select(['file_id', 'page_count']).where('id', '=', documentId).forUpdate().executeTakeFirstOrThrow();
      if (cur.file_id !== d.file_id || cur.page_count !== d.page_count) {
        await tx.updateTable('files').set({ is_kyc: 1 }).where('id', '=', cur.file_id).execute();
        throw new Error('Document changed during KYC redaction; the stored file stays flagged KYC');
      }
      await tx.deleteFrom('document_pages').where('document_id', '=', documentId).where('page_no', 'in', kyc).execute();
      // two steps so the unique (document, page) key never collides
      for (const [oldNo, newNo] of map) await tx.updateTable('document_pages').set({ page_no: 100000 + newNo }).where('document_id', '=', documentId).where('page_no', '=', oldNo).execute();
      await tx.updateTable('document_pages').set({ page_no: sql`page_no - 100000` }).where('document_id', '=', documentId).where('page_no', '>', 100000).execute();
      for (const part of await tx.selectFrom('document_parts').select(['id', 'pages_json', 'in_report_pages', 'is_kyc']).where('document_id', '=', documentId).execute()) {
        const pages = part.is_kyc ? [] : remap(json<number[]>(part.pages_json, []));
        await tx.updateTable('document_parts').set({
          pages_json: toJson(pages), in_report_pages: toJson(part.is_kyc ? [] : remap(json<number[]>(part.in_report_pages, []))),
          page_from: pages[0] ?? 0, page_to: pages[pages.length - 1] ?? 0,
        }).where('id', '=', part.id).execute();
      }
      for (const [oldNo, newNo] of map) if (oldNo !== newNo) await tx.updateTable('field_values').set({ page_no: newNo }).where('document_id', '=', documentId).where('page_no', '=', oldNo).execute();
      await tx.updateTable('documents').set({ file_id: f.id, original_file_id: d.original_file_id ?? d.file_id, page_count: keep.length }).where('id', '=', documentId).execute();
    });
  } catch (e) {
    // the redacted copy was never attached; remove it (the stored file stays flagged KYC)
    await purgeFile(f.id, conn);
    throw e;
  }
  // the file just replaced: an intermediate copy goes now; the original upload waits for the KYC policy
  if (d.original_file_id || never) await purgeFile(d.file_id, conn);
}

registerJob('document.kyc', async ({ documentId, firmId }) => applyKyc(documentId, firmId));

/** Checklist items follow the documents found, unless a person overrode them. An item the profile marks
 * not applicable for this case (e.g. the O.C. while the building is under construction) is set n/a. */
export async function syncChecklist(assignmentId: number) {
  const items = await db.selectFrom('checklist_items').selectAll().where('assignment_id', '=', assignmentId).execute();
  const parts = await db.selectFrom('document_parts').select(['detected_type', 'corrected_type', 'excluded']).where('assignment_id', '=', assignmentId).execute();
  const types = new Set(parts.filter((p) => !p.excluded).map((p) => p.corrected_type ?? p.detected_type));
  const sheet = await db.selectFrom('documents').select('id').where('assignment_id', '=', assignmentId).where('role', '=', 'site_sheet').where('status', '=', 'read').executeTakeFirst();
  if (sheet) types.add('site_sheet');
  const photos = await db.selectFrom('site_photos').select('id').where('assignment_id', '=', assignmentId).where('source', '=', 'engineer').limit(1).executeTakeFirst();
  if (photos) types.add('@photos');
  let data: CaseData | null = null;
  const notApplicable = async (code: string) => {
    if (!data) {
      const a = await db.selectFrom('assignments').select('firm_id').where('id', '=', assignmentId).executeTakeFirstOrThrow();
      data = await caseData(assignmentId, a.firm_id);
    }
    const expr: string | undefined = (data.profile.checklist ?? []).find((i: { code: string }) => i.code === code)?.na_when;
    return expr ? !!evalExpr(expr, data.resolver, EXPR_FNS) : false;
  };
  for (const it of items) {
    if (it.is_manual) continue;
    const dt = json<string[]>(it.doc_types, []);
    const auto = dt.some((x) => types.has(x)) ? 'y' : (await notApplicable(it.item_code)) ? 'na' : 'n';
    if (auto !== it.auto_state || (!it.overridden && it.state !== auto)) {
      await db.updateTable('checklist_items').set({ auto_state: auto, state: it.overridden ? it.state : auto }).where('id', '=', it.id).execute();
    }
  }
}

export const langLabel = (codes: string | null) => (codes ?? '').split(',').filter(Boolean).map((c) => LANG_NAME[c] ?? c).join(', ');
