// Site visit: no-login engineer link (random token, stored hashed, expiring), photo checks,
// selection between the profile's min and max, editable captions, and the typed site sheet read
// into fields like any other document.
import exifr from 'exifr';
import sharp from 'sharp';
import { z } from 'zod';
import { aiConfigured, imageBlock, structured, textBlock } from '../../ai/claude.js';
import { env } from '../../config/env.js';
import { db, json, toJson } from '../../db/index.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { audit, type Actor } from '../../platform/audit.js';
import { configById } from '../../platform/config.js';
import { randomToken, sha256 } from '../../platform/crypto.js';
import { publish } from '../../platform/events.js';
import { enqueue, registerJob } from '../../platform/jobs.js';
import { getSettings } from '../../platform/settings.js';
import { readFile, saveFile } from '../../platform/storage.js';
import { DOCS, IMAGES, requireKind } from '../../lib/sniff.js';
import { caseData } from '../casedata/resolver.js';
import { writeCandidates } from '../casedata/values.js';
import { extractFields, preparePages, syncChecklist } from '../documents/reader.js';
import { assertCase } from '../documents/service.js';

export async function createVisitLink(actor: Actor, assignmentId: number) {
  const a = await assertCase(actor.firmId!, assignmentId);
  const settings = await getSettings(actor.firmId!);
  const asg = await db.selectFrom('assignments').select(['engineer_id']).where('id', '=', assignmentId).executeTakeFirstOrThrow();
  const token = randomToken(24);
  const expires = new Date(Date.now() + settings.engineer_link_hours * 3600_000);
  // a new link replaces older ones
  await db.updateTable('site_visits').set({ revoked_at: new Date() }).where('assignment_id', '=', assignmentId).where('revoked_at', 'is', null).where('status', '!=', 'submitted').execute();
  const existing = await db.selectFrom('site_visits').select('id').where('assignment_id', '=', assignmentId).where('status', '=', 'submitted').executeTakeFirst();
  const r = await db.insertInto('site_visits').values({ assignment_id: assignmentId, engineer_id: asg.engineer_id, token_hash: sha256(token), expires_at: expires, created_by: actor.id ?? null }).executeTakeFirstOrThrow();
  const url = `${env.APP_URL}/v/${token}`;
  const data = await caseData(assignmentId, actor.firmId!);
  const tpl = data.wording.messages?.engineer_link?.body ?? 'Site visit link: {{LINK}}';
  const message = data.wordingText(tpl, { LINK: url, LINK_EXPIRES: expires.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }), 'CASE.ENGINEER_NAME': data.case.engineer_name ?? 'Sir' })
    ?? data.wordingText(tpl.replace(/\{\{[^}]*PROP\.ADDRESS[^}]*\}\}/g, '{{CASE.LOCALITY_HINT}}'), { LINK: url, LINK_EXPIRES: expires.toLocaleDateString('en-IN') })
    ?? `Site visit for ${a.case_no}: ${url}`;
  await db.insertInto('messages').values({ firm_id: actor.firmId!, assignment_id: assignmentId, channel: 'whatsapp', purpose: 'engineer_link', body: message, created_by: actor.id ?? null }).execute();
  await audit(actor, { entityType: 'site_visit', entityId: Number(r.insertId), assignmentId, action: 'site.link', summary: `Site visit link created${existing ? ' (another visit already submitted)' : ''}; valid till ${expires.toISOString().slice(0, 16).replace('T', ' ')} UTC.` });
  return { url, expiresAt: expires, message };
}

export async function visitByToken(token: string) {
  const v = await db.selectFrom('site_visits').selectAll().where('token_hash', '=', sha256(token)).executeTakeFirst();
  if (!v || v.revoked_at) throw notFound('Visit link');
  if (v.expires_at < new Date()) throw badRequest('This link has expired. Ask the office for a new one.');
  const a = await db
    .selectFrom('assignments as a')
    .innerJoin('banks as b', 'b.id', 'a.bank_id')
    .innerJoin('bank_branches as br', 'br.id', 'a.branch_id')
    .innerJoin('firms as f', 'f.id', 'a.firm_id')
    .leftJoin('engineers as e', 'e.id', 'a.engineer_id')
    .select(['a.id', 'a.firm_id', 'a.case_no', 'a.locality_hint', 'a.profile_version_id', 'b.short_name as bank', 'br.name as branch', 'f.name as firm', 'e.name as engineer', 'a.signed_at'])
    .where('a.id', '=', v.assignment_id)
    .executeTakeFirstOrThrow();
  return { visit: v, assignment: a };
}

