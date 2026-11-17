// Case workflow (Universal review A1, B5): coordinator → Report Maker → Report Checker → valuer. Each
// hand-over is one step with an optional note and runs only its own checks; anyone downstream can send the
// case back with a reason. The stage still follows the facts of the case; `holder` says who has it now.
import { getSettings } from '../../platform/settings.js';
import { HOLDER_LABEL, isCoordinator, type Holder } from '@vm/shared';
import { db, type Tx } from '../../db/index.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { audit, type Actor } from '../../platform/audit.js';
import { publish } from '../../platform/events.js';
import { recomputeStage } from '../assignments/service.js';
import { runChecks } from '../checks/engine.js';

type Who = Actor & { role?: string };
const ORDER: Holder[] = ['coordinator', 'maker', 'checker', 'valuer'];

/** Check targets each hand-over waits on (B5): intake before the maker, drafting before the checker,
 *  everything but sign-off before the valuer; signing itself needs all. */
const GATE: Record<Exclude<Holder, 'coordinator'>, string[] | 'all_but_rep'> = {
  // 13 Nov re-test (A1): the coordinator only creates and assigns; documents and the site visit can come later,
  // from anyone on the case, so nothing holds up the hand-over to the report maker
  maker: [],
  checker: ['docs', 'ext', 'site', 'mkt', 'val'],
  valuer: 'all_but_rep',
};

async function load(firmId: number, id: number, tx: Tx) {
  const a = await tx.selectFrom('assignments').selectAll().where('id', '=', id).where('firm_id', '=', firmId).executeTakeFirst();
  if (!a) throw notFound('Assignment');
  return a;
}
const userName = async (id: number | null, tx: Tx) => (id ? (await tx.selectFrom('users').select('name').where('id', '=', id).executeTakeFirst())?.name ?? null : null);

/** The coordinator (or valuer) picks the Report Maker and Report Checker. A Report Checker may also make
 *  a case; nobody checks a case they made. */
export async function assignPeople(actor: Actor, id: number, input: { makerId?: number | null; checkerId?: number | null }, tx: Tx = db) {
  const a = await load(actor.firmId!, id, tx);
  if (a.signed_at) throw badRequest('The report is signed and locked. Reopen it to make changes.');
  const set: Record<string, number | null> = {};
  const check = async (uid: number | null | undefined, roles: string[], what: string) => {
    if (uid === undefined || uid === null) return;
    const u = await tx.selectFrom('users').select(['id', 'role', 'status']).where('id', '=', uid).where('firm_id', '=', actor.firmId!).executeTakeFirst();
    if (!u || u.status !== 'active') throw badRequest(`Choose an active user as ${what}`);
    if (!roles.includes(u.role)) throw badRequest(`${what}: needs the ${roles.map((r) => (r === 'maker' ? 'Report Maker' : r === 'checker' ? 'Report Checker' : 'Valuer')).join(', ')} role`);
  };
  await check(input.makerId, ['maker', 'checker', 'valuer'], 'Report maker');
  await check(input.checkerId, ['checker', 'valuer'], 'Report checker');
  if (input.makerId !== undefined) set.maker_id = input.makerId;
  if (input.checkerId !== undefined) set.checker_id = input.checkerId;
  // segregation of duties: the case's own report maker or checker cannot change who checks or makes it (only someone
  // with "assign", or the valuer)
  const perms = actor.id ? (await tx.selectFrom('user_permissions').select('perm').where('user_id', '=', actor.id).execute()).map((p) => p.perm) : [];
  const role = actor.id ? (await tx.selectFrom('users').select('role').where('id', '=', actor.id).executeTakeFirst())?.role : null;
  const mayAssign = perms.includes('assign') || role === 'valuer' || role === 'admin';
  if (!mayAssign && actor.id && (actor.id === a.maker_id || actor.id === a.checker_id) && ((set.checker_id !== undefined && set.checker_id !== a.checker_id) || (set.maker_id !== undefined && set.maker_id !== a.maker_id)))
    throw forbidden('The report maker or checker of a case cannot change who makes or checks it. Ask the coordinator or the valuer.');
  const maker = set.maker_id !== undefined ? set.maker_id : a.maker_id;
  const checker = set.checker_id !== undefined ? set.checker_id : a.checker_id;
  if (maker && checker && maker === checker) throw badRequest('A report maker cannot check their own case. Choose another checker.');
  if (!Object.keys(set).length) return;
  await tx.updateTable('assignments').set(set).where('id', '=', id).execute();
  const parts = [
    set.maker_id !== undefined ? `report maker ${(await userName(set.maker_id, tx)) ?? 'removed'}` : null,
    set.checker_id !== undefined ? `report checker ${(await userName(set.checker_id, tx)) ?? 'removed'}` : null,
  ].filter(Boolean);
  await audit(actor, { entityType: 'assignment', entityId: id, assignmentId: id, action: 'workflow.assign', summary: `Assigned: ${parts.join(', ')}.`, before: { maker_id: a.maker_id, checker_id: a.checker_id }, after: set }, tx);
}

/** May this user act for the case's current holder? */
function actsForHolder(actor: Who, a: { holder: string; maker_id: number | null; checker_id: number | null }) {
  if (actor.role === 'valuer') return true;
  if (a.holder === 'coordinator') return isCoordinator(actor.role) || actor.role === 'admin';
  if (a.holder === 'maker') return actor.id === a.maker_id;
  if (a.holder === 'checker') return actor.id === a.checker_id;
  return false;
}

