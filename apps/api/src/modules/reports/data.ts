// Builds the data a compiled template is rendered with: every mapped field, signature and seal,
// letterhead, draft marker and the annexure pages (photos, map, ready reckoner, evidence, documents).
import sharp from 'sharp';
import { ddmmyyyy, inr } from '@vm/shared';
import { db, json, type Tx } from '../../db/index.js';
import { pdfToImages } from '../../lib/pdf.js';
import { activeConfig } from '../../platform/config.js';
import { getSettings } from '../../platform/settings.js';
import { readFile } from '../../platform/storage.js';
import { caseData, COMP_ROWS, type CaseData } from '../casedata/resolver.js';
import { fitImage, type RenderData, type RenderImage } from '../templates/render.js';
import { conditionKey, fillTemplate, templateKey, versionConditions, versionFieldCodes, versionTemplates } from '../templates/codes.js';
import { keepAnnexures, pageLayout } from '../templates/layout.js';
import { mapImages } from './maps.js';

// final_preview: the final layout before signing (no draft line; the signature is not placed)
export type Mode = 'preview' | 'draft' | 'final' | 'final_preview';

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

const COMP_PARTS = ['SOURCE', 'DESC', 'VALUE', 'AREA', 'RATE', 'VALUE_TEXT', 'RATE_TEXT'];
const JUNK = /^\s*(ok|n\.?\s*a\.?|nil|not available|-+|0+(\.0+)?)?\s*$/i;

/** How the comparables chart prints for this case, and which of its rows are empty. */
export function compPrint(data: CaseData): { mode: 'filled' | 'na' | 'none'; empty: number[] } {
  const raw = String(data.value('VAL.COMP_PRINT') ?? '').toLowerCase();
  const mode = raw === 'na' || /not available/.test(raw) ? 'na' : raw === 'none' || /leave|out|omit/.test(raw) ? 'none' : 'filled';
  const empty: number[] = [];
  for (let n = 1; n <= COMP_ROWS; n++) {
    const vals = ['SOURCE', 'DESC', 'VALUE', 'AREA', 'RATE'].map((p) => data.get(`EVID.COMP${n}.${p}`)).map((r) => (r.state === 'filled' ? String(r.value ?? '') : ''));
    if (vals.every((v) => JUNK.test(v))) empty.push(n);
  }
  return { mode, empty };
}

