// Template engine workflow: upload → detect → auto-map → confirm → preview → publish as an
// immutable version. Each assignment pins the version live when it was created.
import { db, json, toJson, type Tx } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { audit, type Actor } from '../../platform/audit.js';
import { publish as publishEvent } from '../../platform/events.js';
import { aiConfigured } from '../../ai/claude.js';
import { enqueue } from '../../platform/jobs.js';
import { activeConfig, publishConfig, saveDraft } from '../../platform/config.js';
import { purgeFile, readFile, saveFile } from '../../platform/storage.js';
import { getSettings, setSettings } from '../../platform/settings.js';
import { dictionary, saveField, type FieldInput } from '../master/dictionary.js';
import { READY, type NewField } from './aiconvert.js';
import { singleField, templateCodes, versionFieldCodes } from './codes.js';
import { AUTO_ACCEPT, mappingHistory, matchSlot } from './automap.js';
import { compileTemplate, parsePages, type Layout } from './compile.js';
import { detectSlots, type Slot } from './detect.js';
import { openDocx } from './docx.js';
import { fontReport } from './fonts.js';
import { fixedNumbers } from './fixednumbers.js';
import { ANNEX_SECTIONS, checkPageLayout, PAGE_KEYS, type PageLayout } from './layout.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DEFAULT_LAYOUT: Layout & Record<string, unknown> = { cover_first_page: true, annexures: true };

export async function listTemplates(firmId: number) {
  const rows = await db
    .selectFrom('report_templates as t')
    .leftJoin('banks as b', 'b.id', 't.bank_id')
    .select(['t.id', 't.code', 't.name', 't.property_types', 't.branch_scope', 't.status', 't.firm_id', 't.rules_json', 'b.code as bank_code', 'b.name as bank_name'])
    .where((eb) => eb.or([eb('t.firm_id', 'is', null), eb('t.firm_id', '=', firmId)]))
    .orderBy('b.code')
    .execute();
  const versions = await db
    .selectFrom('template_versions')
    .select(['id', 'template_id', 'version', 'status', 'effective_from', 'published_at', 'created_at', 'change_note', 'ai_status'])
    .where('template_id', 'in', rows.length ? rows.map((r) => r.id) : [0])
    .orderBy('version', 'desc')
    .execute();
  const counts = await db
    .selectFrom('template_mappings')
    .select((eb) => ['template_version_id', eb.fn.countAll<number>().as('slots'), eb.fn.count<number>('field_code').as('mapped'), eb.fn.sum<number>('ignored').as('ignored'), eb.fn.count<number>('confirmed_at').as('confirmed')])
    .where('template_version_id', 'in', versions.length ? versions.map((v) => v.id) : [0])
    .groupBy('template_version_id')
    .execute();
  const c = new Map(counts.map((x) => [x.template_version_id, x]));
  const hidden = new Set((await getSettings(firmId)).hidden_templates ?? []);
  // a format new cases can use: not retired, not made inactive by this firm, with a published version
  const offered = (r: (typeof rows)[number]) => r.status === 'active' && !hidden.has(r.id) && versions.some((v) => v.template_id === r.id && v.status === 'published');
  const types = (r: (typeof rows)[number]) => json<string[]>(r.property_types, []);
  const history = await db.selectFrom('audit_log').select(['entity_id', 'summary', 'actor_name', 'created_at']).where('firm_id', '=', firmId).where('entity_type', '=', 'template').where('action', 'in', ['template.hide', 'template.show']).orderBy('id', 'desc').limit(200).execute();
  return rows.map((r) => ({
    ...r,
    hidden: hidden.has(r.id),
    // active: offered for new cases; inactive: existing cases keep it, new ones cannot pick it
    active: !hidden.has(r.id),
    // property types this is the only active format for, at its bank: making it inactive leaves new cases without one
    only_for: offered(r) ? types(r).filter((pt) => !rows.some((o) => o.id !== r.id && o.bank_code === r.bank_code && offered(o) && (types(o).includes(pt) || types(o).includes('*')))) : [],
    history: history.filter((h) => h.entity_id === String(r.id)).map((h) => ({ summary: h.summary, by: h.actor_name, at: h.created_at })),
    property_types: json(r.property_types, []),
    branch_scope: json(r.branch_scope, ['*']),
    rules: json<Record<string, number>>(r.rules_json, {}),
    versions: versions.filter((v) => v.template_id === r.id).map((v) => ({
      ...v,
      slots: Number(c.get(v.id)?.slots ?? 0),
      mapped: Number(c.get(v.id)?.mapped ?? 0),
      ignored: Number(c.get(v.id)?.ignored ?? 0),
      confirmed: Number(c.get(v.id)?.confirmed ?? 0),
    })),
  }));
}

