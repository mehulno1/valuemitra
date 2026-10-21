// Reading pipeline for one uploaded file: pages → OCR → sort into documents → extract fields with
// source page, snippet and confidence. Runs as a job so slow AI calls never block a request.
import sharp from 'sharp';
import { z } from 'zod';
import { imageBlock, structured, textBlock, type Block } from '../../ai/claude.js';
import { LANG_NAME, ocrImages } from '../../ai/vision.js';
import { db, json, toJson } from '../../db/index.js';
import { extractPages, pdfPageCount, pdfToImages } from '../../lib/pdf.js';
import { audit, systemActor } from '../../platform/audit.js';
import { activeConfig } from '../../platform/config.js';
import { publish } from '../../platform/events.js';
import { purgeFile, readFile, saveFile } from '../../platform/storage.js';
import { getSettings } from '../../platform/settings.js';
import { dictionary } from '../master/dictionary.js';
import { writeCandidates } from '../casedata/values.js';

export interface DocType { key: string; label: string; hint: string; in_report: boolean; is_kyc?: boolean }

export async function docTypes(firmId: number): Promise<DocType[]> {
  const c = await activeConfig<{ types: DocType[] }>('doc_types', 'default', firmId);
  return c?.payload.types ?? [];
}

const MAX_PAGE_CHARS = 3500;

/**
 * The file a document is read from: the original upload while it still exists, else the stored
 * (redacted) copy. Page numbers from reading always refer to this same file, so redaction does too.
 */
async function sourceFileId(d: { file_id: number; original_file_id: number | null }) {
  if (!d.original_file_id) return d.file_id;
  const o = await db.selectFrom('files').select('purged_at').where('id', '=', d.original_file_id).executeTakeFirst();
  return o && !o.purged_at ? d.original_file_id : d.file_id;
}

/** Split the file into page images and OCR text; stores document_pages. */
export async function preparePages(documentId: number) {
  const d = await db.selectFrom('documents').selectAll().where('id', '=', documentId).executeTakeFirstOrThrow();
  const { file, buffer } = await readFile(await sourceFileId(d), d.firm_id);
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
    'Report each field once, from the page that states it most clearly. Confidence reflects legibility and how explicit the document is.',
  ].join('\n');
  const r = await structured({ system, content, schema, effort: 'medium' });
  return { values: r.data.values, model: r.model };
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
  const summary: string[] = [];
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
    summary.push(`${p.title} (pp. ${sorted.join(', ')})`);
    // 2. extract fields from this document
    const partPages = pages.filter((x) => sorted.includes(x.page_no)).map((x, i) => ({ ...x, page_no: i + 1, orig_page: x.page_no }));
    const imgs = await pageImages(partPages, (x) => weak(x) || ['oc', 'index2', 'index2_prev'].includes(p.doc_type), 6);
    const { values } = await extractFields(a.firm_id, p.doc_type, t?.label ?? p.doc_type, a.property_type, partPages, imgs);
    await writeCandidates(a.id, a.firm_id, values.map((v) => ({
      fieldCode: v.field_code, value: v.value, sourceType: 'document' as const, docType: p.doc_type, partId, documentId,
      page: partPages[v.page - 1]?.orig_page ?? sorted[0], snippet: v.snippet, snippetLang: v.snippet_language, confidence: Math.round(v.confidence),
    })));
  }
  if (kycPages) await redactKyc(documentId, a.firm_id, parts.filter((p) => types.find((t) => t.key === p.doc_type)?.is_kyc).flatMap((p) => p.pages), pageCount);
  await db.updateTable('documents').set({ status: 'read' }).where('id', '=', documentId).execute();
  await syncChecklist(a.id);
  const actor = systemActor(a.firm_id);
  const docs = parts.filter((p) => !types.find((t) => t.key === p.doc_type)?.is_kyc && p.doc_type !== 'site_photo').length;
  await audit(actor, {
    entityType: 'document', entityId: documentId, assignmentId: a.id, action: 'document.read',
    summary: `${d.channel ? `Received on ${d.channel}` : 'Uploaded'}: ${pageCount} page(s). Sorted into ${docs} document(s)${kycPages ? `; KYC pages (${kycPages}) kept out of the report` : ''}. ${summary.join('; ')}.`,
  });
  await publish({ type: 'document.read', firmId: a.firm_id, entityType: 'assignment', entityId: a.id, payload: { documentId } });
}