export async function publicVisitInfo(token: string) {
  const { visit, assignment } = await visitByToken(token);
  const profile = assignment.profile_version_id ? (await configById(assignment.profile_version_id)).payload : {};
  const addr = await db.selectFrom('field_values').select('value_text').where('assignment_id', '=', assignment.id).where('field_code', '=', 'PROP.ADDRESS').where('is_current', '=', 1).orderBy('confidence', 'desc').executeTakeFirst();
  const photos = await db.selectFrom('site_photos').select(['id', 'created_at']).where('site_visit_id', '=', visit.id).orderBy('id').execute();
  const sheet = await db.selectFrom('documents').select(['id', 'created_at']).where('assignment_id', '=', assignment.id).where('role', '=', 'site_sheet').orderBy('id', 'desc').executeTakeFirst();
  const after = (d: Date) => !!visit.submitted_at && d > visit.submitted_at;
  return {
    caseNo: assignment.case_no, firm: assignment.firm, bank: assignment.bank, branch: assignment.branch, engineer: assignment.engineer,
    address: addr?.value_text ?? assignment.locality_hint, status: visit.status, expiresAt: visit.expires_at,
    prompts: profile.photo_prompts ?? [], minPhotos: profile.min_photos ?? 9, photos: photos.length, sheetUploaded: !!sheet,
    photoIds: photos.map((p) => p.id),
    // uploads after the visit was submitted; only these need sending again
    newSinceSubmit: photos.filter((p) => after(p.created_at)).length + (sheet && after(sheet.created_at) ? 1 : 0),
  };
}

/** Thumbnail of a photo uploaded through this visit link (the token is the credential). */
export async function publicThumb(token: string, photoId: number) {
  const { visit, assignment } = await visitByToken(token);
  const p = await db.selectFrom('site_photos').select(['thumb_file_id', 'file_id']).where('id', '=', photoId).where('site_visit_id', '=', visit.id).executeTakeFirst();
  if (!p) throw notFound('Photo');
  return (await readFile(p.thumb_file_id ?? p.file_id, assignment.firm_id)).buffer;
}

/** dHash: 64-bit perceptual hash; near-identical photos differ in a few bits. */
async function dhash(buf: Buffer): Promise<string> {
  const px = await sharp(buf).rotate().grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x] > px[y * 9 + x + 1] ? '1' : '0';
  return BigInt('0b' + bits).toString(16).padStart(16, '0');
}
const hamming = (a: string, b: string) => { let x = BigInt('0x' + a) ^ BigInt('0x' + b); let n = 0; while (x) { n += Number(x & 1n); x >>= 1n; } return n; };

const distanceM = (a: [number, number], b: [number, number]) => {
  const R = 6371000;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(b[0] - a[0]);
  const dLng = toR(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a[0])) * Math.cos(toR(b[0])) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
};

export async function addPhotos(firmId: number, assignmentId: number, visitId: number | null, files: { name: string; buffer: Buffer }[], source: 'engineer' | 'upload') {
  const ids: number[] = [];
  for (const f of files) {
    let meta: any = {};
    try { meta = (await exifr.parse(f.buffer, { gps: true, pick: ['DateTimeOriginal', 'CreateDate', 'latitude', 'longitude', 'GPSLatitude', 'GPSLongitude'] })) ?? {}; } catch { /* no EXIF */ }
    const img = await sharp(f.buffer, { failOn: 'none' }).rotate().resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 84 }).toBuffer();
    const thumb = await sharp(img).resize({ width: 320 }).jpeg({ quality: 72 }).toBuffer();
    const file = await saveFile({ firmId, purpose: 'photo', folder: `a${assignmentId}/photos`, buffer: img, name: f.name, mime: 'image/jpeg' });
    const tf = await saveFile({ firmId, purpose: 'photo_thumb', folder: `a${assignmentId}/photos`, buffer: thumb, mime: 'image/jpeg' });
    const taken = meta.DateTimeOriginal ?? meta.CreateDate ?? null;
    const r = await db.insertInto('site_photos').values({
      assignment_id: assignmentId, site_visit_id: visitId, file_id: file.id, thumb_file_id: tf.id, source,
      taken_at: taken instanceof Date ? taken : null, lat: typeof meta.latitude === 'number' ? meta.latitude : null, lng: typeof meta.longitude === 'number' ? meta.longitude : null,
      dhash: await dhash(img), caption: null,
    }).executeTakeFirstOrThrow();
    ids.push(Number(r.insertId));
  }
  return ids;
}

