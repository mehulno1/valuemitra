// Versioned, effective-dated configuration objects (profiles, rule sets, check sets, wording,
// document types). Published versions are immutable; edits create a new draft; each assignment pins
// the version ids it was created with so a later change never alters past reports.
import { db, json, toJson, type Tx } from '../db/index.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { audit, type Actor } from './audit.js';
import { publish as publishEvent } from './events.js';

export type ConfigKind = 'profile' | 'rule_set' | 'check_set' | 'wording' | 'doc_types';

export interface ConfigVersion<T = any> {
  id: number;
  firm_id: number | null;
  kind: ConfigKind;
  ckey: string;
  version: number;
  status: 'draft' | 'published' | 'retired';
  effective_from: Date | null;
  payload: T;
  change_note: string | null;
  created_at: Date;
  published_at: Date | null;
}

const mapRow = (r: any): ConfigVersion => ({ ...r, payload: json(r.payload_json, {}) });

const today = () => new Date(new Date().toISOString().slice(0, 10));

/** The version in force for a firm: the firm's own published version if it has one, else the platform's. */
export async function activeConfig<T = any>(kind: ConfigKind, ckey: string, firmId: number | null, tx: Tx = db, asOf = today()): Promise<ConfigVersion<T> | null> {
  for (const scope of firmId === null ? [null] : [firmId, null]) {
    let q = tx
      .selectFrom('config_versions')
      .selectAll()
      .where('kind', '=', kind)
      .where('ckey', '=', ckey)
      .where('status', '=', 'published')
      .where((eb) => eb.or([eb('effective_from', 'is', null), eb('effective_from', '<=', asOf)]))
      .orderBy('version', 'desc')
      .limit(1);
    q = scope === null ? q.where('firm_id', 'is', null) : q.where('firm_id', '=', scope);
    const rows = await q.execute();
    if (rows[0]) return mapRow(rows[0]) as ConfigVersion<T>;
  }
  return null;
}

export async function configById<T = any>(id: number, tx: Tx = db): Promise<ConfigVersion<T>> {
  const r = await tx.selectFrom('config_versions').selectAll().where('id', '=', id).executeTakeFirst();
  if (!r) throw notFound('Configuration version');
  return mapRow(r) as ConfigVersion<T>;
}

export async function listConfig(kind: ConfigKind, firmId: number, ckey?: string, tx: Tx = db) {
  let q = tx
    .selectFrom('config_versions')
    .selectAll()
    .where('kind', '=', kind)
    .where((eb) => eb.or([eb('firm_id', '=', firmId), eb('firm_id', 'is', null)]))
    .orderBy('ckey')
    .orderBy('version', 'desc');
  if (ckey) q = q.where('ckey', '=', ckey);
  return (await q.execute()).map(mapRow);
}

/** Create or update the firm's draft. A firm editing a platform config gets its own copy. */
export async function saveDraft(
  actor: Actor,
  kind: ConfigKind,
  ckey: string,
  payload: unknown,
  note: string | null,
  tx: Tx = db,
): Promise<ConfigVersion> {
  const firmId = actor.firmId;
  const scope = (q: any) => (firmId === null ? q.where('firm_id', 'is', null) : q.where('firm_id', '=', firmId));
  const draft = await scope(tx.selectFrom('config_versions').selectAll().where('kind', '=', kind).where('ckey', '=', ckey).where('status', '=', 'draft')).executeTakeFirst();
  if (draft) {
    await tx.updateTable('config_versions').set({ payload_json: toJson(payload), change_note: note }).where('id', '=', draft.id).execute();
    return configById(draft.id, tx);
  }
  const max = await scope(tx.selectFrom('config_versions').select((eb: any) => eb.fn.max('version').as('v')).where('kind', '=', kind).where('ckey', '=', ckey)).executeTakeFirst();
  // versions are numbered across platform + firm copies so "v3" is unambiguous in the UI
  const globalMax = await tx.selectFrom('config_versions').select((eb) => eb.fn.max('version').as('v')).where('kind', '=', kind).where('ckey', '=', ckey).executeTakeFirst();
  const version = Math.max(Number(max?.v ?? 0), Number(globalMax?.v ?? 0)) + 1;
  const r = await tx
    .insertInto('config_versions')
    .values({ firm_id: firmId, kind, ckey, version, status: 'draft', payload_json: toJson(payload), change_note: note, created_by: actor.id ?? null })
    .executeTakeFirstOrThrow();
  return configById(Number(r.insertId), tx);
}

export async function publishConfig(actor: Actor, id: number, effectiveFrom: Date | null, validate?: (payload: any) => void, tx: Tx = db) {
  const v = await configById(id, tx);
  if (v.firm_id !== actor.firmId) throw notFound('Configuration version');
  if (v.status !== 'draft') throw conflict('Only a draft can be published');
  validate?.(v.payload);
  const eff = effectiveFrom ?? today();
  await tx
    .updateTable('config_versions')
    .set({ status: 'published', effective_from: eff, published_by: actor.id ?? null, published_at: new Date() })
    .where('id', '=', id)
    .execute();
  if (eff <= today()) {
    let q = tx
      .updateTable('config_versions')
      .set({ status: 'retired' })
      .where('kind', '=', v.kind)
      .where('ckey', '=', v.ckey)
      .where('status', '=', 'published')
      .where('id', '!=', id)
      .where('version', '<', v.version);
    q = v.firm_id === null ? q.where('firm_id', 'is', null) : q.where('firm_id', '=', v.firm_id);
    await q.execute();
  }
  await audit(actor, {
    entityType: 'config', entityId: id, action: 'config.publish',
    summary: `${v.kind} "${v.ckey}" v${v.version} published, effective ${eff.toISOString().slice(0, 10)}`,
    reason: v.change_note, after: v.payload,
  }, tx);
  await publishEvent({ type: 'config.published', firmId: actor.firmId, entityType: 'config', entityId: id, payload: { kind: v.kind, ckey: v.ckey, version: v.version } }, tx);
  return configById(id, tx);
}

export async function discardDraft(actor: Actor, id: number, tx: Tx = db) {
  const v = await configById(id, tx);
  if (v.firm_id !== actor.firmId || v.status !== 'draft') throw badRequest('Only your own draft can be discarded');
  await tx.deleteFrom('config_versions').where('id', '=', id).execute();
}
