// Canonical field dictionary: the latest active version of every field for a firm.
import { db, json, toJson, type Tx } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { audit, type Actor } from '../../platform/audit.js';
import { parse } from '@vm/shared';

export interface Field {
  id: number;
  code: string;
  version: number;
  label: string;
  group: string;
  description: string | null;
  type: string;
  unit: string | null;
  enum: string[] | null;
  applies: string[];
  sources: string[];
  validation: { expr: string; message: string }[];
  derivation: string | null;
  rules: any;
  hint: string | null;
  aliases: string[];
  pending: string | null;
  sort: number;
  status: 'active' | 'deprecated';
  firmOwned: boolean;
}

const mapField = (r: any): Field => ({
  id: r.id,
  code: r.code,
  version: r.version,
  label: r.label,
  group: r.group_code,
  description: r.description,
  type: r.data_type,
  unit: r.unit,
  enum: json(r.enum_options, null),
  applies: json(r.applies_to, ['*']),
  sources: json(r.sources, []),
  validation: json(r.validation, []),
  derivation: r.derivation,
  rules: json(r.rules, null),
  hint: r.extraction_hint,
  aliases: json(r.aliases, []),
  pending: r.pending_label,
  sort: r.sort_order,
  status: r.status,
  firmOwned: r.firm_id !== null,
});

const cache = new Map<number, { at: number; fields: Map<string, Field> }>();
export const invalidateDictionary = (firmId?: number) => (firmId ? cache.delete(firmId) : cache.clear());

/** Latest version per code; a firm's own version of a code overrides the platform's. */
export async function dictionary(firmId: number, tx: Tx = db): Promise<Map<string, Field>> {
  const hit = cache.get(firmId);
  if (hit && Date.now() - hit.at < 60_000 && tx === db) return hit.fields;
  const rows = await tx
    .selectFrom('canonical_fields')
    .selectAll()
    .where((eb) => eb.or([eb('firm_id', 'is', null), eb('firm_id', '=', firmId)]))
    .orderBy('code')
    .orderBy('version', 'asc')
    .execute();
  const out = new Map<string, Field>();
  for (const r of rows) {
    const prev = out.get(r.code);
    // keep the highest version; at equal footing prefer the firm-owned row
    if (!prev || r.version > prev.version || (r.firm_id !== null && !prev.firmOwned)) out.set(r.code, mapField(r));
  }
  cache.set(firmId, { at: Date.now(), fields: out });
  return out;
}

export async function fieldHistory(firmId: number, code: string) {
  const rows = await db
    .selectFrom('canonical_fields')
    .selectAll()
    .where('code', '=', code)
    .where((eb) => eb.or([eb('firm_id', 'is', null), eb('firm_id', '=', firmId)]))
    .orderBy('version', 'desc')
    .execute();
  return rows.map(mapField);
}

export interface FieldInput {
  code: string;
  label: string;
  group: string;
  description?: string | null;
  type: string;
  unit?: string | null;
  enum?: string[] | null;
  applies: string[];
  sources: string[];
  validation?: { expr: string; message: string }[];
  derivation?: string | null;
  rules?: unknown;
  hint?: string | null;
  aliases?: string[];
  pending?: string | null;
  sort?: number;
  status?: 'active' | 'deprecated';
  note?: string | null;
}

export function validateFieldInput(f: FieldInput) {
  if (!/^[A-Z][A-Z0-9_]*(\.[A-Z0-9_]+)+$/.test(f.code)) throw badRequest('Field ID must look like GROUP.NAME, e.g. AREA.MEZZANINE');
  for (const e of [f.derivation, ...(f.validation ?? []).map((v) => v.expr)]) {
    if (!e) continue;
    try { parse(e); } catch (err) { throw badRequest(`Expression "${e}": ${(err as Error).message}`); }
  }
}

/** Add a field or create a new version of one. Field IDs are never reused for a different meaning. */
export async function saveField(actor: Actor, f: FieldInput, tx: Tx = db) {
  validateFieldInput(f);
  const firmId = actor.firmId!;
  const existing = await tx
    .selectFrom('canonical_fields')
    .select((eb) => eb.fn.max('version').as('v'))
    .where('code', '=', f.code)
    .executeTakeFirst();
  const version = Number(existing?.v ?? 0) + 1;
  if (version === 1 && f.status === 'deprecated') throw conflict('A new field cannot start deprecated');
  await tx
    .insertInto('canonical_fields')
    .values({
      firm_id: firmId,
      code: f.code,
      version,
      label: f.label,
      group_code: f.group,
      description: f.description ?? null,
      data_type: f.type,
      unit: f.unit ?? null,
      enum_options: f.enum ? toJson(f.enum) : null,
      applies_to: toJson(f.applies.length ? f.applies : ['*']),
      sources: toJson(f.sources),
      validation: f.validation ? toJson(f.validation) : null,
      derivation: f.derivation ?? null,
      rules: f.rules ? toJson(f.rules) : null,
      extraction_hint: f.hint ?? null,
      aliases: toJson(f.aliases ?? []),
      pending_label: f.pending ?? null,
      sort_order: f.sort ?? 0,
      status: f.status ?? 'active',
      change_note: f.note ?? null,
      created_by: actor.id ?? null,
    })
    .execute();
  invalidateDictionary(firmId);
  await audit(actor, {
    entityType: 'field', entityId: f.code, action: version === 1 ? 'field.add' : f.status === 'deprecated' ? 'field.deprecate' : 'field.change',
    summary: `${f.code} "${f.label}" v${version}${f.status === 'deprecated' ? ' deprecated' : ''}`, reason: f.note ?? null, after: f,
  }, tx);
  return { code: f.code, version };
}

export async function getField(firmId: number, code: string) {
  const f = (await dictionary(firmId)).get(code);
  if (!f) throw notFound(`Field ${code}`);
  return f;
}