/** Upload a bank's Word template: creates the template (if new) and a draft version with detected slots. */
export async function uploadTemplate(
  actor: Actor,
  input: { templateId?: number; bankCode?: string; name?: string; code?: string; propertyTypes?: string[]; branchScope?: string[]; fileName: string; buffer: Buffer; effectiveFrom?: string | null; note?: string | null; platform?: boolean; ai?: boolean },
  tx: Tx = db,
) {
  const firmId = input.platform ? null : actor.firmId;
  let templateId = input.templateId;
  if (!templateId) {
    const bank = input.bankCode ? await tx.selectFrom('banks').select(['id', 'code']).where('code', '=', input.bankCode).executeTakeFirst() : null;
    if (input.bankCode && !bank) throw badRequest(`Unknown bank ${input.bankCode}`);
    const code = (input.code ?? `${bank?.code ?? 'VM'}_${(input.propertyTypes ?? ['flat']).join('_')}_${Date.now().toString(36)}`).toUpperCase();
    const r = await tx.insertInto('report_templates').values({
      firm_id: firmId, bank_id: bank?.id ?? null, code, name: input.name ?? input.fileName.replace(/\.docx$/i, ''),
      property_types: toJson(input.propertyTypes ?? ['flat']), branch_scope: toJson(input.branchScope ?? ['*']), created_by: actor.id ?? null,
    }).executeTakeFirstOrThrow();
    templateId = Number(r.insertId);
  }
  let tpl = await tx.selectFrom('report_templates').selectAll().where('id', '=', templateId).executeTakeFirst();
  if (!tpl || (tpl.firm_id !== null && tpl.firm_id !== actor.firmId)) throw notFound('Template');
  if (tpl.firm_id === null && firmId !== null) {
    // a firm revising a platform format gets its own copy; the platform version is never changed by a firm
    const copyCode = `${tpl.code}_F${firmId}`.slice(0, 60);
    const own = await tx.selectFrom('report_templates').selectAll().where('firm_id', '=', firmId).where('code', '=', copyCode).executeTakeFirst();
    if (own) tpl = own;
    else {
      const r = await tx.insertInto('report_templates').values({ firm_id: firmId, bank_id: tpl.bank_id, code: copyCode, name: tpl.name, property_types: toJson(json(tpl.property_types, [])), branch_scope: toJson(json(tpl.branch_scope, ['*'])), created_by: actor.id ?? null }).executeTakeFirstOrThrow();
      tpl = (await tx.selectFrom('report_templates').selectAll().where('id', '=', Number(r.insertId)).executeTakeFirstOrThrow());
    }
    templateId = tpl.id;
  }
  const draft = await tx.selectFrom('template_versions').select('id').where('template_id', '=', templateId).where('status', '=', 'draft').executeTakeFirst();
  if (draft) throw conflict('This format already has a draft version. Publish or discard it first.');

  const { slots, stats } = detectSlots(input.buffer);
  // fonts: the recommended set is pre-selected when the file's own would not print the same everywhere (T9)
  const fonts = fontReport(openDocx(input.buffer));
  const ai = !!input.ai && aiConfigured();
  if (!slots.length && !ai) throw badRequest('No labels or placeholders found in this document');
  const file = await saveFile({ firmId, purpose: 'template', buffer: input.buffer, name: input.fileName, mime: DOCX, userId: actor.id }, tx);
  const maxV = await tx.selectFrom('template_versions').select((eb) => eb.fn.max('version').as('v')).where('template_id', '=', templateId).executeTakeFirst();
  const version = Number(maxV?.v ?? 0) + 1;
  // a revised Word file keeps the live version's layout choices and rules (H2); the fonts follow the new file
  const live = await tx.selectFrom('template_versions').select(['layout_json', 'rules_json']).where('template_id', '=', templateId).where('status', '=', 'published').orderBy('version', 'desc').executeTakeFirst();
  const { fonts: _f, ...liveLayout } = json<Record<string, unknown>>(live?.layout_json, {});
  const v = await tx.insertInto('template_versions').values({
    template_id: templateId, version, status: 'draft', effective_from: input.effectiveFrom ? new Date(input.effectiveFrom) : null,
    source_file_id: file.id, detect_json: toJson({ stats, fonts }), layout_json: toJson({ ...DEFAULT_LAYOUT, ...liveLayout, fonts: fonts.reason ? 'recommended' : 'uploaded' }),
    rules_json: live?.rules_json ? toJson(json(live.rules_json, {})) : tpl.rules_json ? toJson(json(tpl.rules_json, {})) : null, change_note: input.note ?? null, created_by: actor.id ?? null,
    ai_status: ai ? 'reading' : 'none',
  }).executeTakeFirstOrThrow();
  const versionId = Number(v.insertId);
  // the AI reads the format in the background (1–2 minutes); the label matching below stands until it finishes
  if (ai) await enqueue('template.convert', { versionId }, { firmId, dedupeKey: `template.convert:${versionId}`, maxAttempts: 2 }, tx);

  const fields = await dictionary(actor.firmId ?? 0, tx);
  const history = await mappingHistory(actor.firmId ?? 0);
  // a new version of an existing format starts from the previous version's confirmed mapping
  const prev = await tx
    .selectFrom('template_mappings as m')
    .innerJoin('template_versions as tv', 'tv.id', 'm.template_version_id')
    .select(['m.label_text', 'm.field_code', 'm.ignored'])
    .where('tv.template_id', '=', templateId)
    .where('tv.status', '=', 'published')
    .execute();
  const prevByLabel = new Map(prev.map((p) => [p.label_text, p]));
  let auto = 0;
  for (const s of slots) {
    const p = prevByLabel.get(s.label);
    const m = matchSlot(s, fields, history);
    const fromPrev = p && (p.field_code ? fields.has(p.field_code) : p.ignored);
    const accepted = fromPrev ? true : m.fieldCode !== null && m.confidence >= AUTO_ACCEPT;
    if (accepted) auto++;
    await tx.insertInto('template_mappings').values({
      template_version_id: versionId, slot_key: s.key, slot_kind: s.kind, label_text: s.label.slice(0, 500),
      context_text: s.context?.slice(0, 500) ?? null, sample_text: s.sample?.slice(0, 500) ?? null, location_json: toJson({ ...s.location, explicitCode: s.explicitCode ?? null }),
      field_code: fromPrev ? p!.field_code : m.fieldCode, ignored: fromPrev && p!.ignored ? 1 : 0,
      confidence: fromPrev ? 100 : m.confidence, method: fromPrev ? 'history' : m.method,
      confirmed_at: accepted ? new Date() : null, confirmed_by: accepted ? actor.id ?? null : null,
    }).execute();
  }
  await audit(actor, { entityType: 'template', entityId: templateId, action: 'template.upload', summary: ai ? `${input.fileName} uploaded; the AI is reading it.` : `${input.fileName}: ${slots.length} fields found, ${auto} matched automatically; ${slots.length - auto} need you.` }, tx);
  return { templateId, versionId, version, found: slots.length, matched: auto, ai };
}

