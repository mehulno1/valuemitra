// Event listeners that keep a case consistent: when documents, values, site data or evidence change,
// update the draft version, ready reckoner, evidence proposal, checks and stage. Modules publish
// events; they do not call each other for this.
import { db } from '../../db/index.js';
import { audit, systemActor } from '../../platform/audit.js';
import { subscribe, type DomainEvent } from '../../platform/events.js';
import { recomputeStage } from '../assignments/service.js';
import { runChecks } from '../checks/engine.js';
import { lookupReadyReckoner, refreshEvidence } from '../valuation/service.js';

const pending = new Map<number, { timer: NodeJS.Timeout; bump: boolean; evidence: boolean; reason: string[] }>();

function schedule(e: DomainEvent, opts: { bump?: boolean; evidence?: boolean; reason?: string }) {
  const id = Number(e.entityId);
  if (!id || e.entityType !== 'assignment') return;
  const prev = pending.get(id);
  if (prev) clearTimeout(prev.timer);
  const state = { bump: !!prev?.bump || !!opts.bump, evidence: !!prev?.evidence || !!opts.evidence, reason: [...(prev?.reason ?? []), ...(opts.reason ? [opts.reason] : [])] };
  pending.set(id, { ...state, timer: setTimeout(() => void settle(id, e.firmId!, state), 600) });
}

async function settle(id: number, firmId: number, s: { bump: boolean; evidence: boolean; reason: string[] }) {
  pending.delete(id);
  try {
    const a = await db.selectFrom('assignments').select(['signed_at', 'draft_version']).where('id', '=', id).executeTakeFirst();
    if (!a || a.signed_at) return;
    if (s.evidence) {
      await lookupReadyReckoner(id, firmId);
      await refreshEvidence(id, firmId);
    }
    if (s.bump) {
      const v = a.draft_version + 1;
      await db.updateTable('assignments').set({ draft_version: v }).where('id', '=', id).execute();
      await audit(systemActor(firmId), { entityType: 'report', assignmentId: id, action: 'report.draft', summary: `Draft report ${v === 1 ? 'v1 created' : `updated to v${v}`}${s.reason.length ? `: ${[...new Set(s.reason)].join(', ')}` : ''}.` });
    }
    await runChecks(id, firmId);
    await recomputeStage(id);
  } catch (err) {
    console.error(`[workflow] settle ${id} failed`, err);
  }
}

export function registerListeners() {
  subscribe('document.read', (e) => schedule(e, { bump: true, evidence: true, reason: 'documents read' }));
  subscribe('site.submitted', (e) => schedule(e, { bump: true, reason: 'site visit' }));
  subscribe('evidence.read', (e) => schedule(e, { reason: 'market evidence' }));
  subscribe('value.changed', (e) => schedule(e, { evidence: true }));
  subscribe('value.applied', (e) => schedule(e, {}));
  subscribe('report.reopened', (e) => schedule(e, {}));
}
