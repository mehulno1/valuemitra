// Domain events: persisted (outbox) and delivered to in-process listeners. New modules subscribe
// without changing the modules that publish.
import { EventEmitter } from 'node:events';
import { db, toJson, type Tx } from '../db/index.js';

export type EventType =
  | 'assignment.created'
  | 'assignment.stage_changed'
  | 'document.received'
  | 'document.read'
  | 'value.changed'
  | 'value.applied'
  | 'site.submitted'
  | 'evidence.read'
  | 'checks.updated'
  | 'report.drafted'
  | 'report.signed'
  | 'report.reopened'
  | 'report.sent'
  | 'template.published'
  | 'config.published';

export interface DomainEvent<P = Record<string, unknown>> {
  type: EventType;
  firmId: number | null;
  entityType?: string;
  entityId?: number | string;
  payload: P;
}

const bus = new EventEmitter();
bus.setMaxListeners(50);

export async function publish(e: DomainEvent, tx: Tx = db) {
  await tx
    .insertInto('events')
    .values({
      firm_id: e.firmId,
      type: e.type,
      entity_type: e.entityType ?? null,
      entity_id: e.entityId === undefined ? null : String(e.entityId),
      payload_json: toJson(e.payload),
    })
    .execute();
  // listeners run after the current tick so they never join the publisher's transaction
  setImmediate(() => bus.emit(e.type, e));
}

export function subscribe<P = Record<string, unknown>>(type: EventType, fn: (e: DomainEvent<P>) => unknown) {
  bus.on(type, (e: DomainEvent<P>) => {
    Promise.resolve()
      .then(() => fn(e))
      .catch((err) => console.error(`[event ${type}] listener failed:`, err));
  });
}