export async function versionDetail(firmId: number, versionId: number) {
  const v = await db
    .selectFrom('template_versions as v')
    .innerJoin('report_templates as t', 't.id', 'v.template_id')
    .leftJoin('banks as b', 'b.id', 't.bank_id')
    .select(['v.id', 'v.version', 'v.status', 'v.effective_from', 'v.published_at', 'v.layout_json', 'v.detect_json', 't.rules_json', 'v.rules_json as v_rules', 'v.source_file_id', 'v.compiled_file_id', 'v.change_note', 'v.ai_status', 'v.ai_json', 'v.ai_error',
      't.id as template_id', 't.name', 't.code', 't.firm_id', 't.property_types', 'b.code as bank_code', 'b.name as bank_name'])
    .where('v.id', '=', versionId)
    .executeTakeFirst();
  if (!v || (v.firm_id !== null && v.firm_id !== firmId)) throw notFound('Template version');
  const mappings = await db.selectFrom('template_mappings').selectAll().where('template_version_id', '=', versionId).orderBy('sort_order').orderBy('id').execute();
  const fields = await dictionary(firmId);
  const history = await mappingHistory(firmId);
  const settings = await getSettings(firmId);
  const [newer, draft, source] = await Promise.all([
    db.selectFrom('template_versions').select('id').where('template_id', '=', v.template_id).where('version', '>', v.version).where('status', '!=', 'draft').executeTakeFirst(),
    db.selectFrom('template_versions').select(['id', 'version']).where('template_id', '=', v.template_id).where('status', '=', 'draft').executeTakeFirst(),
    db.selectFrom('files').select('purged_at').where('id', '=', v.source_file_id).executeTakeFirst(),
  ]);
  return {
    ...v,
    v_rules: undefined,
    layout: json(v.layout_json, DEFAULT_LAYOUT),
    // what a format that leaves a page choice open follows (Settings → Report layout)
    firm_layout: {
      letterhead: settings.letterhead_on ?? 'all', letterhead_pages: settings.letterhead_pages ?? null, footer_sig: settings.footer_sig ?? true,
      photo_grid: settings.photo_grid ?? 9, doc_grid: settings.doc_grid ?? 9, evidence_per_page: settings.evidence_per_page ?? 2, docs_at_end: settings.docs_at_end ?? true, min_photos: settings.min_photos ?? 9,
    },
    annex_sections: ANNEX_SECTIONS.map((x) => ({ key: x.key, label: x.label })),
    // a published version that is the newest: its layout and rules can be changed, which saves the next version (H2)
    revisable: v.status === 'published' && !newer && !draft && v.firm_id !== null,
    draft_id: draft?.id ?? null,
    // the Word file the format was prepared from is kept (an uploaded past report is deleted on publishing)
    source_kept: !!source && !source.purged_at,
    // fonts the uploaded file names, and why the recommended set is suggested (null: its own fonts are fine)
    fonts: json<any>(v.detect_json, {}).fonts ?? null,
    detect_json: undefined,
    rules: json<Record<string, number>>(v.v_rules ?? v.rules_json, {}),
    property_types: json(v.property_types, []),
    ai: json<any>(v.ai_json, null),
    ai_json: undefined,
    mappings: mappings.map((m) => {
      const loc = json<any>(m.location_json, {});
      const slot: Slot = { key: m.slot_key, kind: m.slot_kind as Slot['kind'], label: m.label_text, context: m.context_text, sample: m.sample_text, location: loc, explicitCode: loc.explicitCode ?? undefined };
      return {
        id: m.id, slot_key: m.slot_key, kind: m.slot_kind, label: m.label_text, context: m.context_text, sample: m.sample_text,
        field_code: m.field_code, field_label: m.field_code ? fields.get(m.field_code)?.label ?? m.field_code : null,
        ignored: !!m.ignored, confidence: m.confidence, method: m.method, confirmed: !!m.confirmed_at,
        status: m.status, section: m.section, note: m.ai_note, ask: json(m.ask_json, null), answer: m.answer, template: loc.template ?? null,
        suggestions: m.confirmed_at || m.slot_kind === 'para' ? [] : matchSlot(slot, fields, history).alternatives,
      };
    }),
  };
}

async function assertDraft(firmId: number | null, versionId: number, tx: Tx, opts: { whileReading?: boolean } = {}) {
  const v = await tx
    .selectFrom('template_versions as v')
    .innerJoin('report_templates as t', 't.id', 'v.template_id')
    .select(['v.id', 'v.status', 'v.template_id', 'v.version', 'v.source_file_id', 'v.layout_json', 'v.effective_from', 'v.ai_json', 'v.ai_status', 't.firm_id', 't.name', 't.property_types'])
    .where('v.id', '=', versionId)
    .executeTakeFirst();
  if (!v || v.firm_id !== firmId) throw notFound('Template version');
  if (v.status !== 'draft') throw conflict('A published version cannot be changed. Upload a revised template to create a new version.');
  // the AI's answer replaces the draft's mappings: no choices or publishing until it is in
  if (v.ai_status === 'reading' && !opts.whileReading) throw conflict('The AI is still reading this format. Try again when the review appears.');
  return v;
}

/** Confirm or change one mapping; `fieldCode: null, ignore: true` keeps the cell as fixed text. */
export async function confirmMapping(actor: Actor, versionId: number, mappingId: number, input: { fieldCode?: string | null; ignore?: boolean; newField?: FieldInput }, tx: Tx = db) {
  const v = await assertDraft(actor.firmId, versionId, tx);
  const proposed = new Set((json<any>(v.ai_json, null)?.new_fields ?? []).map((f: NewField) => f.code));
  const m = await tx.selectFrom('template_mappings').selectAll().where('id', '=', mappingId).where('template_version_id', '=', versionId).executeTakeFirst();
  if (!m) throw notFound('Mapping');
  // no field given: accept the item as it stands (the AI's template, or cleared text)
  const asIs = !input.ignore && !input.newField && (input.fieldCode == null || input.fieldCode === m.field_code);
  let code = asIs ? m.field_code : input.fieldCode ?? null;
  let method: 'manual' | 'new_field' | null = asIs ? (m.method as any) : 'manual';
  if (input.newField) {
    // the bank asks for something genuinely new: add it to the master dictionary for every bank to use
    await saveField(actor, { ...input.newField, aliases: [...(input.newField.aliases ?? []), m.label_text] }, tx);
    code = input.newField.code;
    method = 'new_field';
  }
  if (code && !asIs && !proposed.has(code) && !(await dictionary(actor.firmId!, tx)).has(code)) throw badRequest(`Unknown field ${code}`);
  const loc = json<any>(m.location_json, {});
  const template = input.ignore || asIs ? loc.template ?? null : code ? `{{${code}}}` : null;
  // "Replace" after "Undo" on a standard section: back to cleared (ValueMitra's pages print instead)
  const restore = input.ignore === false && !!m.ignored && m.slot_kind === 'para' && !loc.template;
  const status = restore ? 'clear' : input.ignore ? 'fixed' : asIs && m.status ? m.status : templateCodes(template).some((c) => proposed.has(c)) ? 'new' : 'match';
  await tx.updateTable('template_mappings').set({
    field_code: input.ignore ? null : code, ignored: input.ignore ? 1 : 0, method, confidence: asIs ? m.confidence : 100,
    location_json: toJson({ ...loc, template }), status, confirmed_by: actor.id ?? null, confirmed_at: new Date(),
  }).where('id', '=', mappingId).execute();
  await tx.insertInto('feedback_events').values({
    firm_id: actor.firmId!, kind: 'mapping.confirm', field_code: input.ignore ? null : code,
    before_json: toJson({ field: m.field_code, confidence: m.confidence, method: m.method }), after_json: toJson({ field: code, ignored: !!input.ignore }),
    context_json: toJson({ label: m.label_text, context: m.context_text }), user_id: actor.id ?? null,
  }).execute();
  await audit(actor, { entityType: 'template_version', entityId: versionId, action: 'mapping.confirm', summary: `"${m.label_text}" → ${input.ignore ? (m.slot_kind === 'para' ? 'original text kept' : 'fixed text') : template ?? code}` }, tx);
}

