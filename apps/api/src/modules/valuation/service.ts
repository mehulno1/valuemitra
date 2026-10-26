// Market evidence and valuation for a case: ready reckoner lookup, assisted capture of IGR /
// listing pages, the firm's comparables, the evidence-backed proposal, applying a valuation with
// the working shown, and value history.
import sharp from 'sharp';
import { z } from 'zod';
import { imageBlock, structured, textBlock } from '../../ai/claude.js';
import { ocrImages } from '../../ai/vision.js';
import { db, json, toJson, type Tx } from '../../db/index.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { pdfToImages } from '../../lib/pdf.js';
import { audit, systemActor, type Actor } from '../../platform/audit.js';
import { publish } from '../../platform/events.js';
import { enqueue, registerJob } from '../../platform/jobs.js';
import { readFile, saveFile } from '../../platform/storage.js';
import { DOCS, requireKind } from '../../lib/sniff.js';
import { mapCoords, parseLatLng } from '../../lib/coords.js';
import { getSettings, setSettings } from '../../platform/settings.js';
import { inr } from '@vm/shared';
import { caseData, type CaseData } from '../casedata/resolver.js';
import { writeCandidates } from '../casedata/values.js';
import { assertCase } from '../documents/service.js';
import { adjustComparable, computeValues, flagOutliers, floorNo, propose, toBua, type Adjustment, type Extra } from './engine.js';

const RR_CATEGORY: Record<string, string> = { flat: 'residential', bungalow: 'residential', shop: 'shop', office: 'office', open_land: 'open_land' };
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9ऀ-ॿ]/g, '');

