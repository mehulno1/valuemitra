// Builds the data a compiled template is rendered with: every mapped field, signature and seal,
// letterhead, draft marker and the annexure pages (photos, map, ready reckoner, evidence, documents).
import sharp from 'sharp';
import { inr } from '@vm/shared';
import { db, json, type Tx } from '../../db/index.js';
import { pdfToImages } from '../../lib/pdf.js';
import { getSettings } from '../../platform/settings.js';
import { readFile } from '../../platform/storage.js';
import { caseData, type CaseData } from '../casedata/resolver.js';
import { fitImage, type RenderData, type RenderImage } from '../templates/render.js';
import { mapImages } from './maps.js';

export type Mode = 'preview' | 'draft' | 'final';

// markers that let the browser preview find each value:  CODE  value  (pending: )
export const M = { start: '', mid: '', pend: '', end: '' };

interface Built {
  data: RenderData;
  images: Map<string, RenderImage>;
  snapshot: Record<string, unknown>;
}

async function composeSignature(firmId: number, sigId: number | null, sealId: number | null, w: number, h: number): Promise<RenderImage | null> {
  const parts: Buffer[] = [];
  for (const id of [sigId, sealId]) if (id) parts.push((await readFile(id, firmId)).buffer);
  if (!parts.length) return null;
  const scale = 2;
  const tiles = await Promise.all(parts.map((b, i) => sharp(b).resize({ width: Math.round((i === 0 ? w * 0.62 : h) * scale), height: h * scale, fit: 'inside' }).png().toBuffer({ resolveWithObject: true })));
  const width = tiles.reduce((t, x) => t + x.info.width, 0) + 8 * scale;
  const canvas = sharp({ create: { width, height: h * scale, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  let left = 0;
  const comp = tiles.map((x) => { const c = { input: x.data, left, top: Math.round((h * scale - x.info.height) / 2) }; left += x.info.width + 8 * scale; return c; });
  const buffer = await canvas.composite(comp).png().toBuffer();
  return { buffer, width: Math.round(width / scale), height: h };
}

const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export async function buildRenderData(assignmentId: number, firmId: number, mode: Mode, tx: Tx = db): Promise<Built> {
  const data = await caseData(assignmentId, firmId, tx);
  const settings = await getSettings(firmId, tx);
  const images = new Map<string, RenderImage>();
  const out: RenderData = {};
  const snapshot: Record<string, unknown> = {};
  const signed = mode === 'final';

  const mappings = await tx.selectFrom('template_mappings').select(['field_code']).distinct().where('template_version_id', '=', data.case.template_version_id!).where('field_code', 'is not', null).where('ignored', '=', 0).execute();
  for (const { field_code } of mappings) {
    const code = field_code!;
    const r = data.get(code);
    if (r.type === 'image') continue;
    const text = r.state === 'filled' ? r.display ?? '' : '';
    snapshot[code] = text;
    if (mode === 'preview') {
      out[code] = r.state === 'filled' ? `${M.start}${code}${M.mid}${text}${M.end}` : `${M.start}${code}${M.pend}${r.pendingLabel ?? 'Pending'}${M.end}`;
    } else out[code] = text;
  }

  // signature and seal: full at signing blocks, short on every page footer
  out.SIGNED = signed;
  out.SIGN_PENDING = mode === 'preview' ? `${M.start}REPORT.SIGNATURE${M.pend}Signature and seal placed at sign-off${M.end}` : '';
  if (signed) {
    const full = await composeSignature(firmId, settings.signature_file_id, settings.seal_file_id, 190, 72);
    const mini = await composeSignature(firmId, settings.signature_file_id, settings.seal_file_id, 70, 28);
    if (full) { images.set('sig_full', full); out['REPORT.SIGNATURE'] = 'sig_full'; }
    if (mini) { images.set('sig_mini', mini); out.MINI_SIG = 'sig_mini'; }
  }

  const firm = await tx.selectFrom('firms').selectAll().where('id', '=', firmId).executeTakeFirstOrThrow();
  if (settings.letterhead_file_id) {
    images.set('letterhead', await fitImage((await readFile(settings.letterhead_file_id, firmId, tx)).buffer, 640, 110, { png: true }));
    out.HAS_LETTERHEAD = true;
    out.LETTERHEAD = 'letterhead';
  } else {
    out.HAS_LETTERHEAD = false;
    out.FIRM_LINE = firm.name;
    out.FIRM_SUB = [data.value('FIRM.VALUER_NAME'), data.value('FIRM.VALUER_QUALS'), 'Govt. Regd. Valuer', firm.address].filter(Boolean).join(' · ');
  }
  out.IS_DRAFT = !signed;
  out.DRAFT_LINE = `DRAFT v${data.case.draft_version} – not for submission`;

  out.ANNEX_PAGES = await annexPages(data, firmId, settings.doc_grid, images, tx);
  snapshot.annex = (out.ANNEX_PAGES as any[]).map((p) => ({ title: p.title, images: [...JSON.stringify(p).matchAll(/"([a-z]_img)":"([^"]+)"/g)].length }));
  return { data: out, images, snapshot };
}

async function annexPages(data: CaseData, firmId: number, docGrid: number, images: Map<string, RenderImage>, tx: Tx) {
  const pages: any[] = [];
  let n = 0;
  const add = async (buf: Buffer, w: number, h: number) => { const k = `ax${n++}`; images.set(k, await fitImage(buf, w, h)); return k; };

  // photographs: 9 per page, 3 × 3
  const photos = await tx.selectFrom('site_photos').selectAll().where('assignment_id', '=', data.case.id).where('selected', '=', 1).orderBy('sort_order').orderBy('id').execute();
  const photoPages = chunk(photos, 9);
  for (const [i, pg] of photoPages.entries()) {
    const rows = [];
    for (const r of chunk(pg, 3)) {
      const row: Record<string, string> = {};
      for (const [j, p] of r.entries()) {
        const l = 'abc'[j];
        row[`${l}_img`] = await add((await readFile(p.file_id, firmId, tx)).buffer, 200, 250);
        row[`${l}_cap`] = p.caption ?? '';
      }
      rows.push(row);
    }
    pages.push({ title: i === 0 ? 'PHOTOGRAPHS' : 'PHOTOGRAPHS (contd.)', note: '', g3: { rows } });
  }

  // map
  const lat = Number(data.value('PROP.LAT'));
  const lng = Number(data.value('PROP.LNG'));
  if (lat && lng) {
    try {
      const maps = await mapImages(firmId, lat, lng);
      const rows = [];
      for (const m of maps) rows.push({ a_img: await add(m.buffer, 600, 395), a_cap: m.label });
      pages.push({ title: 'LOCATION MAP', note: `Latitude/Longitude: ${data.get('PROP.LATLNG_TEXT').display ?? ''}`, g1: { rows } });
    } catch (e) {
      pages.push({ title: 'LOCATION MAP', note: `Latitude/Longitude: ${data.get('PROP.LATLNG_TEXT').display ?? ''} (map image unavailable)` });
    }
  }

  // ready reckoner
  const rr = data.get('VAL.RR_RATE_SQM');
  if (rr.state === 'filled') {
    pages.push({ title: `STAMP DUTY READY RECKONER FOR YEAR ${data.value('VAL.RR_YEAR') ?? ''}`, note: `Rate: Rs. ${inr(Number(rr.value))}/- per sq.m. (Rs. ${inr(Number(data.value('VAL.RR_RATE_SQFT')))}/- per sq.ft.). ${rr.snippet ?? ''}` });
  }

  // listings and sale transactions: 2 per page, one above the other
  const caps = await tx.selectFrom('evidence_captures').selectAll().where('assignment_id', '=', data.case.id).where('in_report', '=', 1).where('status', '=', 'read').orderBy('id').execute();
  for (const kind of ['listing', 'igr'] as const) {
    const list = caps.filter((c) => (kind === 'igr' ? c.source_kind !== 'listing' : c.source_kind === 'listing'));
    const imgs: { buf: Buffer; cap: string }[] = [];
    for (const c of list) {
      const { file, buffer } = await readFile(c.file_id, firmId, tx);
      const pagesImg = file.mime === 'application/pdf' ? await pdfToImages(buffer, { dpi: 110, first: 1, last: 2 }) : [buffer];
      for (const b of pagesImg) imgs.push({ buf: b, cap: `${c.source_name ?? (kind === 'igr' ? 'IGR search' : 'Listing')}${c.url ? ` · ${c.url}` : ''}` });
    }
    for (const [i, pg] of chunk(imgs, 2).entries()) {
      const rows = [];
      for (const x of pg) rows.push({ a_img: await add(x.buf, 600, 400), a_cap: x.cap });
      pages.push({ title: `${kind === 'igr' ? 'SALE TRANSACTIONS' : 'PROPERTY LISTING'}${i ? ' (contd.)' : ''}`, note: '', g1: { rows } });
    }
  }

  // document pages, grid per firm setting (9 = 3×3, 4 = 2×2, 1 = full page)
  const parts = await tx.selectFrom('document_parts').selectAll().where('assignment_id', '=', data.case.id).where('excluded', '=', 0).orderBy('document_id').orderBy('page_from').execute();
  const docImgs: { fileId: number; cap: string }[] = [];
  for (const p of parts) {
    const want = json<number[]>(p.in_report_pages, []);
    if (!want.length) continue;
    const pg = await tx.selectFrom('document_pages').select(['page_no', 'image_file_id']).where('document_id', '=', p.document_id).where('page_no', 'in', want).orderBy('page_no').execute();
    for (const x of pg) if (x.image_file_id) docImgs.push({ fileId: x.image_file_id, cap: `${p.title ?? p.detected_type}${pg.length > 1 ? `, p. ${x.page_no}` : ''}` });
  }
  const per = docGrid === 4 ? 4 : docGrid === 1 ? 1 : 9;
  const cols = per === 9 ? 3 : per === 4 ? 2 : 1;
  const box = cols === 3 ? [200, 270] : cols === 2 ? [300, 400] : [620, 860];
  for (const [i, pg] of chunk(docImgs, per).entries()) {
    const rows = [];
    for (const r of chunk(pg, cols)) {
      const row: Record<string, string> = {};
      for (const [j, d] of r.entries()) {
        const l = 'abc'[j];
        row[`${l}_img`] = await add((await readFile(d.fileId, firmId, tx)).buffer, box[0], box[1]);
        row[`${l}_cap`] = d.cap;
      }
      rows.push(row);
    }
    pages.push({ title: i ? 'DOCUMENTS (contd.)' : 'DOCUMENTS', note: '', [`g${cols}`]: { rows } });
  }
  return pages;
}

export const fileBase = async (data: CaseData, pattern: string) => {
  const borrower = String(data.value('CUST.NAME') ?? data.case.borrower_name ?? '').replace(/^(mr|mrs|ms|smt|shri|dr)\.?\s+/i, '').trim().split(/\s+/).pop() ?? '';
  const unit = data.value('PROP.UNIT_NO') ? `${data.case.property_type === 'flat' ? 'Flat' : 'Unit'}${data.value('PROP.UNIT_NO')}` : data.case.property_type;
  return pattern
    .replace('{CASE}', data.case.case_no).replace('{BORROWER}', borrower).replace('{UNIT}', String(unit))
    .replace('{BANK}', data.case.bank_code).replace('{BRANCH}', data.case.branch_code)
    .replace(/[^A-Za-z0-9_\-]+/g, '').replace(/_+/g, '_');
};