export async function rerunAi(actor: Actor, versionId: number) {
  const v = await assertDraft(actor.firmId, versionId, db, { whileReading: true });
  if (!aiConfigured()) throw badRequest('AI is not configured on this server');
  await db.updateTable('template_versions').set({ ai_status: 'reading', ai_error: null }).where('id', '=', versionId).execute();
  await enqueue('template.convert', { versionId }, { firmId: v.firm_id, dedupeKey: `template.convert:${versionId}`, maxAttempts: 2 });
  await audit(actor, { entityType: 'template_version', entityId: versionId, action: 'template.ai_rerun', summary: `${v.name} v${v.version}: AI reading started again` });
}

/** One click: accept every AI item that is ready: matched, new or cleared at 85% or above. */
export async function acceptReady(actor: Actor, versionId: number, tx: Tx = db) {
  await assertDraft(actor.firmId, versionId, tx);
  const r = await tx.updateTable('template_mappings').set({ confirmed_by: actor.id ?? null, confirmed_at: new Date() })
    .where('template_version_id', '=', versionId).where('confirmed_at', 'is', null)
    .where('status', 'in', ['match', 'new', 'clear']).where('confidence', '>=', READY)
    .executeTakeFirst();
  const n = Number(r.numUpdatedRows ?? 0);
  await audit(actor, { entityType: 'template_version', entityId: versionId, action: 'mapping.accept_ready', summary: `${n} item(s) accepted as read by the AI` }, tx);
  return n;
}

/** Answer a question the AI left for the valuer by picking one of its choices. */
export async function answerMapping(actor: Actor, versionId: number, mappingId: number, option: number, tx: Tx = db) {
  const v = await assertDraft(actor.firmId, versionId, tx);
  const m = await tx.selectFrom('template_mappings').selectAll().where('id', '=', mappingId).where('template_version_id', '=', versionId).executeTakeFirst();
  if (!m) throw notFound('Mapping');
  const ask = json<{ question: string; options: { label: string; template: string }[] } | null>(m.ask_json, null);
  const opt = ask?.options[option];
  if (!opt) throw badRequest('That choice is not available');
  const proposed = new Set((json<any>(v.ai_json, null)?.new_fields ?? []).map((f: NewField) => f.code));
  const loc = json<any>(m.location_json, {});
  await tx.updateTable('template_mappings').set({
    location_json: toJson({ ...loc, template: opt.template }), field_code: templateCodes(opt.template)[0] ?? null, ignored: 0, answer: opt.label.slice(0, 500),
    status: templateCodes(opt.template).some((c) => proposed.has(c)) ? 'new' : 'match', confidence: 100, confirmed_by: actor.id ?? null, confirmed_at: new Date(),
  }).where('id', '=', mappingId).execute();
  await audit(actor, { entityType: 'template_version', entityId: versionId, action: 'mapping.answer', summary: `"${m.label_text}": ${opt.label}` }, tx);
}


/** Layout choices a version may hold: compile-time (letterhead, footer, fonts) and page counts read at render (H3). */
function mergeLayout(cur: Record<string, unknown>, patch: Record<string, unknown>) {
  const l = patch as Partial<Layout> & PageLayout;
  if (l.letterhead != null && !['all', 'cover', 'page2', 'none', 'custom'].includes(l.letterhead)) throw badRequest('Letterhead: every page, cover, page 2, none or chosen pages');
  if (l.letterhead === 'custom' && !parsePages(l.letterhead_pages ?? '')) throw badRequest('Letterhead pages: e.g. 2, or 1, 2, or 2-4');
  if (l.fonts != null && !['uploaded', 'recommended'].includes(l.fonts)) throw badRequest('Fonts: keep as uploaded, or ValueMitra recommended');
  if (l.footer_sig != null && typeof l.footer_sig !== 'boolean') throw badRequest('Footer signature: on or off');
  const bad = checkPageLayout(patch);
  if (bad) throw badRequest(bad);
  const known = new Set<string>(['letterhead', 'letterhead_pages', 'footer_sig', 'fonts', ...PAGE_KEYS, 'annex_off']);
  for (const k of Object.keys(patch)) if (!known.has(k)) throw badRequest(`Unknown layout choice ${k}`);
  // null clears a choice: the firm's Report layout default applies
  const next: Record<string, unknown> = { ...cur, ...patch };
  for (const k of PAGE_KEYS) if (next[k] != null) next[k] = k === 'docs_at_end' ? !!next[k] : Number(next[k]);
  for (const k of Object.keys(next)) if (next[k] === null) delete next[k];
  if (next.letterhead !== 'custom') delete next.letterhead_pages;
  if (Array.isArray(next.annex_off) && !next.annex_off.length) delete next.annex_off;
  return next;
}

export async function setLayout(actor: Actor, versionId: number, layout: Record<string, unknown>, tx: Tx = db) {
  const v = await assertDraft(actor.firmId, versionId, tx);
  const before = json<Record<string, unknown>>(v.layout_json, DEFAULT_LAYOUT);
  const next = mergeLayout(before, layout);
  await tx.updateTable('template_versions').set({ layout_json: toJson(next) }).where('id', '=', versionId).execute();
  const changed = describeLayout(before, next);
  if (changed.length) await audit(actor, { entityType: 'template_version', entityId: versionId, action: 'template.layout', summary: `${v.name} v${v.version} (draft): ${changed.join('; ')}`, before, after: next }, tx);
}