/** Next holder forward: maker, checker or valuer; steps without a person assigned are skipped. */
export async function handOver(actor: Who, id: number, to: Exclude<Holder, 'coordinator'>, note: string | null) {
  const res = await db.transaction().execute(async (tx) => {
    const a = await load(actor.firmId!, id, tx);
    if (a.signed_at) throw badRequest('The report is already signed');
    if (!actsForHolder(actor, a)) throw forbidden(`${HOLDER_LABEL[a.holder as Holder]}: only they (or the valuer) can hand it over`);
    if (ORDER.indexOf(to) <= ORDER.indexOf(a.holder as Holder)) throw badRequest('Use "Send back" to return the case to an earlier step');
    if (to === 'maker' && !a.maker_id) throw badRequest('Assign a report maker first');
    if (to === 'checker' && !a.checker_id) throw badRequest('Assign a report checker first');
    // skipping a step is allowed only when nobody is assigned to it, and only when the firm allows it (#7)
    if (ORDER.indexOf(to) > ORDER.indexOf(a.holder as Holder) + 1 && (await getSettings(actor.firmId!, tx)).skip_unassigned_steps === false) {
      const step = ORDER[ORDER.indexOf(a.holder as Holder) + 1];
      throw badRequest(step === 'maker' ? 'Assign a report maker and send the case to them first' : 'Assign a report checker and send the case to them first');
    }
    for (const skipped of ORDER.slice(ORDER.indexOf(a.holder as Holder) + 1, ORDER.indexOf(to))) {
      if ((skipped === 'maker' && a.maker_id) || (skipped === 'checker' && a.checker_id)) throw badRequest(`The case goes to the ${skipped === 'maker' ? 'report maker' : 'report checker'} first`);
    }
    return a;
  });
  // the checks of this step (B5): the coordinator is not held up by valuation checks
  const s = await runChecks(id, actor.firmId!);
  const gate = GATE[to];
  const open = s.items.filter((i: any) => i.severity === 'crit' && i.status === 'open' && (gate === 'all_but_rep' ? i.target_tab !== 'rep' : gate.includes(i.target_tab)));
  const why: string[] = open.map((i: any) => i.title);
  if (to === 'checker' || to === 'valuer') {
    const v = await db.selectFrom('valuations').select('id').where('assignment_id', '=', id).where('is_current', '=', 1).executeTakeFirst();
    if (!v && !why.some((w) => /valuation/i.test(w))) why.push('Valuation not applied yet');
  }
  if (why.length) throw badRequest(`Before handing to the ${to === 'maker' ? 'report maker' : to === 'checker' ? 'report checker' : 'valuer'}: ${why.join('; ')}`);
  await db.transaction().execute(async (tx) => {
    const now = new Date();
    await tx.updateTable('assignments').set({ holder: to, handed_at: now, ...(to === 'valuer' ? { sent_for_review_at: now } : {}) }).where('id', '=', id).execute();
    const who = to === 'maker' ? await userName(res.maker_id, tx) : to === 'checker' ? await userName(res.checker_id, tx) : 'the valuer';
    await audit(actor, { entityType: 'assignment', entityId: id, assignmentId: id, action: 'workflow.handover', summary: `Handed over to ${who}${to === 'maker' ? ' (report maker)' : to === 'checker' ? ' (report checker)' : ''}.`, reason: note, before: { holder: res.holder }, after: { holder: to } }, tx);
    await publish({ type: 'assignment.handover', firmId: actor.firmId, entityType: 'assignment', entityId: id, payload: { from: res.holder, to } }, tx);
    await recomputeStage(id, actor.id ?? null, tx);
  });
}

/** Created and sent to the report maker in one step (A1): no documents or site visit needed. */
export async function handOverOnCreate(actor: Actor, id: number, note: string | null, tx: Tx) {
  const a = await load(actor.firmId!, id, tx);
  if (!a.maker_id) return;
  await tx.updateTable('assignments').set({ holder: 'maker', handed_at: new Date() }).where('id', '=', id).execute();
  await audit(actor, { entityType: 'assignment', entityId: id, assignmentId: id, action: 'workflow.handover', summary: `Handed over to ${await userName(a.maker_id, tx)} (report maker).`, reason: note, before: { holder: a.holder }, after: { holder: 'maker' } }, tx);
  await publish({ type: 'assignment.handover', firmId: actor.firmId, entityType: 'assignment', entityId: id, payload: { from: a.holder, to: 'maker' } }, tx);
}

/** Back to an earlier step, always with a reason. */
export async function sendBack(actor: Who, id: number, to: Holder, reason: string) {
  if ((reason ?? '').trim().length < 5) throw badRequest('Say why the case goes back (a few words)');
  await db.transaction().execute(async (tx) => {
    const a = await load(actor.firmId!, id, tx);
    if (a.signed_at) throw badRequest('The report is signed. Reopen it first.');
    if (!actsForHolder(actor, a)) throw forbidden('Only the person who has the case (or the valuer) can send it back');
    if (ORDER.indexOf(to) >= ORDER.indexOf(a.holder as Holder)) throw badRequest('Send back goes to an earlier step');
    if (to === 'maker' && !a.maker_id) throw badRequest('No report maker on this case');
    if (to === 'checker' && !a.checker_id) throw badRequest('No report checker on this case');
    await tx.updateTable('assignments').set({ holder: to, handed_at: new Date(), ...(a.holder === 'valuer' ? { sent_for_review_at: null } : {}) }).where('id', '=', id).execute();
    await audit(actor, { entityType: 'assignment', entityId: id, assignmentId: id, action: 'workflow.send_back', summary: `Sent back to the ${to === 'maker' ? 'report maker' : to === 'checker' ? 'report checker' : to}.`, reason: reason.trim(), before: { holder: a.holder }, after: { holder: to } }, tx);
    await publish({ type: 'assignment.send_back', firmId: actor.firmId, entityType: 'assignment', entityId: id, payload: { from: a.holder, to } }, tx);
  });
}
