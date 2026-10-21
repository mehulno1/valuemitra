import { db, toJson, type Tx } from '../db/index.js';

export interface Actor {
  type: 'user' | 'system' | 'engineer' | 'admin';
  id?: number | null;
  name?: string | null;
  firmId: number | null;
  ip?: string | null;
}

export const systemActor = (firmId: number | null): Actor => ({ type: 'system', name: 'System', firmId });

export async function audit(
  actor: Actor,
  e: {
    entityType: string;
    entityId?: string | number | null;
    assignmentId?: number | null;
    action: string;
    summary: string;
    reason?: string | null;
    before?: unknown;
    after?: unknown;
  },
  tx: Tx = db,
) {
  await tx
    .insertInto('audit_log')
    .values({
      firm_id: actor.firmId,
      assignment_id: e.assignmentId ?? null,
      entity_type: e.entityType,
      entity_id: e.entityId === undefined || e.entityId === null ? null : String(e.entityId),
      action: e.action,
      summary: e.summary.slice(0, 1000),
      actor_type: actor.type,
      actor_id: actor.id ?? null,
      actor_name: actor.name ?? null,
      reason: e.reason ?? null,
      before_json: e.before === undefined ? null : toJson(e.before),
      after_json: e.after === undefined ? null : toJson(e.after),
      ip: actor.ip ?? null,
    })
    .execute();
}