const LAYOUT_LABEL: Record<string, string> = {
  letterhead: 'letterhead', letterhead_pages: 'letterhead pages', footer_sig: 'footer signature', fonts: 'fonts', photo_grid: 'photos per page',
  doc_grid: 'document pages per page', evidence_per_page: 'evidence per page', docs_at_end: 'documents at the end', min_photos: 'minimum photos', annex_off: 'standard sections left out',
};
const show = (v: unknown) => (v === undefined || v === null ? 'firm default' : Array.isArray(v) ? (v.length ? v.join(', ') : 'none') : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v));
function describeLayout(a: Record<string, unknown>, b: Record<string, unknown>) {
  return Object.keys(LAYOUT_LABEL).filter((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)).map((k) => (k === 'annex_off' ? `${LAYOUT_LABEL[k]} ${show(a[k] ?? [])} → ${show(b[k] ?? [])}` : `${LAYOUT_LABEL[k]} ${show(a[k])} → ${show(b[k])}`));
}

/** A format's layout, with the firm's Report layout defaults for what the format leaves open (A2, A3). */
async function layoutWithDefaults(firmId: number | null, l: Layout): Promise<Layout> {
  if (firmId === null) return l;
  const s = await getSettings(firmId);
  const own = l.letterhead !== undefined && l.letterhead !== null;
  return { ...l, letterhead: own ? l.letterhead : s.letterhead_on ?? 'all', letterhead_pages: own ? l.letterhead_pages : s.letterhead_pages ?? undefined, footer_sig: l.footer_sig ?? s.footer_sig ?? true };
}

/** Compile the draft (used for preview and on publish). */
/** `override`: layout choices not saved yet (Report layout's first-pages preview); the kept original is prepared
 *  again with them, else the version's own prepared file is used. */
export async function compileVersion(firmId: number | null, versionId: number, tx: Tx = db, override?: Record<string, unknown> | null) {
  const v = await tx.selectFrom('template_versions').selectAll().where('id', '=', versionId).executeTakeFirstOrThrow();
  const kept = override ? !(await tx.selectFrom('files').select('purged_at').where('id', '=', v.source_file_id).executeTakeFirst())?.purged_at : false;
  // a published version is its compiled file (the source may hold an earlier case and be purged)
  if (v.status !== 'draft' && v.compiled_file_id && !kept) return { compiled: (await readFile(v.compiled_file_id, firmId, tx)).buffer, mappedFields: await versionFieldCodes(versionId, tx) };
  const { buffer } = await readFile(v.source_file_id, firmId, tx);
  const maps = (await tx.selectFrom('template_mappings').selectAll().where('template_version_id', '=', versionId).where('ignored', '=', 0).execute())
    .filter((m) => m.field_code || m.slot_kind === 'para' || json<any>(m.location_json, {}).template);
  const fields = await dictionary(firmId ?? 0, tx);
  // a single remark beside the whole remarks list would print twice (formats read before 28 Oct 2026)
  const remarksList = maps.some((m) => m.slot_kind === 'para' && singleField(json<any>(m.location_json, {}).template) === 'REPORT.REMARKS');
  const repeatsRemark = (m: (typeof maps)[number]) => remarksList && m.slot_kind === 'para' && /^REPORT\.REMARK_\d+$/.test(singleField(json<any>(m.location_json, {}).template) ?? '');
  const compiled = compileTemplate(
    buffer,
    maps.map((m) => {
      const loc = json<any>(m.location_json, {});
      return {
        slot: m.slot_kind === 'para'
          ? { key: m.slot_key, kind: 'para' as const, location: { p: Number(loc.p), p_to: Number(loc.p_to ?? loc.p) } }
          : { key: m.slot_key, kind: m.slot_kind as Slot['kind'], label: m.label_text, context: m.context_text, sample: m.sample_text, location: loc, explicitCode: loc.explicitCode ?? undefined },
        fieldCode: m.field_code,
        fieldType: m.field_code ? fields.get(m.field_code)?.type ?? 'text' : 'text',
        template: repeatsRemark(m) ? null : loc.template ?? null,
      };
    }),
    await layoutWithDefaults(firmId, kept ? mergeLayout(json(v.layout_json, DEFAULT_LAYOUT), override!) as unknown as Layout : json(v.layout_json, DEFAULT_LAYOUT)),
  );
  return { compiled, mappedFields: await versionFieldCodes(versionId, tx) };
}

/** On publish: the AI's proposed fields this version prints join the dictionary; site-visit ones join the engineer's sheet. */
async function createProposedFields(actor: Actor, v: { ai_json: unknown; property_types: unknown }, versionId: number, bankCode: string | null, tx: Tx) {
  const proposed: NewField[] = json<any>(v.ai_json, null)?.new_fields ?? [];
  if (!proposed.length) return [];
  const used = new Set(await versionFieldCodes(versionId, tx));
  const have = await dictionary(actor.firmId ?? 0, tx);
  const made: NewField[] = [];
  for (const f of proposed) {
    if (!used.has(f.code) || have.has(f.code)) continue;
    const sources = f.default_text ? [...f.sources, 'derived'] : f.sources;
    await saveField(actor, {
      code: f.code, label: f.label, group: f.group, type: f.type, unit: f.unit, enum: f.options, applies: ['*'], sources,
      derivation: f.default_text ? JSON.stringify(f.default_text) : null, hint: f.hint, aliases: [], note: `Added from the ${bankCode ?? ''} format by the AI conversion`.trim(),
    }, tx);
    if (f.scope === 'bank' && bankCode) await tx.updateTable('canonical_fields').set({ origin_bank: bankCode }).where('code', '=', f.code).where('firm_id', '=', actor.firmId!).execute();
    made.push(f);
  }
  // questions answered at site go on the engineer's sheet for this firm's profiles
  const site = made.filter((f) => f.sources.includes('site_sheet')).map((f) => f.code);
  if (site.length && actor.firmId) {
    for (const pt of json<string[]>(v.property_types, [])) {
      const cur = await activeConfig<any>('profile', pt, actor.firmId, tx);
      if (!cur) continue;
      const list: string[] = cur.payload.site_sheet_fields ?? [];
      const add = site.filter((c) => !list.includes(c));
      if (!add.length) continue;
      const d = await saveDraft(actor, 'profile', pt, { ...cur.payload, site_sheet_fields: [...list, ...add] }, `Site questions from the ${bankCode ?? ''} format: ${add.join(', ')}`, tx);
      await publishConfig(actor, d.id, null, undefined, tx);
    }
  }
  return made;
}