const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** `versionId` renders another format than the case's own (Bank formats → Preview). */
export async function buildRenderData(assignmentId: number, firmId: number, mode: Mode, tx: Tx = db, versionId?: number): Promise<Built> {
  const data = await caseData(assignmentId, firmId, tx);
  const tplVersion = versionId ?? data.case.template_version_id;
  const settings = await getSettings(firmId, tx);
  const images = new Map<string, RenderImage>();
  const out: RenderData = {};
  const snapshot: Record<string, unknown> = {};
  const signed = mode === 'final';

  for (const code of await versionFieldCodes(tplVersion, tx)) {
    const r = data.get(code);
    if (r.type === 'image') continue;
    const shown = r.state === 'filled' || r.notProvided;
    // a document summary that is only a status ("Not provided") prints with the document's name, so a list
    // item never reads just "Not provided" (B4)
    const named = /\.SUMMARY$/.test(code);
    const status = r.notProvided ? 'not provided' : r.state === 'filled' && /^\s*(not provided|not applicable|n\.?\s*a\.?|nil)\s*\.?\s*$/i.test(String(r.display ?? '')) ? String(r.display).trim().replace(/\.$/, '').toLowerCase() : null;
    const text = named && status ? `${r.label}: ${status}` : r.state === 'filled' ? r.display ?? '' : r.notProvided ? 'Not provided' : '';
    snapshot[code] = text;
    if (mode === 'preview') {
      out[code] = shown ? `${M.start}${code}${M.mid}${text}${M.end}` : `${M.start}${code}${M.pend}${r.pendingLabel ?? 'Pending'}${M.end}`;
    } else out[code] = text;
  }

  // lines and rows the format prints only when a field has a value other than "No" ({{?FIELD.CODE}})
  for (const code of await versionConditions(tplVersion, tx)) {
    const r = data.get(code);
    out[conditionKey(code)] = r.state === 'filled' && !/^(no|false|0|nil|not provided)$/i.test(String(r.value ?? '').trim());
  }

  // the comparables chart (D4 of the 13 Nov retest): rows of comparables the case does not have are left out
  // (default), print "Not available", or the whole chart is left out. A row typed full of "0" / "NA" / "Ok" only
  // to get past a pending item counts as empty.
  const comp = compPrint(data);
  out.COMP_PRINT = comp.mode;
  out.COMP_EMPTY = comp.empty;
  const keepOne = comp.mode === 'filled' && comp.empty.length === COMP_ROWS ? 1 : 0;
  for (const n of comp.empty) {
    for (const part of COMP_PARTS) {
      const code = `EVID.COMP${n}.${part}`;
      if (!Object.hasOwn(out, code)) continue;
      out[code] = part === 'DESC' && (comp.mode === 'na' || n === keepOne) ? 'Not available' : '';
      snapshot[code] = out[code];
    }
  }

  // signature and seal: full at signing blocks, short on every page footer
  // cells and paragraphs that print several fields with fixed words between them
  for (const t of await versionTemplates(tplVersion, tx)) out[templateKey(t.key)] = fillTemplate(t.template, (c) => String(out[c] ?? ''));

  out.SIGNED = signed;
  out.SIGN_PENDING = mode === 'preview' ? `${M.start}REPORT.SIGNATURE${M.pend}Signature and seal placed at sign-off${M.end}` : mode === 'final_preview' ? 'Signature and seal are placed at sign-off' : '';
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
  out.IS_DRAFT = !signed && mode !== 'final_preview';
  out.DRAFT_LINE = `DRAFT v${data.case.draft_version} – not for submission`;

  // photos / documents / evidence per page: the format's own choice over the firm default (H3)
  const pl = await pageLayout(firmId, tplVersion, tx);
  out.ANNEX_PAGES = keepAnnexures(await annexPages(data, firmId, { ...settings, ...pl }, images, tx), pl.annex_off);
  snapshot.annex = (out.ANNEX_PAGES as any[]).map((p) => ({ title: p.title, images: [...JSON.stringify(p).matchAll(/"([a-z]_img)":"([^"]+)"/g)].length }));
  return { data: out, images, snapshot };
}

/** Pictures per annexure page, from Report layout (A10). The one place the per-page counts are read: a format's
 *  own layout, when it overrides the firm's, is merged here. */
export function annexLayout(settings: { doc_grid?: number; photo_grid?: number; evidence_per_page?: number; docs_at_end?: boolean }) {
  const photoPer = [4, 6, 9].includes(Number(settings.photo_grid)) ? Number(settings.photo_grid) : 9;
  const docPer = Number(settings.doc_grid) === 4 ? 4 : Number(settings.doc_grid) === 1 ? 1 : 9;
  return { photoPer, docPer, evidencePer: Number(settings.evidence_per_page) === 1 ? 1 : 2, docsAtEnd: settings.docs_at_end !== false };
}

// Picture sizes (px at 96 dpi) that fit an A4 page with the title, captions, header and footer: the grid is
// bordered and rows never split, so a box too tall would push a row to a page of its own.
const PHOTO_BOX: Record<number, [number, number]> = { 9: [205, 230], 6: [205, 330], 4: [310, 380] };
const DOC_BOX: Record<number, [number, number]> = { 9: [205, 240], 4: [310, 360], 1: [650, 760] };
const EVIDENCE_BOX: Record<number, [number, number]> = { 2: [620, 340], 1: [650, 760] };

async function annexPages(data: CaseData, firmId: number, settings: Parameters<typeof annexLayout>[0], images: Map<string, RenderImage>, tx: Tx) {
  const L = annexLayout(settings);
  const pages: any[] = [];
  let n = 0;
  const add = async (buf: Buffer, [w, h]: [number, number]) => { const k = `ax${n++}`; images.set(k, await fitImage(buf, w, h)); return k; };
  /** Pages of a bordered grid: `per` pictures a page, `cols` across, caption under each. */
  const gridPages = async (title: string, items: { buf: Buffer; cap: string }[], per: number, cols: number, box: [number, number], note = '') => {
    for (const [i, pg] of chunk(items, per).entries()) {
      const rows = [];
      for (const r of chunk(pg, cols)) {
        const row: Record<string, string> = {};
        for (const [j, x] of r.entries()) { const l = 'abc'[j]; row[`${l}_img`] = await add(x.buf, box); row[`${l}_cap`] = x.cap; }
        rows.push(row);
      }
      pages.push({ title: i ? `${title} (contd.)` : title, note: i ? '' : note, [`g${cols}`]: { rows } });
    }
  };

  // photographs: the firm's photos per page (9 = 3×3, 6 = 3×2, 4 = 2×2)
  const photos = await tx.selectFrom('site_photos').selectAll().where('assignment_id', '=', data.case.id).where('selected', '=', 1).orderBy('sort_order').orderBy('id').execute();
  const photoItems = [];
  for (const p of photos) photoItems.push({ buf: (await readFile(p.file_id, firmId, tx)).buffer, cap: p.caption ?? '' });
  await gridPages('PHOTOGRAPHS', photoItems, L.photoPer, L.photoPer === 4 ? 2 : 3, PHOTO_BOX[L.photoPer]);

  // captured evidence ticked for the report; the same picture uploaded twice (an Index II received with the
  // documents that was also captured on Market evidence) prints once (G3)
  const caps = await tx.selectFrom('evidence_captures as ec').innerJoin('files as f', 'f.id', 'ec.file_id')
    .select(['ec.id', 'ec.file_id', 'ec.source_kind', 'ec.source_name', 'ec.url', 'f.sha256'])
    .where('ec.assignment_id', '=', data.case.id).where('ec.in_report', '=', 1).where('ec.status', '=', 'read').orderBy('ec.id').execute();
  const sameAs = new Map<number, number>();
  const firstBySha = new Map<string, number>();
  for (const c of caps) { const f = firstBySha.get(c.sha256); if (f) sameAs.set(c.id, f); else firstBySha.set(c.sha256, c.id); }
  // the comparables each capture gave (a sale instance is captioned with its building and registration date)
  const linked = await tx.selectFrom('case_comparables as cc').innerJoin('comparables as cp', 'cp.id', 'cc.comparable_id')
    .select(['cc.capture_id', 'cp.building', 'cp.society', 'cp.locality', 'cp.txn_date', 'cp.price', 'cp.source_type'])
    .where('cc.assignment_id', '=', data.case.id).where('cc.capture_id', 'is not', null).orderBy('cc.id').execute();
  // a capture's own comparables, else those of the copy it duplicates
  const compsOf = (id: number) => {
    const own = linked.filter((x) => x.capture_id === id);
    return own.length ? own : linked.filter((x) => x.capture_id !== null && sameAs.get(x.capture_id) === id);
  };
  const pictures = async (c: (typeof caps)[number]) => {
    const { file, buffer } = await readFile(c.file_id, firmId, tx);
    return file.mime === 'application/pdf' ? await pdfToImages(buffer, { dpi: 110, first: 1, last: 2 }) : [buffer];
  };
  const SALE_KINDS = ['igr', 'proptrace', 'other'];
  let sale = 0;
  const caption = (c: (typeof caps)[number]) => {
    if (c.source_kind === 'map') return 'Location map (screenshot)';
    if (SALE_KINDS.includes(c.source_kind)) {
      const comps = compsOf(c.id);
      const src = c.source_kind === 'proptrace' ? 'Index II (PropTrace)' : c.source_kind === 'igr' ? 'Index II' : c.source_name || 'Sale transaction';
      if (comps.length > 1) { const from = sale + 1; sale += comps.length; return `Sale instances ${from}–${sale}: ${src}`; }
      const x = comps[0];
      const where = x ? [x.building, x.society].filter(Boolean)[0] ?? x.locality : null;
      return `Sale instance ${++sale}: ${src}${where ? `, ${where}` : ''}${x?.txn_date ? `, registered ${ddmmyyyy(x.txn_date)}` : ''}${x?.price ? `, Rs. ${inr(Number(x.price))}/-` : ''}`;
    }
    if (c.source_kind === 'listing') return `Property listing${c.source_name ? `: ${c.source_name}` : ''}${c.url ? ` · ${c.url}` : ''}`;
    return `${c.source_name || 'Ready reckoner'}${c.url ? ` · ${c.url}` : ''}`;
  };
  // a page uploaded as "Other" counts as what its comparables are (a listing read from a Square Yards page)
  const kindOf = (x: { id: number; source_kind: string }) => {
    if (x.source_kind !== 'other') return x.source_kind;
    const t = linked.find((l) => l.capture_id === x.id)?.source_type;
    return t === 'listing' ? 'listing' : t === 'index2' || t === 'igr_search' ? 'igr' : 'other';
  };
  const captured = async (kinds: string[]) => {
    const imgs: { buf: Buffer; cap: string }[] = [];
    for (const c of caps.filter((x) => kinds.includes(kindOf(x)) && !sameAs.has(x.id))) {
      const cap = caption(c);
      for (const b of await pictures(c)) imgs.push({ buf: b, cap });
    }
    return imgs;
  };
  const evPer = L.evidencePer;
  const evBox = EVIDENCE_BOX[evPer];

  // map: generated from the photos' GPS position, plus captured map screenshots and those among the site photos
  const lat = Number(data.value('PROP.LAT'));
  const lng = Number(data.value('PROP.LNG'));
  const latlng = lat && lng ? `Latitude/Longitude: ${data.get('PROP.LATLNG_TEXT').display ?? ''}` : '';
  const maps: { buf: Buffer; cap: string }[] = [];
  let mapNote = latlng;
  if (lat && lng) {
    try {
      for (const m of await mapImages(firmId, lat, lng)) maps.push({ buf: m.buffer, cap: m.label === 'Map' ? 'Location map' : m.label });
    } catch { mapNote = `${latlng} (map image unavailable)`; }
  }
  maps.push(...(await captured(['map'])));
  const mapPhotos = await tx.selectFrom('site_photos').select(['file_id']).where('assignment_id', '=', data.case.id).where('is_map', '=', 1).where('duplicate_of', 'is', null).orderBy('id').execute();
  for (const m of mapPhotos) maps.push({ buf: (await readFile(m.file_id, firmId, tx)).buffer, cap: 'Location map (screenshot from the site visit)' });
  if (maps.length) await gridPages('LOCATION MAP', maps, evPer, 1, evBox, mapNote);
  else if (mapNote) pages.push({ title: 'LOCATION MAP', note: mapNote });

  // ready reckoner: printed only when a page was captured (the looked-up rate is in the report body)
  const rr = data.get('VAL.RR_RATE_SQM');
  const rrImgs = await captured(['rr']);
  if (rrImgs.length) {
    const note = rr.state === 'filled' ? `Rate: Rs. ${inr(Number(rr.value))}/- per sq.m. (Rs. ${inr(Number(data.value('VAL.RR_RATE_SQFT')))}/- per sq.ft.). ${rr.snippet ?? ''}` : '';
    await gridPages(`STAMP DUTY READY RECKONER${data.value('VAL.RR_YEAR') ? ` FOR YEAR ${data.value('VAL.RR_YEAR')}` : ''}`, rrImgs, evPer, 1, evBox, note);
  }

  // market evidence (D3): sale transactions and property listings both print; the one the case lacks says so
  for (const [title, kinds] of [['SALE TRANSACTIONS', SALE_KINDS], ['PROPERTY LISTING', ['listing']]] as const) {
    const imgs = await captured([...kinds]);
    if (imgs.length) await gridPages(title, imgs, evPer, 1, evBox);
    else pages.push({ title, note: 'Not available' });
  }

  // document pages, grid per firm setting (9 = 3×3, 4 = 2×2, 1 = full page)
  if (!L.docsAtEnd) return pages;
  const parts = await tx.selectFrom('document_parts').selectAll().where('assignment_id', '=', data.case.id).where('excluded', '=', 0).orderBy('document_id').orderBy('page_from').execute();
  const docImgs: { fileId: number; cap: string }[] = [];
  const dt = await activeConfig<{ types: { key: string; label: string; in_report?: boolean }[] }>('doc_types', 'default', firmId);
  const typeLabel = new Map((dt?.payload.types ?? []).map((t) => [t.key, t.label]));
  // a comparable's Index II belongs under Sale transactions only, never among the property's documents
  const notPrinted = new Set(['index2_comp', 'other', 'kyc', 'site_photo']);
  for (const p of parts) {
    if (notPrinted.has(p.corrected_type ?? p.detected_type)) continue;
    const want = json<number[]>(p.in_report_pages, []);
    if (!want.length) continue;
    const pg = await tx.selectFrom('document_pages').select(['page_no', 'image_file_id']).where('document_id', '=', p.document_id).where('page_no', 'in', want).orderBy('page_no').execute();
    for (const x of pg) if (x.image_file_id) docImgs.push({ fileId: x.image_file_id, cap: `${p.corrected_type ? typeLabel.get(p.corrected_type) ?? p.corrected_type : p.title ?? p.detected_type}${pg.length > 1 ? `, p. ${x.page_no}` : ''}` });
  }
  // portrait pages in the firm's grid; landscape pages (plans, wide scans) 2 a page at full width
  const cols = L.docPer === 9 ? 3 : L.docPer === 4 ? 2 : 1;
  const portrait: { buf: Buffer; cap: string }[] = [];
  const landscape: { buf: Buffer; cap: string }[] = [];
  for (const d of docImgs) {
    const buf = (await readFile(d.fileId, firmId, tx)).buffer;
    const m = await sharp(buf, { failOn: 'none' }).metadata();
    const w = m.autoOrient?.width ?? m.width ?? 1;
    const h = m.autoOrient?.height ?? m.height ?? 1;
    (w > h * 1.1 ? landscape : portrait).push({ buf, cap: d.cap });
  }
  const before = pages.length;
  await gridPages('DOCUMENTS', portrait, L.docPer, cols, DOC_BOX[L.docPer]);
  await gridPages('DOCUMENTS', landscape, 2, 1, EVIDENCE_BOX[2]);
  // one run of "DOCUMENTS", then "(contd.)"
  pages.slice(before).forEach((p, i) => { p.title = i ? 'DOCUMENTS (contd.)' : 'DOCUMENTS'; });
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
