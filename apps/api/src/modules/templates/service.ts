// Template engine workflow: upload → detect → auto-map → confirm → preview → publish as an
// immutable version. Each assignment pins the version live when it was created.
import { db, json, toJson, type Tx } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { audit, type Actor } from '../../platform/audit.js';
import { publish as publishEvent } from '../../platform/events.js';
import { readFile, saveFile } from '../../platform/storage.js';
import { dictionary, saveField, type FieldInput } from '../master/dictionary.js';
import { AUTO_ACCEPT, mappingHistory, matchSlot } from './automap.js';
import { compileTemplate, type Layout } from './compile.js';
import { detectSlots, type Slot } from './detect.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DEFAULT_LAYOUT: Layout = { cover_first_page: true, annexures: true };

export async function listTemplates(firmId: number) {
  const rows = await db
    .selectFrom('report_templates as t')
    .leftJoin('banks as b', 'b.id', 't.bank_id')
    .select(['t.id', 't.code', 't.name', 't.property_types', 't.branch_scope', 't.status', 't.firm_id', 'b.code as bank_code', 'b.name as bank_name'])
    .where((eb) => eb.or([eb('t.firm_id', 'is', null), eb('t.firm_id', '=', firmId)]))
    .orderBy('b.code')
    .execute();
  const versions = await db
    .selectFrom('template_versions')
    .select(['id', 'template_id', 'version', 'status', 'effective_from', 'published_at', 'created_at', 'change_note'])
    .where('template_id', 'in', rows.length ? rows.map((r) => r.id) : [0])
    .orderBy('version', 'desc')
    .execute();
  const counts = await db
    .selectFrom('template_mappings')
    .select((eb) => ['template_version_id', eb.fn.countAll<number>().as('slots'), eb.fn.count<number>('field_code').as('mapped'), eb.fn.sum<number>('ignored').as('ignored')])
    .where('template_version_id', 'in', versions.length ? versions.map((v) => v.id) : [0])
    .groupBy('template_version_id')
    .execute();
  const c = new Map(counts.map((x) => [x.template_version_id, x]));
  return rows.map((r) => ({
    ...r,
    property_types: json(r.property_types, []),
    branch_scope: json(r.branch_scope, ['*']),
    versions: versions.filter((v) => v.template_id === r.id).map((v) => ({
      ...v,
      slots: Number(c.get(v.id)?.slots ?? 0),
      mapped: Number(c.get(v.id)?.mapped ?? 0),
      ignored: Number(c.get(v.id)?.ignored ?? 0),
    })),
  }));
}

/** Upload a bank's Word template: creates the template (if new) and a draft version with detected slots. */
export async function uploadTemplate(
  actor: Actor,
  input: { templateId?: number; bankCode?: string; name?: string; code?: string; propertyTypes?: string[]; branchScope?: string[]; fileName: string; buffer: Buffer; effectiveFrom?: string | null; note?: string | null; platform?: boolean },
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
  const tpl = await tx.selectFrom('report_templates').selectAll().where('id', '=', templateId).executeTakeFirst();
  if (!tpl || (tpl.firm_id !== null && tpl.firm_id !== actor.firmId)) throw notFound('Template');
  const draft = await tx.selectFrom('template_versions').select('id').where('template_id', '=', templateId).where('status', '=', 'draft').executeTakeFirst();
  if (draft) throw conflict('This format already has a draft version. Publish or discard it first.');

  const { slots, stats } = detectSlots(input.buffer);
  if (!slots.length) throw badRequest('No labels or placeholders found in this document');
  const file = await saveFile({ firmId, purpose: 'template', buffer: input.buffer, name: input.fileName, mime: DOCX, userId: actor.id }, tx);
  const maxV = await tx.selectFrom('template_versions').select((eb) => eb.fn.max('version').as('v')).where('template_id', '=', templateId).executeTakeFirst();
  const version = Number(maxV?.v ?? 0) + 1;
  const v = await tx.insertInto('template_versions').values({
    template_id: templateId, version, status: 'draft', effective_from: input.effectiveFrom ? new Date(input.effectiveFrom) : null,
    source_file_id: file.id, detect_json: toJson({ stats }), layout_json: toJson(DEFAULT_LAYOUT), change_note: input.note ?? null, created_by: actor.id ?? null,
  }).executeTakeFirstOrThrow();
  const versionId = Number(v.insertId);

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
  await audit(actor, { entityType: 'template', entityId: templateId, action: 'template.upload', summary: `${input.fileName}: ${slots.length} fields found, ${auto} matched automatically; ${slots.length - auto} need you.` }, tx);
  return { templateId, versionId, version, found: slots.length, matched: auto };
}