/** Rules a format brings (realizable / distress %, area factors): they overlay the firm's rules for the bank
 *  on every case that uses the format version. A blank value removes the format's own figure. */
export const FORMAT_RULE_KEYS = ['realizable_pct', 'distress_pct', 'loading_pct', 'saleable_factor', 'building_cost_per_sqft', 'fmv_rounding_step'] as const;
function mergeRules(cur: Record<string, number>, patch: Record<string, number | null>) {
  const next = { ...cur };
  for (const [k, v] of Object.entries(patch)) {
    if (!(FORMAT_RULE_KEYS as readonly string[]).includes(k)) throw badRequest(`Unknown rule ${k}`);
    if (v === null) delete next[k];
    else if (!(Number.isFinite(v) && v >= 0 && v <= (k === 'building_cost_per_sqft' || k === 'fmv_rounding_step' ? 100000 : k === 'saleable_factor' ? 3 : 100))) throw badRequest(`${k}: out of range`);
    else next[k] = v;
  }
  return next;
}
const RULE_LABEL: Record<string, string> = { realizable_pct: 'realizable %', distress_pct: 'distress %', loading_pct: 'loading %', saleable_factor: 'saleable factor', building_cost_per_sqft: 'building cost per sq.ft.', fmv_rounding_step: 'FMV rounding' };
const describeRules = (a: Record<string, number>, b: Record<string, number>) =>
  FORMAT_RULE_KEYS.filter((k) => (a[k] ?? null) !== (b[k] ?? null)).map((k) => `${RULE_LABEL[k]} ${a[k] ?? 'firm rule'} → ${b[k] ?? 'firm rule'}`);

/** Rules on a draft version: they apply to cases once it is published. */
export async function setVersionRules(actor: Actor, versionId: number, patch: Record<string, number | null>, tx: Tx = db) {
  const v = await assertDraft(actor.firmId, versionId, tx);
  if (v.firm_id === null) throw badRequest('Platform formats cannot be changed by a firm');
  const row = await tx.selectFrom('template_versions as v').innerJoin('report_templates as t', 't.id', 'v.template_id').select(['v.rules_json', 't.rules_json as t_rules']).where('v.id', '=', versionId).executeTakeFirstOrThrow();
  const before = json<Record<string, number>>(row.rules_json ?? row.t_rules, {});
  const next = mergeRules(before, patch);
  await tx.updateTable('template_versions').set({ rules_json: toJson(next) }).where('id', '=', versionId).execute();
  const changed = describeRules(before, next);
  if (changed.length) await audit(actor, { entityType: 'template_version', entityId: versionId, action: 'template.rules', summary: `${v.name} v${v.version} (draft): ${changed.join('; ')}`, before, after: next }, tx);
  return next;
}

const COMPILE_KEYS = ['letterhead', 'letterhead_pages', 'footer_sig', 'fonts'];

/**
 * Change the layout or rules of a published format (H2): saved as the next version, same Word file, effective
 * from the chosen date. Cases already on the format keep their version. Letterhead, footer and fonts are set
 * when the Word file is prepared, so the file is prepared again from the kept original; page counts and rules
 * are read at render and the prepared file is reused.
 */
export async function reviseVersion(actor: Actor, versionId: number, input: { layout?: Record<string, unknown>; rules?: Record<string, number | null>; effectiveFrom?: string | null; note?: string | null }, tx: Tx = db) {
  const v = await tx.selectFrom('template_versions as v').innerJoin('report_templates as t', 't.id', 'v.template_id')
    .select(['v.id', 'v.template_id', 'v.version', 'v.status', 'v.source_file_id', 'v.compiled_file_id', 'v.layout_json', 'v.rules_json', 'v.detect_json', 'v.ai_json', 'v.ai_status', 'v.fixed_ok_json', 't.firm_id', 't.name', 't.rules_json as t_rules'])
    .where('v.id', '=', versionId).executeTakeFirst();
  if (!v || (v.firm_id !== null && v.firm_id !== actor.firmId)) throw notFound('Template version');
  if (v.firm_id === null) throw badRequest('This is a platform format. Upload a revised version to get your firm\'s own copy, then change its layout and rules.');
  if (v.status !== 'published') throw conflict(v.status === 'draft' ? 'A draft is changed directly; publish it when ready.' : 'Only the active version can be changed.');
  const newer = await tx.selectFrom('template_versions').select(['version', 'status']).where('template_id', '=', v.template_id).where('version', '>', v.version).executeTakeFirst();
  if (newer) throw conflict(newer.status === 'draft' ? `This format has a draft (v${newer.version}). Publish or discard it first.` : `v${newer.version} is newer. Change that one.`);
  const beforeLayout = json<Record<string, unknown>>(v.layout_json, DEFAULT_LAYOUT);
  const layout = input.layout ? mergeLayout(beforeLayout, input.layout) : beforeLayout;
  const beforeRules = json<Record<string, number>>(v.rules_json ?? v.t_rules, {});
  const rules = input.rules ? mergeRules(beforeRules, input.rules) : beforeRules;
  const lChanged = describeLayout(beforeLayout, layout);
  const rChanged = describeRules(beforeRules, rules);
  if (!lChanged.length && !rChanged.length) throw badRequest('Nothing changed');
  const recompile = COMPILE_KEYS.some((k) => JSON.stringify(beforeLayout[k] ?? null) !== JSON.stringify(layout[k] ?? null));
  if (recompile) {
    const src = await tx.selectFrom('files').select('purged_at').where('id', '=', v.source_file_id).executeTakeFirst();
    if (!src || src.purged_at) throw badRequest('The letterhead, footer signature and fonts are set when the Word file is prepared, and this format\'s original file was deleted (it held an earlier case). Upload the Word file again to change them. Page counts and rules can still be changed here.');
  }
  const eff = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date(new Date().toISOString().slice(0, 10));
  if (Number.isNaN(eff.getTime())) throw badRequest('Effective from: a date');
  const note = [rChanged.length ? `Rules changed: ${rChanged.join('; ')}` : null, lChanged.length ? `Layout changed: ${lChanged.join('; ')}` : null, input.note?.trim() || null].filter(Boolean).join('. ');
  const version = v.version + 1;
  const r = await tx.insertInto('template_versions').values({
    template_id: v.template_id, version, status: 'draft', effective_from: eff, source_file_id: v.source_file_id,
    detect_json: v.detect_json ? toJson(json(v.detect_json, {})) : null, layout_json: toJson(layout), rules_json: toJson(rules),
    ai_json: v.ai_json ? toJson(json(v.ai_json, null)) : null, ai_status: v.ai_status === 'reading' ? 'none' : v.ai_status,
    fixed_ok_json: v.fixed_ok_json ? toJson(json(v.fixed_ok_json, [])) : null, change_note: note.slice(0, 1000), created_by: actor.id ?? null,
  }).executeTakeFirstOrThrow();
  const newId = Number(r.insertId);
  const maps = await tx.selectFrom('template_mappings').selectAll().where('template_version_id', '=', versionId).execute();
  for (const m of maps) {
    const { id: _id, template_version_id: _v, ...rest } = m;
    await tx.insertInto('template_mappings').values({ ...rest, template_version_id: newId, location_json: toJson(json(m.location_json, {})), ask_json: m.ask_json ? toJson(json(m.ask_json, null)) : null } as any).execute();
  }
  let compiledId = v.compiled_file_id;
  if (recompile || !compiledId) {
    const { compiled } = await compileVersion(v.firm_id, newId, tx);
    compiledId = (await saveFile({ firmId: v.firm_id, purpose: 'template', buffer: compiled, name: `${v.name} v${version} (compiled).docx`, mime: DOCX, userId: actor.id }, tx)).id;
  }
  await tx.updateTable('template_versions').set({ status: 'published', compiled_file_id: compiledId, published_by: actor.id ?? null, published_at: new Date() }).where('id', '=', newId).execute();
  if (eff <= new Date()) {
    await tx.updateTable('template_versions').set({ status: 'retired' }).where('template_id', '=', v.template_id).where('status', '=', 'published').where('id', '!=', newId).execute();
    await tx.updateTable('report_templates').set({ rules_json: toJson(rules) }).where('id', '=', v.template_id).execute();
  }
  await audit(actor, { entityType: 'template_version', entityId: newId, action: 'template.revise', summary: `${v.name} v${version} saved from v${v.version}, effective ${eff.toISOString().slice(0, 10)}: ${note}`, before: { layout: beforeLayout, rules: beforeRules }, after: { layout, rules } }, tx);
  await publishEvent({ type: 'template.published', firmId: actor.firmId, entityType: 'template_version', entityId: newId, payload: { templateId: v.template_id, version } }, tx);
  return { versionId: newId, version, effectiveFrom: eff.toISOString().slice(0, 10), note };
}