/** Ready reckoner rate by village (any spelling) and category for the report's financial year. */
export async function lookupReadyReckoner(assignmentId: number, firmId: number) {
  const data = await caseData(assignmentId, firmId);
  const village = data.value('PROP.VILLAGE');
  if (!village) return null;
  const d = new Date(String(data.value('CASE.REPORT_DATE')));
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  const year = `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
  const cat = RR_CATEGORY[data.case.property_type] ?? 'residential';
  const rows = await db.selectFrom('ready_reckoner_rates').selectAll()
    .where((eb) => eb.or([eb('firm_id', 'is', null), eb('firm_id', '=', firmId)]))
    .where('category', '=', cat).orderBy('year_label', 'desc').execute();
  const v = norm(village);
  const district = norm(data.value('PROP.DISTRICT'));
  const hit = rows
    .filter((r) => [r.village, ...(r.village_alt ?? '').split(',')].some((x) => norm(x) && (norm(x) === v || v.includes(norm(x)) || norm(x).includes(v))))
    .sort((a, b) => (a.year_label === year ? -1 : 0) - (b.year_label === year ? -1 : 0) || (norm(b.district) === district ? 1 : 0) - (norm(a.district) === district ? 1 : 0))[0];
  if (!hit) return null;
  const snippet = `Ready reckoner ${hit.year_label}: Village ${hit.village}, ${hit.district}${hit.zone ? `, zone ${hit.zone}` : ''}, ${hit.category}: Rs. ${hit.rate_per_sqm}/sq.m.`;
  await writeCandidates(assignmentId, firmId, [
    { fieldCode: 'VAL.RR_RATE_SQM', value: hit.rate_per_sqm, sourceType: 'evidence', snippet, confidence: hit.year_label === year ? 99 : 80 },
    { fieldCode: 'VAL.RR_YEAR', value: hit.year_label, sourceType: 'evidence', snippet, confidence: 99 },
  ]);
  return { ...hit, matchedYear: hit.year_label === year };
}

export type CaptureKind = 'igr' | 'listing' | 'other' | 'rr' | 'map';
const CAPTURE_LABEL: Record<CaptureKind, string> = { igr: 'IGR search', listing: 'listing', other: 'evidence', rr: 'ready reckoner', map: 'location map' };
/** Pages that print as they are (ready reckoner, location map); the rest are read into comparables. */
const PRINT_ONLY = new Set<CaptureKind>(['rr', 'map']);

export async function captureEvidence(actor: Actor, assignmentId: number, files: { name: string; mime: string; buffer: Buffer }[], kind: CaptureKind, sourceName: string | null, url: string | null) {
  const a = await assertCase(actor.firmId!, assignmentId);
  const ids: number[] = [];
  const printOnly = PRINT_ONLY.has(kind);
  for (const f of files) {
    const mime = requireKind(f.buffer, DOCS, f.name);
    const stored = await saveFile({ firmId: a.firm_id, purpose: 'evidence', folder: `a${a.id}/evidence`, buffer: f.buffer, name: f.name, mime, userId: actor.id });
    const r = await db.insertInto('evidence_captures').values({ assignment_id: a.id, file_id: stored.id, source_kind: kind, source_name: sourceName, url, captured_by: actor.id ?? null, status: printOnly ? 'read' : 'uploaded' }).executeTakeFirstOrThrow();
    ids.push(Number(r.insertId));
    if (!printOnly) await enqueue('evidence.read', { captureId: Number(r.insertId) }, { firmId: a.firm_id });
  }
  await audit(actor, { entityType: 'evidence', assignmentId, action: 'evidence.capture', summary: `Captured ${files.length} ${CAPTURE_LABEL[kind]} page(s)${sourceName ? ` from ${sourceName}` : ''}.${printOnly ? ' Printed in the report as captured.' : ' Reading entries.'}` });
  return ids;
}

/** Tick or untick a captured page for printing in the report. */
export async function setCaptureInReport(actor: Actor, assignmentId: number, captureId: number, inReport: boolean) {
  const a = await assertCase(actor.firmId!, assignmentId);
  if (a.signed_at) throw badRequest('The report is signed and locked. Reopen it to make changes.');
  const c = await db.selectFrom('evidence_captures').select(['id', 'source_kind', 'source_name']).where('id', '=', captureId).where('assignment_id', '=', a.id).executeTakeFirst();
  if (!c) throw notFound('Captured page');
  await db.updateTable('evidence_captures').set({ in_report: inReport ? 1 : 0 }).where('id', '=', c.id).execute();
  await audit(actor, { entityType: 'evidence', entityId: c.id, assignmentId: a.id, action: 'evidence.in_report', summary: `${CAPTURE_LABEL[c.source_kind]} page${c.source_name ? ` (${c.source_name})` : ''} ${inReport ? 'added to' : 'removed from'} the report.` });
}

const EntrySchema = z.object({
  entries: z.array(z.object({
    kind: z.enum(['registered_sale', 'listing']),
    description: z.string().describe('e.g. "1 BHK, G+7 building with lift"'),
    building: z.string().nullable(), society: z.string().nullable(), locality: z.string().nullable(), village: z.string().nullable(),
    reference: z.string().nullable().describe('Index II / document no., or listing id'),
    date: z.string().nullable().describe('Registration date, or the listing posted date if shown, as YYYY-MM-DD'),
    area_sqft: z.number().describe('Area in sq.ft. as stated (convert sq.m. × 10.764). When the page gives carpet area as well as built-up / super area, give the carpet area'),
    area_basis: z.enum(['bua', 'carpet', 'saleable']).describe('What the stated area is: "Super built-up", "Super area" and "Saleable" are saleable; "Built-up" / "Plinth" is bua; "Carpet" is carpet'),
    price: z.number().describe('Price / consideration in rupees'),
    floor: z.number().int().nullable(), total_floors: z.number().int().nullable(), has_lift: z.boolean().nullable(), building_age: z.number().int().nullable(), bhk: z.string().nullable(),
  })),
  map: z.object({
    is_map: z.boolean().describe('The pages are a screenshot of a map app showing a location pin'),
    coords_text: z.string().nullable().describe('Coordinates exactly as written on the screen (search box, pin card), e.g. 19°11\'29.2"N 73°10\'43.6"E'),
    lat: z.number().nullable().describe('Latitude of the pin when written on the screen (decimal degrees)'),
    lng: z.number().nullable().describe('Longitude of the pin when written on the screen (decimal degrees)'),
  }),
});

async function readCapture(captureId: number) {
  const c = await db.selectFrom('evidence_captures').selectAll().where('id', '=', captureId).executeTakeFirstOrThrow();
  const a = await db.selectFrom('assignments').select(['id', 'firm_id', 'property_type']).where('id', '=', c.assignment_id).executeTakeFirstOrThrow();
  await db.updateTable('evidence_captures').set({ status: 'reading', error: null }).where('id', '=', captureId).execute();
  const { file, buffer } = await readFile(c.file_id, a.firm_id);
  const images = file.mime === 'application/pdf' ? (await pdfToImages(buffer, { dpi: 130 })).slice(0, 8) : [await sharp(buffer).rotate().jpeg({ quality: 85 }).toBuffer()];
  const small = await Promise.all(images.map((i) => sharp(i).resize({ width: 1400, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()));
  const ocr = await ocrImages(small);
  const content = small.flatMap((img, i) => [textBlock(`Captured page ${i + 1}:`), imageBlock(img), textBlock(`OCR of page ${i + 1}:\n${ocr[i]?.text.slice(0, 4000) ?? ''}`)]);
  content.push(textBlock('List every property entry on these pages: registered sales (IGR / Index II search results) and property listings. Skip ads and unrelated entries. If the pages are a map screenshot showing a location pin, say so and read the coordinates when they are written on the screen.'));
  const r = await structured({ system: 'You read captured pages of Indian property registration searches (IGR Maharashtra) and listing sites (99acres, MagicBricks, Housing) for a valuer collecting comparable evidence.', content, schema: EntrySchema, effort: 'medium' });
  const rules = (await caseData(a.id, a.firm_id)).rules;
  let n = 0;
  for (const e of r.data.entries) {
    if (!(e.area_sqft > 0 && e.price > 0)) continue;
    const bua = toBua(e.area_sqft, e.area_basis, rules);
    const comp = await db.insertInto('comparables').values({
      firm_id: a.firm_id, scope: 'private', source_type: e.kind === 'listing' ? 'listing' : c.source_kind === 'igr' ? 'igr_search' : 'index2',
      source_ref: e.reference ?? c.source_name, property_type: a.property_type, building: e.building, society: e.society, locality: e.locality, village: e.village,
      txn_date: e.date ? new Date(e.date) : e.kind === 'listing' ? new Date() : null, is_asking_price: e.kind === 'listing' ? 1 : 0,
      area_value: e.area_sqft, area_basis: e.area_basis, area_bua_sqft: Math.round(bua), price: e.price, rate_per_sqft: Math.round(e.price / bua),
      floor_no: e.floor, total_floors: e.total_floors, has_lift: e.has_lift === null ? null : e.has_lift ? 1 : 0, building_age: e.building_age, bhk: e.bhk,
      notes: `${e.description}${e.area_basis !== 'bua' ? ` · ${e.area_basis} ${e.area_sqft} → built-up ${Math.round(bua)}` : ''}${e.kind === 'listing' ? ' · listing date is the capture date unless shown' : ''}`,
      file_id: c.file_id, origin_assignment_id: a.id,
    }).executeTakeFirstOrThrow();
    await db.insertInto('case_comparables').values({ assignment_id: a.id, comparable_id: Number(comp.insertId), capture_id: captureId, adjustments: toJson([]), adjusted_rate: 0, weight: 0, weight_label: 'Low' }).execute();
    n++;
  }
  // a map screenshot dropped with the evidence: it prints on the location map page and gives the coordinates
  const m = r.data.map;
  const isMap = m.is_map && n === 0;
  const pos = m.is_map ? mapCoords(m.coords_text, m.lat, m.lng) ?? parseLatLng(ocr.map((o) => o.text).join('\n')) : null;
  if (pos) {
    await writeCandidates(a.id, a.firm_id, [
      { fieldCode: 'PROP.LAT', value: pos.lat.toFixed(6), sourceType: 'evidence', snippet: `Read from the map screenshot${c.source_name ? ` (${c.source_name})` : ''}`, confidence: 85 },
      { fieldCode: 'PROP.LNG', value: pos.lng.toFixed(6), sourceType: 'evidence', snippet: `Read from the map screenshot${c.source_name ? ` (${c.source_name})` : ''}`, confidence: 85 },
    ]);
  }
  await db.updateTable('evidence_captures').set({ status: 'read', ...(isMap ? { source_kind: 'map' as const, in_report: 1 } : {}) }).where('id', '=', captureId).execute();
  await refreshEvidence(a.id, a.firm_id);
  await audit(systemActor(a.firm_id), { entityType: 'evidence', entityId: captureId, assignmentId: a.id, action: 'evidence.read', summary: isMap ? `Location map recognised in the captured page${pos ? `; pin at ${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}` : ''}. Printed on the location map page.` : `${n} comparable(s) read from the captured page.` });
  await publish({ type: 'evidence.read', firmId: a.firm_id, entityType: 'assignment', entityId: a.id, payload: { captureId } });
}

/** Make sure the subject's own registration and nearby firm comparables are in the set, then recompute. */
export async function refreshEvidence(assignmentId: number, firmId: number, tx: Tx = db) {
  const data = await caseData(assignmentId, firmId, tx);
  const area = Number(data.value('AREA.BUA'));
  const consideration = Number(data.value('REG.CONSIDERATION'));
  // the property's own registration is strong evidence
  const subjectRow = await tx.selectFrom('case_comparables').select(['id', 'comparable_id']).where('assignment_id', '=', assignmentId).where('is_subject', '=', 1).executeTakeFirst();
  if (area > 0 && consideration > 0) {
    const vals = {
      firm_id: firmId, scope: 'private' as const, source_type: 'index2' as const, source_ref: `Index II ${data.value('DOC.INDEX2.NUMBER') ?? ''} · this property`.trim(), property_type: data.case.property_type,
      building: (data.value('PROP.BUILDING') as string) ?? null, society: (data.value('PROP.SOCIETY') as string) ?? null, village: (data.value('PROP.VILLAGE') as string) ?? null,
      txn_date: data.value('DOC.INDEX2.DATE') ? new Date(String(data.value('DOC.INDEX2.DATE'))) : null, is_asking_price: 0, area_value: area, area_basis: 'bua' as const,
      area_bua_sqft: area, price: consideration, rate_per_sqft: Math.round(consideration / area), notes: 'This property, registered sale', origin_assignment_id: assignmentId,
    };
    if (subjectRow) await tx.updateTable('comparables').set(vals).where('id', '=', subjectRow.comparable_id).execute();
    else {
      const c = await tx.insertInto('comparables').values(vals).executeTakeFirstOrThrow();
      await tx.insertInto('case_comparables').values({ assignment_id: assignmentId, comparable_id: Number(c.insertId), is_subject: 1, adjustments: toJson([]), adjusted_rate: 0, weight: 0, weight_label: 'High' }).execute();
    }
  }
  // firm's earlier signed reports in the same village / society within the window (learning loop: every signed report is evidence)
  const village = data.value('PROP.VILLAGE');
  if (village) {
    const since = new Date(Date.now() - data.rules.comparable_window_months * 2 * 30.4 * 86400_000);
    const own = await tx.selectFrom('comparables').select(['id', 'village', 'society'])
      .where('firm_id', '=', firmId).where('source_type', '=', 'own_report').where('property_type', '=', data.case.property_type)
      .where('txn_date', '>=', since).where('origin_assignment_id', '!=', assignmentId).execute();
    const have = new Set((await tx.selectFrom('case_comparables').select('comparable_id').where('assignment_id', '=', assignmentId).execute()).map((x) => x.comparable_id));
    for (const o of own) {
      if (have.has(o.id) || norm(o.village) !== norm(village)) continue;
      await tx.insertInto('case_comparables').values({ assignment_id: assignmentId, comparable_id: o.id, adjustments: toJson([]), adjusted_rate: 0, weight: 0, weight_label: 'Low', note: 'Earlier report of this firm' }).execute();
    }
  }
  return recomputeProposal(assignmentId, firmId, data, tx);
}

export async function recomputeProposal(assignmentId: number, firmId: number, data?: CaseData, tx: Tx = db) {
  data ??= await caseData(assignmentId, firmId, tx);
  const area = Number(data.value('AREA.BUA'));
  if (!(area > 0)) return null;
  const rows = await tx.selectFrom('case_comparables as cc').innerJoin('comparables as c', 'c.id', 'cc.comparable_id').selectAll('c').select(['cc.id as cc_id', 'cc.is_subject', 'cc.manual_override', 'cc.adjustments as cc_adj', 'cc.weight as cc_weight', 'cc.included as cc_included', 'cc.note'])
    .where('cc.assignment_id', '=', assignmentId).execute();
  const subject = { area, hasLift: data.value('PHYS.LIFT') === 'Yes' ? true : data.value('PHYS.LIFT') === 'No' ? false : null, buildingAge: (data.value('PHYS.AGE') as number) ?? null, valuationDate: new Date(String(data.value('CASE.REPORT_DATE'))), floor: floorNo(data.value('PHYS.FLOOR')) };
  const raw = rows.map((r) => {
    const o = adjustComparable({
      id: r.cc_id, isSubject: !!r.is_subject, sourceType: r.source_type, isAsking: !!r.is_asking_price, areaBua: Number(r.area_bua_sqft), price: Number(r.price),
      txnDate: r.txn_date, hasLift: r.has_lift === null ? null : !!r.has_lift, buildingAge: r.building_age, distanceKm: null, floor: r.floor_no,
      override: r.manual_override ? { adjustments: json<Adjustment[]>(r.cc_adj, []), weight: Number(r.cc_weight), included: !!r.cc_included } : null,
    }, subject, data!.rules);
    return { ...o, sourceType: r.source_type, isSubject: !!r.is_subject };
  });
  const out = flagOutliers(raw, data.rules);
  for (const o of out) {
    await tx.updateTable('case_comparables').set({
      adjustments: toJson(o.adjustments), adjusted_rate: Math.round(o.adjustedRate), weight: Math.round(o.weight * 1000) / 1000, weight_label: o.weightLabel,
      included: o.included ? 1 : 0, exclusion_reason: o.exclusionReason, age_months: o.ageMonths === null ? null : Math.round(o.ageMonths * 10) / 10,
    }).where('id', '=', o.id).execute();
  }
  const p = propose(out, data.rules);
  if (!p) {
    // no evidence left (e.g. only guidance items): drop an earlier proposal so no range prints
    await tx.updateTable('field_values').set({ is_current: 0, status: 'superseded' }).where('assignment_id', '=', assignmentId)
      .where('field_code', 'in', ['VAL.PROPOSED_RATE', 'VAL.RANGE_LO', 'VAL.RANGE_HI']).where('source_type', '=', 'evidence').where('is_current', '=', 1).execute();
    return null;
  }
  const snippet = `${p.n} comparable(s): weighted median of adjusted rates; range = weighted inter-quartile, at least ±3%`;
  await writeCandidates(assignmentId, firmId, [
    { fieldCode: 'VAL.PROPOSED_RATE', value: p.rate, sourceType: 'evidence', snippet, confidence: Math.min(95, 50 + p.n * 10) },
    { fieldCode: 'VAL.RANGE_LO', value: p.lo, sourceType: 'evidence', snippet, confidence: 90 },
    { fieldCode: 'VAL.RANGE_HI', value: p.hi, sourceType: 'evidence', snippet, confidence: 90 },
  ], tx);
  return p;
}

export async function evidence(firmId: number, assignmentId: number) {
  await assertCase(firmId, assignmentId);
  const data = await caseData(assignmentId, firmId);
  const rows = await db.selectFrom('case_comparables as cc').innerJoin('comparables as c', 'c.id', 'cc.comparable_id')
    .select(['cc.id', 'cc.is_subject', 'cc.adjustments', 'cc.adjusted_rate', 'cc.weight', 'cc.weight_label', 'cc.included', 'cc.exclusion_reason', 'cc.age_months', 'cc.note', 'cc.manual_override',
      'c.source_type', 'c.source_ref', 'c.building', 'c.society', 'c.locality', 'c.txn_date', 'c.is_asking_price', 'c.area_value', 'c.area_basis', 'c.area_bua_sqft', 'c.price', 'c.rate_per_sqft', 'c.notes', 'c.file_id', 'c.bhk'])
    .where('cc.assignment_id', '=', assignmentId).orderBy('cc.is_subject', 'desc').orderBy('cc.weight', 'desc').execute();
  const captures = await db.selectFrom('evidence_captures as ec').innerJoin('files as f', 'f.id', 'ec.file_id').selectAll('ec').select('f.mime').where('ec.assignment_id', '=', assignmentId).orderBy('ec.id').execute();
  const rr = data.get('VAL.RR_RATE_SQM');
  const view = await rateView(data, firmId);
  const step = data.rules.rate_rounding_step || 100;
  const p = data.get('VAL.PROPOSED_RATE').state === 'filled' ? { rate: Number(data.value('VAL.PROPOSED_RATE')), lo: Number(data.value('VAL.RANGE_LO')), hi: Number(data.value('VAL.RANGE_HI')) } : null;
  return {
    // rates are worked out per sq.ft. built-up; the valuer reads them on the area and unit the case quotes its rate on
    view: { ...view, proposal: p && view.factor ? { rate: Math.round((p.rate * view.factor) / step) * step, lo: Math.floor((p.lo * view.factor) / step) * step, hi: Math.ceil((p.hi * view.factor) / step) * step } : null },
    readyReckoner: rr.state === 'filled' ? { ratePerSqm: rr.value, ratePerSqft: data.value('VAL.RR_RATE_SQFT'), year: data.value('VAL.RR_YEAR'), source: rr.snippet } : null,
    guideline: data.value('REG.GUIDELINE_VALUE'), consideration: data.value('REG.CONSIDERATION'), area: data.value('AREA.BUA'), registrationDate: data.value('DOC.INDEX2.DATE'),
    proposal: data.get('VAL.PROPOSED_RATE').state === 'filled' ? { rate: data.value('VAL.PROPOSED_RATE'), lo: data.value('VAL.RANGE_LO'), hi: data.value('VAL.RANGE_HI') } : null,
    comparables: rows.map((r) => ({ ...r, adjustments: json(r.adjustments, []) })),
    captures,
    rules: { window: data.rules.comparable_window_months, radius: data.rules.comparable_radius_km, listingDiscount: data.rules.listing_discount_pct, outlierPct: data.rules.outlier_pct ?? 30, outlierAction: data.rules.outlier_action ?? 'flag', step },
  };
}

const AREA_WORD: Record<string, string> = { bua: 'built-up', carpet: 'carpet', saleable: 'saleable' };

export async function overrideComparable(actor: Actor, assignmentId: number, ccId: number, patch: { included?: boolean; weight?: number; adjustments?: Adjustment[]; reason?: string; area?: number; basis?: 'bua' | 'carpet' | 'saleable' }) {
  const a = await assertCase(actor.firmId!, assignmentId);
  if (a.signed_at) throw badRequest('The report is signed and locked. Reopen it to make changes.');
  const cc = await db.selectFrom('case_comparables').selectAll().where('id', '=', ccId).where('assignment_id', '=', assignmentId).executeTakeFirst();
  if (!cc) throw notFound('Comparable');
  // a misread area (e.g. a portal's "built-up" that is really super built-up) is corrected on the comparable itself
  if (patch.area !== undefined || patch.basis !== undefined) {
    const comp = await db.selectFrom('comparables').selectAll().where('id', '=', cc.comparable_id).executeTakeFirstOrThrow();
    if (cc.is_subject) throw badRequest("This property's own area comes from its documents; correct it on Extracted details.");
    if (comp.firm_id !== actor.firmId || comp.origin_assignment_id !== assignmentId) throw badRequest('This comparable was captured on another case; correct its area there.');
    const area = patch.area ?? Number(comp.area_value);
    const basis = patch.basis ?? comp.area_basis;
    if (basis === 'plot') throw badRequest('Choose carpet, built-up or saleable');
    const bua = toBua(area, basis, (await caseData(assignmentId, actor.firmId!)).rules);
    await db.updateTable('comparables').set({ area_value: area, area_basis: basis, area_bua_sqft: Math.round(bua), rate_per_sqft: Math.round(Number(comp.price) / bua) }).where('id', '=', comp.id).execute();
    await audit(actor, {
      entityType: 'comparable', entityId: ccId, assignmentId, action: 'evidence.area',
      summary: `Comparable area corrected: ${inr(Number(comp.area_value))} sq.ft. ${AREA_WORD[comp.area_basis] ?? comp.area_basis} → ${inr(area)} sq.ft. ${AREA_WORD[basis]}.`, reason: patch.reason ?? null,
      before: { area: comp.area_value, basis: comp.area_basis }, after: { area, basis },
    });
  }
  if (patch.included !== undefined || patch.weight !== undefined || patch.adjustments !== undefined) {
    await db.updateTable('case_comparables').set({
      manual_override: 1, included: patch.included === undefined ? cc.included : patch.included ? 1 : 0,
      weight: patch.weight ?? cc.weight, adjustments: patch.adjustments ? toJson(patch.adjustments) : toJson(cc.adjustments), note: patch.reason ?? cc.note,
    }).where('id', '=', ccId).execute();
    await audit(actor, { entityType: 'comparable', entityId: ccId, assignmentId, action: 'evidence.override', summary: `Comparable adjusted by hand${patch.included === false ? ' (excluded)' : ''}.`, reason: patch.reason ?? null, after: patch });
    await db.insertInto('feedback_events').values({ firm_id: actor.firmId!, assignment_id: assignmentId, kind: 'comparable.override', before_json: toJson({ included: cc.included, weight: cc.weight, adjustments: cc.adjustments }), after_json: toJson(patch), user_id: actor.id ?? null }).execute();
  }
  await recomputeProposal(assignmentId, actor.firmId!);
  await publish({ type: 'value.changed', firmId: actor.firmId, entityType: 'assignment', entityId: assignmentId, payload: { evidence: ccId } });
}

// ---- area basis and rate unit -------------------------------------------------------------------
export type Basis = 'carpet' | 'bua' | 'saleable' | 'measured' | 'plot';
export type RateUnit = 'sqft' | 'sqm';
export const SQM = 10.7639104;
const BASES: Record<Basis, { label: string; field: string }> = {
  carpet: { label: 'Carpet area', field: 'AREA.CARPET' },
  bua: { label: 'Built-up area', field: 'AREA.BUA' },
  saleable: { label: 'Saleable area', field: 'AREA.SALEABLE' },
  measured: { label: 'Carpet area as measured at site', field: 'AREA.MEASURED' },
  plot: { label: 'Plot / land area', field: 'AREA.PLOT' },
};
const UNIT_LABEL: Record<RateUnit, string> = { sqft: 'sq.ft.', sqm: 'sq.m.' };
const DOC_NAME: Record<string, string> = { agreement: 'agreement', index2: 'Index II', oc: 'O.C.', cc: 'C.C.', allotment: 'allotment letter' };
const isBasis = (x: unknown): x is Basis => typeof x === 'string' && Object.hasOwn(BASES, x);
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Every area the rate can be quoted on: stated in a document, worked out by the bank's rule, or measured at site. */
function areaOptions(data: CaseData) {
  return (Object.keys(BASES) as Basis[]).map((k) => {
    const r = data.get(BASES[k].field);
    let sqft = r.state === 'filled' ? Number(r.value) : null;
    let how: 'stated' | 'rule' | 'site' | 'none' = 'none';
    let src = r.state === 'not_applicable' && !r.notProvided ? `Not applicable for a ${data.case.property_type.replace(/_/g, ' ')}` : 'Not known';
    if (k === 'measured' && sqft) {
      // measured carpet plus balcony; a site measurement is never converted
      const balcony = Number(data.value('AREA.BALCONY')) || 0;
      src = `Measured · site sheet ${inr(sqft)}${balcony ? ` + balcony ${inr(balcony)}` : ''} (never converted)`;
      sqft += balcony;
      how = 'site';
    } else if (sqft && r.source === 'derived') {
      how = 'rule';
      src = `Worked out · ${r.formula ?? 'as per bank norms'}`;
    } else if (sqft) {
      how = 'stated';
      src = `Stated · ${r.edited ? 'entered by hand' : `${(r.sourceDocType ?? r.source ?? '').replace(/_/g, ' ')}${r.page ? ` p. ${r.page}` : ''}`}`;
      // carpet stated in parts (carpet + balconies as per RERA): show the working
      const parts = k === 'carpet' ? data.value('AREA.CARPET_PARTS') : null;
      if (parts) src += ` · ${parts}`;
    }
    return { key: k, label: BASES[k].label, sqft: sqft && sqft > 0 ? sqft : null, how, src };
  });
}

/** The area a derived figure was worked out from, for the report's note. */
function workedOutFrom(data: CaseData) {
  for (const k of ['carpet', 'bua', 'saleable'] as const) {
    const r = data.get(BASES[k].field);
    if (r.state === 'filled' && r.source !== 'derived') return BASES[k].label.toLowerCase();
  }
  return null;
}

/** Can this case choose its basis and unit? Only on a dictionary that has the fields for it. */
const choosesBasis = (data: CaseData) => !!data.fields.get('VAL.RATE_UNIT');

async function defaultBasis(data: CaseData, firmId: number): Promise<{ basis: Basis; unit: RateUnit; saved: boolean }> {
  const saved = (await getSettings(firmId)).area_basis_defaults?.[`${data.case.bank_code}:${data.case.property_type}`];
  if (saved && isBasis(saved.basis)) return { basis: saved.basis, unit: saved.unit === 'sqm' ? 'sqm' : 'sqft', saved: true };
  const p = data.profile.rate_basis;
  return { basis: isBasis(p) ? p : 'bua', unit: 'sqft', saved: false };
}

/** The area and unit the case quotes its rate on (the applied valuation, else the default), and the factor that turns a rate per sq.ft. built-up into it. */
async function rateView(data: CaseData, firmId: number) {
  const bua = Number(data.value('AREA.BUA')) || null;
  const flat = { basis: 'bua' as Basis, unit: 'sqft' as RateUnit, label: BASES.bua.label, unitLabel: UNIT_LABEL.sqft, factor: bua ? 1 : null };
  if (!choosesBasis(data)) return flat;
  const current = await db.selectFrom('valuations').select(['basis', 'rate_unit']).where('assignment_id', '=', data.case.id).where('is_current', '=', 1).executeTakeFirst();
  const def = await defaultBasis(data, firmId);
  const basis = current && isBasis(current.basis) ? current.basis : def.basis;
  const unit: RateUnit = current ? (current.rate_unit === 'sqm' ? 'sqm' : 'sqft') : def.unit;
  const sqft = areaOptions(data).find((o) => o.key === basis)?.sqft;
  if (!bua || !sqft) return flat;
  return { basis, unit, label: BASES[basis].label, unitLabel: UNIT_LABEL[unit], factor: bua / (unit === 'sqm' ? sqft / SQM : sqft) };
}

/** The valuer applies a rate on the chosen area and unit; values are computed by the profile's method and the bank's rules. */
export async function applyValuation(actor: Actor, assignmentId: number, input: { rate: number; reason?: string | null; extras?: Extra[]; landRate?: number | null; basis?: Basis; unit?: RateUnit; saveDefault?: boolean }) {
  const a = await assertCase(actor.firmId!, assignmentId);
  if (a.signed_at) throw badRequest('The report is signed and locked. Reopen it to make changes.');
  if (!(input.rate > 0)) throw badRequest('Enter the rate adopted, for example 12800');
  return db.transaction().execute(async (tx) => {
    const data = await caseData(assignmentId, actor.firmId!, tx);
    const method = data.profile.valuation_method ?? 'market_comparison';
    const def = await defaultBasis(data, actor.firmId!);
    const chooses = choosesBasis(data);
    const basis: Basis = chooses && input.basis ? input.basis : def.basis;
    const unit: RateUnit = chooses && input.unit ? input.unit : 'sqft';
    if (!isBasis(basis)) throw badRequest('Choose the area the rate is quoted on');
    const opt = areaOptions(data).find((o) => o.key === basis)!;
    if (!opt.sqft) throw badRequest(`The ${opt.label.toLowerCase()} is not known yet`);
    const basisArea = unit === 'sqm' ? round2(opt.sqft / SQM) : opt.sqft;
    const ul = UNIT_LABEL[unit];
    const bua = Number(data.value('AREA.BUA')) || null;
    const v = computeValues({ method, basisArea, rate: input.rate, unitLabel: ul, extras: input.extras ?? [], bua, plotArea: Number(data.value('AREA.PLOT')) || null, landRate: input.landRate ?? null, buildingAge: (data.value('PHYS.AGE') as number) ?? null }, data.rules);
    const rateBua = bua && method === 'market_comparison' ? Math.round((basisArea * input.rate) / bua) : null;
    const from = opt.how === 'rule' ? workedOutFrom(data) : null;
    const r0 = data.get(BASES[basis].field);
    const note = opt.how === 'rule' ? `(worked out from the ${from ?? 'stated area'} as per bank norms)`
      : opt.how === 'stated' && !r0.edited && r0.sourceDocType ? `as per ${DOC_NAME[r0.sourceDocType] ?? r0.sourceDocType.replace(/_/g, ' ')}` : null;
    const areaText = `${unit === 'sqm' ? basisArea.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : inr(basisArea)} ${ul} (${opt.label.toLowerCase()})`;
    const proposed = Number(data.value('VAL.PROPOSED_RATE')) || null;
    const asg = await tx.selectFrom('assignments').select(['draft_version']).where('id', '=', assignmentId).executeTakeFirstOrThrow();
    const draft = asg.draft_version + 1;
    await tx.updateTable('valuations').set({ is_current: 0 }).where('assignment_id', '=', assignmentId).execute();
    await tx.insertInto('valuations').values({
      assignment_id: assignmentId, method, basis, rate_unit: unit, basis_area: basisArea, proposed_rate: proposed,
      proposed_lo: Number(data.value('VAL.RANGE_LO')) || null, proposed_hi: Number(data.value('VAL.RANGE_HI')) || null,
      adopted_rate: input.rate, reason: input.reason ?? null, extras_json: toJson(input.extras ?? []), values_json: toJson(v),
      rule_version_id: data.case.rule_version_id!, draft_version: draft, created_by: actor.id!,
    }).execute();
    await tx.updateTable('assignments').set({ draft_version: draft }).where('id', '=', assignmentId).execute();
    const snippet = v.lines.map((l) => `${l.label}: ${l.working}`).join('; ');
    // valuation outputs replace earlier ones
    await tx.updateTable('field_values').set({ is_current: 0, status: 'superseded' }).where('assignment_id', '=', assignmentId).where('source_type', '=', 'valuation').where('is_current', '=', 1).execute();
    await writeCandidates(assignmentId, actor.firmId!, [
      { fieldCode: 'VAL.RATE', value: input.rate, sourceType: 'valuation', snippet: proposed ? `Evidence-backed rate Rs. ${proposed} per sq.ft. built-up${bua && basis !== 'bua' ? ` (Rs. ${inr(Math.round((proposed * bua) / basisArea))} per ${ul} ${opt.label.toLowerCase()})` : ''}` : null },
      { fieldCode: 'VAL.RATE_UNIT', value: unit, sourceType: 'valuation' },
      { fieldCode: 'VAL.RATE_TEXT', value: `Rs. ${inr(input.rate)}/- per ${ul}`, sourceType: 'valuation' },
      { fieldCode: 'VAL.RATE_BUA', value: rateBua, sourceType: 'valuation', snippet: rateBua ? `${basisArea} ${ul} × Rs. ${input.rate} ÷ built-up ${bua} sq.ft.` : null },
      // turns the evidence (per sq.ft. built-up) into the chosen area and unit, so the printed range matches the rate
      { fieldCode: 'VAL.BASIS_FACTOR', value: bua && method === 'market_comparison' ? Math.round((bua / basisArea) * 1e6) / 1e6 : null, sourceType: 'valuation', snippet: bua ? `built-up ${bua} sq.ft. ÷ ${basisArea} ${ul} ${opt.label.toLowerCase()}` : null },
      { fieldCode: 'VAL.RATE_REASON', value: input.reason ?? null, sourceType: 'valuation' },
      { fieldCode: 'VAL.BASIS_AREA', value: basisArea, sourceType: 'valuation', snippet: `${opt.label}: ${opt.src}` },
      { fieldCode: 'VAL.BASIS_LABEL', value: opt.label, sourceType: 'valuation' },
      { fieldCode: 'VAL.BASIS_NOTE', value: note, sourceType: 'valuation' },
      { fieldCode: 'VAL.AREA_TEXT', value: areaText, sourceType: 'valuation' },
      { fieldCode: 'VAL.UNIT_VALUE', value: v.unit, sourceType: 'valuation', snippet },
      { fieldCode: 'VAL.PARKING', value: v.parking, sourceType: 'valuation' },
      { fieldCode: 'VAL.INTERIOR', value: v.interior, sourceType: 'valuation' },
      { fieldCode: 'VAL.OTHERS', value: v.others, sourceType: 'valuation' },
      { fieldCode: 'VAL.FMV', value: v.fmv, sourceType: 'valuation', snippet },
      { fieldCode: 'VAL.REALIZABLE', value: v.realizable, sourceType: 'valuation', snippet: `${data.rules.realizable_pct}% of FMV (${data.case.bank_code} rule)` },
      { fieldCode: 'VAL.DISTRESS', value: v.distress, sourceType: 'valuation', snippet: `${data.rules.distress_pct}% of FMV` },
      { fieldCode: 'VAL.INSURABLE', value: v.insurable, sourceType: 'valuation', snippet: `Building cost Rs. ${data.rules.building_cost_per_sqft}/sq.ft. × BUA` },
      { fieldCode: 'VAL.RENT', value: v.rent, sourceType: 'valuation', snippet: `${data.rules.rental_yield_pct}% a year on FMV, nearest Rs. ${data.rules.rent_rounding_step}` },
    ].filter((x) => x.value !== null && x.value !== undefined) as any, tx);
    // the evidence is per sq.ft. built-up: compare like with like
    const compared = rateBua ?? input.rate;
    if (proposed && Math.abs(compared - proposed) / proposed > 0.001) {
      await tx.insertInto('feedback_events').values({
        firm_id: actor.firmId!, assignment_id: assignmentId, kind: 'rate.override', field_code: 'VAL.RATE', property_type: data.case.property_type,
        locality: (data.value('PROP.VILLAGE') as string) ?? null, before_json: toJson({ proposed, lo: data.value('VAL.RANGE_LO'), hi: data.value('VAL.RANGE_HI') }),
        after_json: toJson({ adopted: input.rate, basis, unit, per_sqft_bua: rateBua }), context_json: toJson({ reason: input.reason ?? null }), user_id: actor.id ?? null,
      }).execute();
    }
    if (input.saveDefault && chooses) {
      const key = `${data.case.bank_code}:${data.case.property_type}`;
      const cur = (await getSettings(actor.firmId!, tx)).area_basis_defaults ?? {};
      await setSettings(actor.firmId!, { area_basis_defaults: { ...cur, [key]: { basis, unit } } }, actor.id ?? null, tx);
      await audit(actor, { entityType: 'firm', entityId: actor.firmId!, action: 'settings.area_basis', summary: `${data.case.bank_code} ${data.case.property_type.replace(/_/g, ' ')}s: rate quoted per ${ul} of ${opt.label.toLowerCase()} by default` }, tx);
    }
    await audit(actor, {
      entityType: 'valuation', assignmentId, action: 'valuation.apply',
      summary: `Valuation applied: Rs. ${input.rate} per ${ul} of ${opt.label.toLowerCase()}, FMV Rs. ${v.fmv}.${input.reason ? ' Reason recorded.' : ''} Draft v${draft}.`, reason: input.reason ?? null, after: v,
    }, tx);
    await publish({ type: 'value.applied', firmId: actor.firmId, entityType: 'assignment', entityId: assignmentId, payload: { rate: input.rate, fmv: v.fmv } }, tx);
    return { values: v, draftVersion: draft };
  });
}

export async function valuationView(firmId: number, assignmentId: number) {
  await assertCase(firmId, assignmentId);
  const data = await caseData(assignmentId, firmId);
  const current = await db.selectFrom('valuations').selectAll().where('assignment_id', '=', assignmentId).where('is_current', '=', 1).executeTakeFirst();
  const history = await db.selectFrom('valuations as v').leftJoin('users as u', 'u.id', 'v.created_by')
    .select(['v.id', 'v.adopted_rate', 'v.proposed_rate', 'v.reason', 'v.draft_version', 'v.created_at', 'v.values_json', 'v.basis', 'v.rate_unit', 'u.name as by'])
    .where('v.assignment_id', '=', assignmentId).orderBy('v.id', 'desc').execute();
  const def = await defaultBasis(data, firmId);
  const areas = areaOptions(data);
  const basis = current && isBasis(current.basis) ? current.basis : def.basis;
  return {
    method: data.profile.valuation_method ?? 'market_comparison',
    choosesBasis: choosesBasis(data),
    basis, unit: (current?.rate_unit ?? def.unit) as RateUnit,
    defaultBasis: def,
    areas,
    workedOutFrom: workedOutFrom(data),
    basisArea: areas.find((x) => x.key === basis)?.sqft ?? null,
    proposal: data.get('VAL.PROPOSED_RATE').state === 'filled' ? { rate: data.value('VAL.PROPOSED_RATE'), lo: data.value('VAL.RANGE_LO'), hi: data.value('VAL.RANGE_HI') } : null,
    guideline: data.value('VAL.GUIDELINE'), agreement: data.value('VAL.AGREEMENT'),
    rules: { realizable_pct: data.rules.realizable_pct, distress_pct: data.rules.distress_pct, gv_variation_pct: data.rules.gv_variation_pct, rate_deviation_pct: data.rules.rate_deviation_pct, building_cost_per_sqft: data.rules.building_cost_per_sqft, rental_yield_pct: data.rules.rental_yield_pct, value_rounding_step: data.rules.value_rounding_step, rent_rounding_step: data.rules.rent_rounding_step, loading_pct: data.rules.loading_pct, saleable_factor: data.rules.saleable_factor },
    bua: data.value('AREA.BUA'),
    current: current ? { ...current, values: json(current.values_json, {}), extras: json(current.extras_json, []) } : null,
    justification: data.get('VAL.JUSTIFICATION'),
    // parking read from the agreement or the site sheet, to prefill the extras
    parking: (() => { const p = data.get('PHYS.PARKING_COUNT'); return p.state === 'filled' ? { count: Number(p.value), text: data.value('PHYS.PARKING_TEXT') ?? null, source: p.sourceDocType ?? p.source } : null; })(),
    history: history.map((h) => ({ ...h, fmv: json<any>(h.values_json, {}).fmv, values_json: undefined })),
  };
}

registerJob('evidence.read', async ({ captureId }) => {
  try { await readCapture(captureId); } catch (e) {
    await db.updateTable('evidence_captures').set({ status: 'failed', error: (e as Error).message.slice(0, 1000) }).where('id', '=', captureId).execute();
    throw e;
  }
});