export async function versionDetail(firmId: number, versionId: number) {
  const v = await db
    .selectFrom('template_versions as v')
    .innerJoin('report_templates as t', 't.id', 'v.template_id')
    .leftJoin('banks as b', 'b.id', 't.bank_id')
    .select(['v.id', 'v.version', 'v.status', 'v.effective_from', 'v.published_at', 'v.layout_json', 'v.source_file_id', 'v.compiled_file_id', 'v.change_note',
      't.id as template_id', 't.name', 't.code', 't.firm_id', 't.property_types', 'b.code as bank_code', 'b.name as bank_name'])
    .where('v.id', '=', versionId)
    .executeTakeFirst();
  if (!v || (v.firm_id !== null && v.firm_id !== firmId)) throw notFound('Template version');
  const mappings = await db.selectFrom('template_mappings').selectAll().where('template_version_id', '=', versionId).orderBy('id').execute();
  const fields = await dictionary(firmId);
  const history = await mappingHistory(firmId);
  return {
    ...v,
    layout: json(v.layout_json, DEFAULT_LAYOUT),
    property_types: json(v.property_types, []),
    mappings: mappings.map((m) => {
      const loc = json<any>(m.location_json, {});
      const slot: Slot = { key: m.slot_key, kind: m.slot_kind as Slot['kind'], label: m.label_text, context: m.context_text, sample: m.sample_text, location: loc, explicitCode: loc.explicitCode ?? undefined };
      return {
        id: m.id, slot_key: m.slot_key, kind: m.slot_kind, label: m.label_text, context: m.context_text, sample: m.sample_text,
        field_code: m.field_code, field_label: m.field_code ? fields.get(m.field_code)?.label ?? m.field_code : null,
        ignored: !!m.ignored, confidence: m.confidence, method: m.method, confirmed: !!m.confirmed_at,
        suggestions: m.confirmed_at ? [] : matchSlot(slot, fields, history).alternatives,
      };
    }),
  };
}

async function assertDraft(firmId: number | null, versionId: number, tx: Tx) {
  const v = await tx
    .selectFrom('template_versions as v')
    .innerJoin('report_templates as t', 't.id', 'v.template_id')
    .select(['v.id', 'v.status', 'v.template_id', 'v.version', 'v.source_file_id', 'v.layout_json', 'v.effective_from', 't.firm_id', 't.name'])
    .where('v.id', '=', versionId)
    .executeTakeFirst();
  if (!v || (v.firm_id !== null && v.firm_id !== firmId)) throw notFound('Template version');
  if (v.status !== 'draft') throw conflict('A published version cannot be changed. Upload a revised template to create a new version.');
  return v;
}

/** Confirm or change one mapping; `fieldCode: null, ignore: true` keeps the cell as fixed text. */
export async function confirmMapping(actor: Actor, versionId: number, mappingId: number, input: { fieldCode?: string | null; ignore?: boolean; newField?: FieldInput }, tx: Tx = db) {
  await assertDraft(actor.firmId, versionId, tx);
  const m = await tx.selectFrom('template_mappings').selectAll().where('id', '=', mappingId).where('template_version_id', '=', versionId).executeTakeFirst();
  if (!m) throw notFound('Mapping');
  let code = input.fieldCode ?? null;
  let method: 'manual' | 'new_field' = 'manual';
  if (input.newField) {
    // the bank asks for something genuinely new: add it to the master dictionary for every bank to use
    await saveField(actor, { ...input.newField, aliases: [...(input.newField.aliases ?? []), m.label_text] }, tx);
    code = input.newField.code;
    method = 'new_field';
  }
  if (code && !(await dictionary(actor.firmId!, tx)).has(code)) throw badRequest(`Unknown field ${code}`);
  await tx.updateTable('template_mappings').set({
    field_code: input.ignore ? null : code, ignored: input.ignore ? 1 : 0, method, confidence: 100,
    confirmed_by: actor.id ?? null, confirmed_at: new Date(),
  }).where('id', '=', mappingId).execute();
  await tx.insertInto('feedback_events').values({
    firm_id: actor.firmId!, kind: 'mapping.confirm', field_code: input.ignore ? null : code,
    before_json: toJson({ field: m.field_code, confidence: m.confidence, method: m.method }), after_json: toJson({ field: code, ignored: !!input.ignore }),
    context_json: toJson({ label: m.label_text, context: m.context_text }), user_id: actor.id ?? null,
  }).execute();
  await audit(actor, { entityType: 'template_version', entityId: versionId, action: 'mapping.confirm', summary: `"${m.label_text}" → ${input.ignore ? 'fixed text' : code}` }, tx);
}