/** Figures left as fixed text in a draft (C1), each with whether the admin has kept it as the bank's own text.
 *  Figures kept in the format's previous published version stay kept. */
export async function fixedNumberList(firmId: number | null, versionId: number, tx: Tx = db) {
  const v = await tx.selectFrom('template_versions').select(['template_id', 'fixed_ok_json']).where('id', '=', versionId).executeTakeFirstOrThrow();
  const prev = await tx.selectFrom('template_versions').select('fixed_ok_json').where('template_id', '=', v.template_id).where('id', '!=', versionId).where('status', 'in', ['published', 'retired']).orderBy('version', 'desc').executeTakeFirst();
  const ok = new Set([...json<string[]>(v.fixed_ok_json, []), ...json<string[]>(prev?.fixed_ok_json, [])]);
  const { compiled } = await compileVersion(firmId, versionId, tx);
  return fixedNumbers(compiled).map((n) => ({ ...n, ok: ok.has(n.value) }));
}

/** The admin keeps figures as fixed text (the bank's own wording, a statute, the firm's registration). */
export async function keepFixedNumbers(actor: Actor, versionId: number, values: string[], tx: Tx = db) {
  const v = await assertDraft(actor.firmId, versionId, tx);
  const cur = new Set(json<string[]>((await tx.selectFrom('template_versions').select('fixed_ok_json').where('id', '=', versionId).executeTakeFirstOrThrow()).fixed_ok_json, []));
  for (const x of values) cur.add(String(x).slice(0, 80));
  await tx.updateTable('template_versions').set({ fixed_ok_json: toJson([...cur]) }).where('id', '=', versionId).execute();
  await audit(actor, { entityType: 'template_version', entityId: versionId, action: 'template.fixed_ok', summary: `${v.name} v${v.version}: kept as fixed text: ${values.join(', ')}` }, tx);
}

export async function publishVersion(actor: Actor, versionId: number, effectiveFrom: string | null, tx: Tx = db) {
  const v = await assertDraft(actor.firmId, versionId, tx);
  const open = await tx.selectFrom('template_mappings').select((eb) => eb.fn.countAll<number>().as('n')).where('template_version_id', '=', versionId).where('confirmed_at', 'is', null).executeTakeFirst();
  if (Number(open?.n ?? 0) > 0) throw badRequest(`${open!.n} field(s) still need you before publishing`);
  // a firm's format may come from a filled report: no figure of that case may survive as fixed text (C1)
  if (v.firm_id !== null) {
    const left = (await fixedNumberList(v.firm_id, versionId, tx)).filter((n) => !n.ok);
    if (left.length) throw badRequest(`${left.length} figure(s) are still fixed text in the format: ${left.slice(0, 8).map((n) => n.value).join(', ')}${left.length > 8 ? ', …' : ''}. Map each to a field, or keep it as the bank's own text, before publishing.`);
  }
  const bank = await tx.selectFrom('report_templates as t').leftJoin('banks as b', 'b.id', 't.bank_id').select('b.code').where('t.id', '=', v.template_id).executeTakeFirst();
  const made = await createProposedFields(actor, v, versionId, bank?.code ?? null, tx);
  const { compiled } = await compileVersion(v.firm_id, versionId, tx);
  const file = await saveFile({ firmId: v.firm_id, purpose: 'template', buffer: compiled, name: `${v.name} v${v.version} (compiled).docx`, mime: DOCX, userId: actor.id }, tx);
  const eff = effectiveFrom ? new Date(effectiveFrom) : v.effective_from ?? new Date(new Date().toISOString().slice(0, 10));
  await tx.updateTable('template_versions').set({ status: 'published', compiled_file_id: file.id, effective_from: eff, published_by: actor.id ?? null, published_at: new Date() }).where('id', '=', versionId).execute();
  if (eff <= new Date()) {
    await tx.updateTable('template_versions').set({ status: 'retired' }).where('template_id', '=', v.template_id).where('status', '=', 'published').where('id', '!=', versionId).execute();
    // the latest published rules, for lists and older code paths; cases read their own version's rules
    const own = await tx.selectFrom('template_versions').select('rules_json').where('id', '=', versionId).executeTakeFirst();
    if (own?.rules_json) await tx.updateTable('report_templates').set({ rules_json: toJson(json(own.rules_json, {})) }).where('id', '=', v.template_id).execute();
  }
  // an uploaded past report holds another case (and maybe another valuer): only the compiled file is kept
  const cleared = await tx.selectFrom('template_mappings').select('id').where('template_version_id', '=', versionId).where('status', '=', 'clear').where('ignored', '=', 0).executeTakeFirst();
  if (cleared) {
    await purgeFile(v.source_file_id, tx);
    // the samples are the earlier case's text: they go with the original
    await tx.updateTable('template_mappings').set({ sample_text: null }).where('template_version_id', '=', versionId).execute();
  }
  await audit(actor, { entityType: 'template_version', entityId: versionId, action: 'template.publish', summary: `${v.name} v${v.version} published, effective ${eff.toISOString().slice(0, 10)}${made.length ? `; ${made.length} new field(s) added: ${made.map((f) => f.code).join(', ')}` : ''}${cleared ? '; the uploaded original (earlier case) was deleted' : ''}` }, tx);
  await publishEvent({ type: 'template.published', firmId: actor.firmId, entityType: 'template_version', entityId: versionId, payload: { templateId: v.template_id, version: v.version } }, tx);
}