/**
 * KYC never stays in the stored upload: a bundle is replaced by a copy without the KYC pages and
 * the original is flagged KYC (deleted at once under "never stored", else on the firm's schedule).
 */
async function redactKyc(documentId: number, firmId: number, kycPages: number[], pageCount: number) {
  const d = await db.selectFrom('documents').select(['file_id', 'original_file_id', 'assignment_id']).where('id', '=', documentId).executeTakeFirstOrThrow();
  // the same file the pages were read from, so page numbers line up
  const readFrom = await sourceFileId(d);
  const originalId = d.original_file_id ?? d.file_id;
  const { file, buffer } = await readFile(readFrom, firmId);
  const keep = Array.from({ length: pageCount }, (_, i) => i + 1).filter((p) => !kycPages.includes(p));
  await db.updateTable('files').set({ is_kyc: 1 }).where('id', 'in', [...new Set([originalId, readFrom])]).execute();
  if (file.mime === 'application/pdf' && keep.length) {
    const redacted = await extractPages(buffer, keep);
    const f = await saveFile({ firmId, purpose: 'upload', folder: `a${d.assignment_id}/uploads`, buffer: redacted, name: (file.original_name ?? 'document.pdf').replace(/\.pdf$/i, '') + ' (KYC removed).pdf', mime: 'application/pdf' });
    await db.updateTable('documents').set({ file_id: f.id, original_file_id: originalId }).where('id', '=', documentId).execute();
    // an earlier redacted copy that still held KYC pages is no longer needed
    if (readFrom !== originalId) await purgeFile(readFrom);
  } else {
    await db.updateTable('documents').set({ original_file_id: originalId }).where('id', '=', documentId).execute();
  }
  if ((await getSettings(firmId)).kyc_policy === 'never') await purgeFile(originalId);
}

/** Checklist items follow the documents found, unless a person overrode them. */
export async function syncChecklist(assignmentId: number) {
  const items = await db.selectFrom('checklist_items').selectAll().where('assignment_id', '=', assignmentId).execute();
  const parts = await db.selectFrom('document_parts').select(['detected_type', 'corrected_type', 'excluded']).where('assignment_id', '=', assignmentId).execute();
  const types = new Set(parts.filter((p) => !p.excluded).map((p) => p.corrected_type ?? p.detected_type));
  const sheet = await db.selectFrom('documents').select('id').where('assignment_id', '=', assignmentId).where('role', '=', 'site_sheet').where('status', '=', 'read').executeTakeFirst();
  if (sheet) types.add('site_sheet');
  const photos = await db.selectFrom('site_photos').select('id').where('assignment_id', '=', assignmentId).where('source', '=', 'engineer').limit(1).executeTakeFirst();
  if (photos) types.add('@photos');
  for (const it of items) {
    if (it.is_manual) continue;
    const dt = json<string[]>(it.doc_types, []);
    const auto = dt.some((x) => types.has(x)) ? 'y' : 'n';
    if (auto !== it.auto_state || (!it.overridden && it.state !== auto)) {
      await db.updateTable('checklist_items').set({ auto_state: auto, state: it.overridden ? it.state : auto }).where('id', '=', it.id).execute();
    }
  }
}

export const langLabel = (codes: string | null) => (codes ?? '').split(',').filter(Boolean).map((c) => LANG_NAME[c] ?? c).join(', ');