export async function setLayout(actor: Actor, versionId: number, layout: Partial<Layout>, tx: Tx = db) {
  const v = await assertDraft(actor.firmId, versionId, tx);
  await tx.updateTable('template_versions').set({ layout_json: toJson({ ...json(v.layout_json, DEFAULT_LAYOUT), ...layout }) }).where('id', '=', versionId).execute();
}

/** Compile the draft (used for preview and on publish). */
export async function compileVersion(firmId: number | null, versionId: number, tx: Tx = db) {
  const v = await tx.selectFrom('template_versions').selectAll().where('id', '=', versionId).executeTakeFirstOrThrow();
  const { buffer } = await readFile(v.source_file_id, firmId, tx);
  const maps = await tx.selectFrom('template_mappings').selectAll().where('template_version_id', '=', versionId).where('field_code', 'is not', null).where('ignored', '=', 0).execute();
  const fields = await dictionary(firmId ?? 0, tx);
  const compiled = compileTemplate(
    buffer,
    maps.map((m) => {
      const loc = json<any>(m.location_json, {});
      return {
        slot: { key: m.slot_key, kind: m.slot_kind as Slot['kind'], label: m.label_text, context: m.context_text, sample: m.sample_text, location: loc, explicitCode: loc.explicitCode ?? undefined },
        fieldCode: m.field_code!,
        fieldType: fields.get(m.field_code!)?.type ?? 'text',
      };
    }),
    json(v.layout_json, DEFAULT_LAYOUT),
  );
  return { compiled, mappedFields: [...new Set(maps.map((m) => m.field_code!))] };
}

export async function publishVersion(actor: Actor, versionId: number, effectiveFrom: string | null, tx: Tx = db) {
  const v = await assertDraft(actor.firmId, versionId, tx);
  const open = await tx.selectFrom('template_mappings').select((eb) => eb.fn.countAll<number>().as('n')).where('template_version_id', '=', versionId).where('confirmed_at', 'is', null).executeTakeFirst();
  if (Number(open?.n ?? 0) > 0) throw badRequest(`${open!.n} field(s) still need you before publishing`);
  const { compiled } = await compileVersion(v.firm_id, versionId, tx);
  const file = await saveFile({ firmId: v.firm_id, purpose: 'template', buffer: compiled, name: `${v.name} v${v.version} (compiled).docx`, mime: DOCX, userId: actor.id }, tx);
  const eff = effectiveFrom ? new Date(effectiveFrom) : v.effective_from ?? new Date(new Date().toISOString().slice(0, 10));
  await tx.updateTable('template_versions').set({ status: 'published', compiled_file_id: file.id, effective_from: eff, published_by: actor.id ?? null, published_at: new Date() }).where('id', '=', versionId).execute();
  if (eff <= new Date()) {
    await tx.updateTable('template_versions').set({ status: 'retired' }).where('template_id', '=', v.template_id).where('status', '=', 'published').where('id', '!=', versionId).execute();
  }
  await audit(actor, { entityType: 'template_version', entityId: versionId, action: 'template.publish', summary: `${v.name} v${v.version} published, effective ${eff.toISOString().slice(0, 10)}` }, tx);
  await publishEvent({ type: 'template.published', firmId: actor.firmId, entityType: 'template_version', entityId: versionId, payload: { templateId: v.template_id, version: v.version } }, tx);
}

export async function discardDraftVersion(actor: Actor, versionId: number, tx: Tx = db) {
  await assertDraft(actor.firmId, versionId, tx);
  await tx.deleteFrom('template_mappings').where('template_version_id', '=', versionId).execute();
  await tx.deleteFrom('template_versions').where('id', '=', versionId).execute();
}

/** The version a new case uses: the published version of the format for this bank, branch and property type. */
export async function pickTemplateVersion(firmId: number, bankId: number, branchCode: string, propertyType: string, tx: Tx = db, asOf = new Date()) {
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
  const fits = rows.filter((r) => {
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
  return fits[0] ?? null;
}