export async function discardDraftVersion(actor: Actor, versionId: number, tx: Tx = db) {
  await assertDraft(actor.firmId, versionId, tx, { whileReading: true });
  await tx.deleteFrom('template_mappings').where('template_version_id', '=', versionId).execute();
  await tx.deleteFrom('template_versions').where('id', '=', versionId).execute();
}

/** The version a new case uses: the published version of the format for this bank, branch and property type. */
/** Hide a format from this firm's choices, or show it again (#14: Format-A for Universal). */
export async function setTemplateHidden(actor: Actor, templateId: number, hide: boolean) {
  const t = await db.selectFrom('report_templates').select(['id', 'name', 'firm_id']).where('id', '=', templateId).executeTakeFirst();
  if (!t || (t.firm_id !== null && t.firm_id !== actor.firmId)) throw notFound('Format');
  const cur = new Set((await getSettings(actor.firmId!)).hidden_templates ?? []);
  if (hide) cur.add(templateId); else cur.delete(templateId);
  await setSettings(actor.firmId!, { hidden_templates: [...cur] }, actor.id ?? null);
  await audit(actor, { entityType: 'template', entityId: templateId, action: hide ? 'template.hide' : 'template.show', summary: `${t.name} made ${hide ? 'inactive: not offered for new cases (existing cases keep it)' : 'active: offered for new cases again'}` });
}

export async function pickTemplateVersion(firmId: number, bankId: number, branchCode: string, propertyType: string, tx: Tx = db, asOf = new Date(), templateId?: number | null) {
  const rows = await tx
    .selectFrom('template_versions as v')
    .innerJoin('report_templates as t', 't.id', 'v.template_id')
    .select(['v.id', 'v.version', 'v.effective_from', 't.id as template_id', 't.name', 't.property_types', 't.branch_scope', 't.firm_id'])
    .where('t.bank_id', '=', bankId)
    .where('t.status', '=', 'active')
    .where('v.status', '=', 'published')
    .where((eb) => eb.or([eb('t.firm_id', 'is', null), eb('t.firm_id', '=', firmId)]))
    .where((eb) => eb.or([eb('v.effective_from', 'is', null), eb('v.effective_from', '<=', asOf)]))
    .orderBy('v.version', 'desc')
    .execute();
  // platform formats the firm has hidden are never offered (cases already on them keep their version)
  const hidden = new Set((await getSettings(firmId, tx)).hidden_templates ?? []);
  const fits = rows.filter((r) => {
    if (hidden.has(r.template_id)) return false;
    const pt = json<string[]>(r.property_types, []);
    const scope = json<string[]>(r.branch_scope, ['*']);
    return (pt.includes(propertyType) || pt.includes('*')) && (scope.includes('*') || scope.includes(branchCode));
  });
  // most specific: branch-scoped, firm-owned, then newest
  fits.sort((a, b) => {
    const sa = json<string[]>(a.branch_scope, ['*']).includes('*') ? 0 : 1;
    const sb = json<string[]>(b.branch_scope, ['*']).includes('*') ? 0 : 1;
    return sb - sa || (b.firm_id ? 1 : 0) - (a.firm_id ? 1 : 0) || b.version - a.version;
  });
  // the coordinator may choose any published format that fits (Flat Completed, Flat Under Construction, ...)
  if (templateId) return fits.find((r) => r.template_id === templateId) ?? null;
  return fits[0] ?? null;
}

/** Which bank formats print each field: per format (its live version, else its newest draft), field code → the format's labels. */
export async function fieldUsage(firmId: number) {
  const formats = (await listTemplates(firmId)).filter((t) => t.status === 'active');
  const pick = formats.map((t) => ({ t, v: t.versions.find((v) => v.status === 'published') ?? t.versions.find((v) => v.status === 'draft') })).filter((x) => x.v);
  const maps = (await db
    .selectFrom('template_mappings')
    .select(['template_version_id', 'field_code', 'label_text', 'location_json'])
    .where('template_version_id', 'in', pick.length ? pick.map((x) => x.v!.id) : [0])
    .where('ignored', '=', 0)
    .execute())
    .flatMap((m) => [...new Set([m.field_code, ...templateCodes(json<any>(m.location_json, {}).template)].filter(Boolean))].map((c) => ({ ...m, field_code: c })));
  return pick.map(({ t, v }) => {
    const fields: Record<string, string[]> = {};
    for (const m of maps) {
      if (m.template_version_id !== v!.id) continue;
      const labels = (fields[m.field_code!] ??= []);
      // a placeholder tag's "label" is the field code itself
      if (m.label_text !== m.field_code && !labels.includes(m.label_text)) labels.push(m.label_text);
    }
    return { templateId: t.id, name: t.name, bankCode: t.bank_code, propertyTypes: t.property_types as string[], version: v!.version, status: v!.status, fields };
  });
}