/** Duplicates, distance from the pin, time stamps; then AI captions and selfie / name-board flags. */
export async function analysePhotos(assignmentId: number) {
  const a = await db.selectFrom('assignments').select(['id', 'firm_id', 'profile_version_id']).where('id', '=', assignmentId).executeTakeFirstOrThrow();
  const photos = await db.selectFrom('site_photos').selectAll().where('assignment_id', '=', assignmentId).where('source', '!=', 'document').orderBy('taken_at').orderBy('id').execute();
  if (!photos.length) return;
  const visit = await db.selectFrom('site_visits').selectAll().where('assignment_id', '=', assignmentId).where('status', '=', 'submitted').orderBy('id', 'desc').executeTakeFirst();
  const geo = photos.filter((p) => p.lat !== null && p.lng !== null).map((p) => [Number(p.lat), Number(p.lng)] as [number, number]);
  const median = (xs: number[]) => { const s = [...xs].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const pin: [number, number] | null = visit?.pin_lat ? [Number(visit.pin_lat), Number(visit.pin_lng)] : geo.length ? [median(geo.map((g) => g[0])), median(geo.map((g) => g[1]))] : null;
  if (pin && visit && !visit.pin_lat) await db.updateTable('site_visits').set({ pin_lat: pin[0], pin_lng: pin[1] }).where('id', '=', visit.id).execute();
  if (pin) {
    await writeCandidates(assignmentId, a.firm_id, [
      { fieldCode: 'PROP.LAT', value: pin[0].toFixed(6), sourceType: 'site_sheet', snippet: `Median position of ${geo.length} geo-tagged site photos`, confidence: 95 },
      { fieldCode: 'PROP.LNG', value: pin[1].toFixed(6), sourceType: 'site_sheet', snippet: `Median position of ${geo.length} geo-tagged site photos`, confidence: 95 },
    ]);
  }
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    let dup: number | null = null;
    for (let j = 0; j < i; j++) if (p.dhash && photos[j].dhash && hamming(p.dhash, photos[j].dhash!) <= 6 && !photos[j].duplicate_of) { dup = photos[j].id; break; }
    const dist = pin && p.lat !== null ? distanceM(pin, [Number(p.lat), Number(p.lng)]) : null;
    await db.updateTable('site_photos').set({ duplicate_of: dup, distance_m: dist }).where('id', '=', p.id).execute();
    (p as any).duplicate_of = dup;
  }
  if (aiConfigured()) try {
    const profile = a.profile_version_id ? (await configById(a.profile_version_id)).payload : {};
    const prompts: string[] = profile.photo_prompts ?? [];
    for (let i = 0; i < photos.length; i += 20) {
      const batch = photos.slice(i, i + 20);
      const content = [];
      for (const [k, p] of batch.entries()) {
        const { buffer } = await readFile(p.thumb_file_id ?? p.file_id, a.firm_id);
        content.push(textBlock(`Photo ${k + 1}:`), imageBlock(await sharp(buffer).resize({ width: 480, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer()));
      }
      content.push(textBlock(`Caption each photo for a property valuation report in 2-5 words. Prefer these captions when they fit: ${prompts.join(', ')}.`));
      const r = await structured({
        system: 'You look at site photographs taken by a field engineer at a property being valued for a bank loan in India.',
        content,
        schema: z.object({ photos: z.array(z.object({ index: z.number().int(), caption: z.string(), is_selfie: z.boolean().describe('The engineer is visible at the site'), names_visible: z.boolean().describe("A board or list showing residents' or members' names is readable") })) }),
        effort: 'low',
      });
      for (const x of r.data.photos) {
        const p = batch[x.index - 1];
        if (!p) continue;
        await db.updateTable('site_photos').set({ ai_caption: x.caption.slice(0, 200), caption: p.caption ?? x.caption.slice(0, 200), is_selfie: x.is_selfie ? 1 : 0, names_visible: x.names_visible ? 1 : 0 }).where('id', '=', p.id).execute();
      }
    }
  } catch (e) {
    // captions are a convenience; the photo checks and selection still complete without them
    console.error('[photos] AI captions unavailable:', (e as Error).message);
  }
  // default selection when nothing is chosen yet: non-duplicates in prompt order, between min and 12
  const sel = await db.selectFrom('site_photos').select('id').where('assignment_id', '=', assignmentId).where('selected', '=', 1).limit(1).executeTakeFirst();
  if (!sel) {
    const fresh = await db.selectFrom('site_photos').select(['id', 'duplicate_of']).where('assignment_id', '=', assignmentId).where('source', '!=', 'document').orderBy('taken_at').orderBy('id').execute();
    const pick = fresh.filter((p) => !p.duplicate_of).slice(0, 12).map((p) => p.id);
    if (pick.length) await db.updateTable('site_photos').set({ selected: 1 }).where('id', 'in', pick).execute();
    for (const [i, id] of pick.entries()) await db.updateTable('site_photos').set({ sort_order: i }).where('id', '=', id).execute();
  }
}

export async function engineerUpload(token: string, kind: 'sheet' | 'photos', files: { name: string; mime: string; buffer: Buffer }[]) {
  const { visit, assignment } = await visitByToken(token);
  if (assignment.signed_at) throw badRequest('This report is already signed');
  if (!files.length) throw badRequest('Choose files to upload');
  if (visit.status === 'assigned') await db.updateTable('site_visits').set({ status: 'in_progress' }).where('id', '=', visit.id).execute();
  if (kind === 'photos') {
    for (const f of files) requireKind(f.buffer, IMAGES, f.name);
    const ids = await addPhotos(assignment.firm_id, assignment.id, visit.id, files, 'engineer');
    return { photos: ids.length };
  }
  const mime = requireKind(files[0].buffer, DOCS, files[0].name);
  const stored = await saveFile({ firmId: assignment.firm_id, purpose: 'upload', folder: `a${assignment.id}/uploads`, buffer: files[0].buffer, name: files[0].name, mime });
  await db.insertInto('documents').values({ firm_id: assignment.firm_id, assignment_id: assignment.id, file_id: stored.id, batch_no: 0, channel: 'Engineer link', received_from: assignment.engineer, role: 'site_sheet' }).execute();
  return { sheet: true };
}

export async function engineerSubmit(token: string, note: string | null) {
  const { visit, assignment } = await visitByToken(token);
  const photos = await db.selectFrom('site_photos').select((eb) => eb.fn.countAll<number>().as('n')).where('site_visit_id', '=', visit.id).executeTakeFirst();
  const sheet = await db.selectFrom('documents').select('id').where('assignment_id', '=', assignment.id).where('role', '=', 'site_sheet').where('status', '=', 'uploaded').orderBy('id', 'desc').executeTakeFirst();
  if (!Number(photos?.n) && !sheet) throw badRequest('Upload the inspection sheet and photos first');
  if (visit.status === 'submitted' && !(await publicVisitInfo(token)).newSinceSubmit) return; // nothing new to send
  await db.updateTable('site_visits').set({ status: 'submitted', submitted_at: new Date(), engineer_note: note, visit_date: new Date() }).where('id', '=', visit.id).execute();
  const actor: Actor = { type: 'engineer', name: assignment.engineer ?? 'Field engineer', firmId: assignment.firm_id };
  await audit(actor, { entityType: 'site_visit', entityId: visit.id, assignmentId: assignment.id, action: 'site.submit', summary: `Site ${sheet ? 'sheet and ' : ''}${photos?.n ?? 0} photos received via the visit link.${note ? ` Note: ${note}` : ''}` });
  if (sheet) await enqueue('site.read_sheet', { documentId: sheet.id }, { firmId: assignment.firm_id, dedupeKey: `doc:${sheet.id}` });
  await enqueue('site.analyse_photos', { assignmentId: assignment.id }, { firmId: assignment.firm_id, dedupeKey: `photos:${assignment.id}` });
  await publish({ type: 'site.submitted', firmId: assignment.firm_id, entityType: 'assignment', entityId: assignment.id, payload: {} });
}

/** Office staff can also upload photos received another way and mark the visit done. */
export async function officeUploadPhotos(actor: Actor, assignmentId: number, files: { name: string; mime: string; buffer: Buffer }[]) {
  await assertCase(actor.firmId!, assignmentId);
  let visit = await db.selectFrom('site_visits').selectAll().where('assignment_id', '=', assignmentId).orderBy('id', 'desc').executeTakeFirst();
  if (!visit) {
    await db.insertInto('site_visits').values({ assignment_id: assignmentId, token_hash: sha256(randomToken()), expires_at: new Date(), status: 'submitted', submitted_at: new Date(), visit_date: new Date(), created_by: actor.id ?? null }).execute();
    visit = await db.selectFrom('site_visits').selectAll().where('assignment_id', '=', assignmentId).orderBy('id', 'desc').executeTakeFirstOrThrow();
  } else if (visit.status !== 'submitted') {
    await db.updateTable('site_visits').set({ status: 'submitted', submitted_at: new Date(), visit_date: new Date() }).where('id', '=', visit.id).execute();
  }
  for (const f of files) requireKind(f.buffer, IMAGES, f.name);
  const ids = await addPhotos(actor.firmId!, assignmentId, visit.id, files, 'engineer');
  await audit(actor, { entityType: 'site_visit', entityId: visit.id, assignmentId, action: 'site.photos', summary: `${ids.length} site photo(s) uploaded from the office.` });
  await enqueue('site.analyse_photos', { assignmentId }, { firmId: actor.firmId, dedupeKey: `photos:${assignmentId}` });
  await publish({ type: 'site.submitted', firmId: actor.firmId, entityType: 'assignment', entityId: assignmentId, payload: {} });
}

export async function listPhotos(firmId: number, assignmentId: number) {
  await assertCase(firmId, assignmentId);
  const photos = await db.selectFrom('site_photos').selectAll().where('assignment_id', '=', assignmentId).orderBy('sort_order').orderBy('taken_at').orderBy('id').execute();
  const visit = await db.selectFrom('site_visits').select(['id', 'status', 'expires_at', 'submitted_at', 'engineer_note', 'pin_lat', 'pin_lng', 'revoked_at', 'created_at']).where('assignment_id', '=', assignmentId).orderBy('id', 'desc').executeTakeFirst();
  const asg = await db.selectFrom('assignments').select('profile_version_id').where('id', '=', assignmentId).executeTakeFirstOrThrow();
  const profile = asg.profile_version_id ? (await configById(asg.profile_version_id)).payload : {};
  return { visit: visit ?? null, photos, minPhotos: profile.min_photos ?? 9, maxPhotos: profile.max_photos ?? 18, prompts: profile.photo_prompts ?? [] };
}

export async function updatePhoto(actor: Actor, assignmentId: number, photoId: number, patch: { selected?: boolean; caption?: string }) {
  const a = await assertCase(actor.firmId!, assignmentId);
  if (a.signed_at) throw badRequest('The report is signed and locked. Reopen it to make changes.');
  const p = await db.selectFrom('site_photos').selectAll().where('id', '=', photoId).where('assignment_id', '=', assignmentId).executeTakeFirst();
  if (!p) throw notFound('Photo');
  const asg = await db.selectFrom('assignments').select('profile_version_id').where('id', '=', assignmentId).executeTakeFirstOrThrow();
  const profile = asg.profile_version_id ? (await configById(asg.profile_version_id)).payload : {};
  const min = profile.min_photos ?? 9;
  const max = profile.max_photos ?? 18;
  if (patch.selected !== undefined && !!p.selected !== patch.selected) {
    const n = Number((await db.selectFrom('site_photos').select((eb) => eb.fn.countAll<number>().as('n')).where('assignment_id', '=', assignmentId).where('selected', '=', 1).executeTakeFirst())?.n ?? 0);
    if (patch.selected && n >= max) throw badRequest(`Up to ${max} photos fit on two pages`);
    if (!patch.selected && n <= min) throw badRequest(`Keep at least ${min} photos for the report`);
    const order = patch.selected ? Number((await db.selectFrom('site_photos').select((eb) => eb.fn.max('sort_order').as('m')).where('assignment_id', '=', assignmentId).executeTakeFirst())?.m ?? 0) + 1 : p.sort_order;
    await db.updateTable('site_photos').set({ selected: patch.selected ? 1 : 0, sort_order: order }).where('id', '=', photoId).execute();
  }
  if (patch.caption !== undefined) {
    await db.updateTable('site_photos').set({ caption: patch.caption.slice(0, 200) }).where('id', '=', photoId).execute();
    if (p.ai_caption && p.ai_caption !== patch.caption) {
      await db.insertInto('feedback_events').values({ firm_id: actor.firmId!, assignment_id: assignmentId, kind: 'photo_caption.edit', before_json: toJson({ caption: p.ai_caption }), after_json: toJson({ caption: patch.caption }), user_id: actor.id ?? null }).execute();
    }
  }
  await publish({ type: 'value.changed', firmId: actor.firmId, entityType: 'assignment', entityId: assignmentId, payload: { photo: photoId } });
}

export async function reorderPhotos(actor: Actor, assignmentId: number, ids: number[]) {
  await assertCase(actor.firmId!, assignmentId);
  for (const [i, id] of ids.entries()) await db.updateTable('site_photos').set({ sort_order: i }).where('id', '=', id).where('assignment_id', '=', assignmentId).execute();
}

async function readSiteSheet(documentId: number) {
  const d = await db.selectFrom('documents').selectAll().where('id', '=', documentId).executeTakeFirstOrThrow();
  const a = await db.selectFrom('assignments').select(['id', 'firm_id', 'property_type', 'profile_version_id']).where('id', '=', d.assignment_id).executeTakeFirstOrThrow();
  await db.updateTable('documents').set({ status: 'reading', error: null }).where('id', '=', documentId).execute();
  await preparePages(documentId);
  const pages = (await db.selectFrom('document_pages').selectAll().where('document_id', '=', documentId).orderBy('page_no').execute());
  const profile = a.profile_version_id ? (await configById(a.profile_version_id)).payload : {};
  const imgs = new Map<number, Buffer>();
  for (const p of pages.slice(0, 6)) if (p.image_file_id) imgs.set(p.page_no, (await readFile(p.image_file_id, a.firm_id)).buffer);
  const { values } = await extractFields(a.firm_id, 'site_sheet', 'Site inspection sheet filled by the field engineer', a.property_type, pages, imgs, json(profile.site_sheet_fields, []));
  await writeCandidates(a.id, a.firm_id, values.map((v) => ({ fieldCode: v.field_code, value: v.value, sourceType: 'site_sheet' as const, docType: 'site_sheet', documentId, page: v.page, snippet: v.snippet, snippetLang: v.snippet_language, confidence: Math.round(v.confidence) })));
  await db.updateTable('documents').set({ status: 'read' }).where('id', '=', documentId).execute();
  await syncChecklist(a.id);
  await audit({ type: 'system', name: 'System', firmId: a.firm_id }, { entityType: 'document', entityId: documentId, assignmentId: a.id, action: 'site.sheet_read', summary: `Site sheet (${pages.length} page(s)) read: ${values.length} site fields filled.` });
  await publish({ type: 'document.read', firmId: a.firm_id, entityType: 'assignment', entityId: a.id, payload: { documentId } });
}

registerJob('site.read_sheet', async ({ documentId }) => {
  try { await readSiteSheet(documentId); } catch (e) {
    await db.updateTable('documents').set({ status: 'failed', error: (e as Error).message.slice(0, 1000) }).where('id', '=', documentId).execute();
    throw e;
  }
});
registerJob('site.analyse_photos', async ({ assignmentId }) => {
  await analysePhotos(assignmentId);
  await syncChecklist(assignmentId);
  const a = await db.selectFrom('assignments').select('firm_id').where('id', '=', assignmentId).executeTakeFirstOrThrow();
  await publish({ type: 'value.changed', firmId: a.firm_id, entityType: 'assignment', entityId: assignmentId, payload: { photos: true } });
});
