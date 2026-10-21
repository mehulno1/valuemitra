// Assignments (cases): intake, case IDs, configuration pinning, stage machine, board and alerts.
import { fillPattern, financialYear, pad, stageLabel, type Stage } from '@vm/shared';
import { db, json, type Tx } from '../../db/index.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { audit, type Actor } from '../../platform/audit.js';
import { activeConfig } from '../../platform/config.js';
import { publish } from '../../platform/events.js';
import { nextNumber, peekNumber } from '../../platform/sequences.js';
import { getSettings } from '../../platform/settings.js';
import { pickTemplateVersion } from '../templates/service.js';

export interface NewAssignment {
  bankId: number;
  branchId: number;
  bankContact?: string | null;
  receivedVia?: string | null;
  bankRefNo?: string | null;
  borrowerName?: string | null;
  propertyType: string;
  localityHint?: string | null;
  purpose?: string | null;
  engineerId?: number | null;
}

export async function idPreview(firmId: number, bankId?: number, branchId?: number) {
  const fy = financialYear();
  const settings = await getSettings(firmId);
  const firm = await db.selectFrom('firms').select('code').where('id', '=', firmId).executeTakeFirstOrThrow();
  const nextCase = await peekNumber(db, firmId, 'case', fy.short);
  const nextReport = await peekNumber(db, firmId, 'report', fy.short);
  let bank = 'BANK';
  let branch = 'BRANCH';
  if (bankId) bank = (await db.selectFrom('banks').select('code').where('id', '=', bankId).executeTakeFirst())?.code ?? bank;
  if (branchId) branch = (await db.selectFrom('bank_branches').select('code').where('id', '=', branchId).where('firm_id', '=', firmId).executeTakeFirst())?.code ?? branch;
  return {
    caseNo: fillPattern(settings.case_pattern, { FY: fy.short, FYC: fy.compact, N: pad(nextCase) }),
    reportNo: fillPattern(settings.report_pattern, { FIRM: firm.code, BANK: bank, BRANCH: branch, FY: fy.short, N: pad(nextReport) }),
    fy: fy.short,
  };
}

export async function createAssignment(actor: Actor, input: NewAssignment, tx: Tx = db) {
  const firmId = actor.firmId!;
  const branch = await tx.selectFrom('bank_branches').selectAll().where('id', '=', input.branchId).where('firm_id', '=', firmId).executeTakeFirst();
  if (!branch || branch.bank_id !== input.bankId) throw badRequest('Choose a branch of the selected bank');
  if (input.engineerId) {
    const e = await tx.selectFrom('engineers').select('id').where('id', '=', input.engineerId).where('firm_id', '=', firmId).executeTakeFirst();
    if (!e) throw badRequest('Unknown field engineer');
  }
  // pin every configuration this case will use
  const tpl = await pickTemplateVersion(firmId, input.bankId, branch.code, input.propertyType, tx);
  if (!tpl) throw badRequest('No published report format for this bank and property type. Add one under Bank formats.');
  const profile = await activeConfig('profile', input.propertyType, firmId, tx);
  if (!profile) throw badRequest(`No property profile for "${input.propertyType}" yet`);
  const rules = await activeConfig('rule_set', 'firm', firmId, tx);
  const checks = await activeConfig('check_set', 'default', firmId, tx);
  const wording = await activeConfig('wording', 'default', firmId, tx);
  if (!rules || !checks || !wording) throw badRequest('Firm configuration is incomplete (rules, checks or wording)');

  const fy = financialYear();
  const settings = await getSettings(firmId, tx);
  const seq = await nextNumber(tx, firmId, 'case', fy.short);
  const caseNo = fillPattern(settings.case_pattern, { FY: fy.short, FYC: fy.compact, N: pad(seq) });
  const r = await tx.insertInto('assignments').values({
    firm_id: firmId, case_no: caseNo, fy: fy.short, case_seq: seq, bank_id: input.bankId, branch_id: input.branchId,
    bank_contact: input.bankContact ?? (branch.contact_name ? `${branch.contact_name}${branch.contact_role ? ` (${branch.contact_role})` : ''}` : null),
    received_via: input.receivedVia ?? null, bank_ref_no: input.bankRefNo ?? null, borrower_name: input.borrowerName ?? null,
    property_type: input.propertyType, locality_hint: input.localityHint ?? null, purpose: input.purpose ?? 'Home loan',
    engineer_id: input.engineerId ?? null, stage: 'docs', fee: branch.fee,
    template_version_id: tpl.id, profile_version_id: profile.id, rule_version_id: rules.id, check_version_id: checks.id, wording_version_id: wording.id,
    created_by: actor.id!,
  }).executeTakeFirstOrThrow();
  const id = Number(r.insertId);
  await tx.insertInto('stage_history').values({ assignment_id: id, from_stage: null, to_stage: 'docs', actor_id: actor.id ?? null }).execute();

  const items = (profile.payload.checklist ?? []) as any[];
  if (items.length) {
    await tx.insertInto('checklist_items').values(items.map((it, i) => ({
      assignment_id: id, item_code: it.code, label: it.label, remark_label: it.remark ?? null,
      doc_types: JSON.stringify(it.doc_types ?? []), required: it.required ? 1 : 0, state: 'n' as const, auto_state: 'n' as const, sort_order: i,
    }))).execute();
  }
  const eng = input.engineerId ? await tx.selectFrom('engineers').select('name').where('id', '=', input.engineerId).executeTakeFirst() : null;
  await audit(actor, {
    entityType: 'assignment', entityId: id, assignmentId: id, action: 'assignment.create',
    summary: `Case ${caseNo} created${input.receivedVia ? ` from ${input.receivedVia} request` : ''}${input.bankContact ? ` by ${input.bankContact}` : ''}.${eng ? ` Site visit assigned to ${eng.name}.` : ''} Format ${tpl.name} v${tpl.version}.`,
  }, tx);
  await publish({ type: 'assignment.created', firmId, entityType: 'assignment', entityId: id, payload: { caseNo } }, tx);
  return { id, caseNo };
}

export async function updateAssignment(actor: Actor, id: number, patch: Partial<Pick<NewAssignment, 'bankContact' | 'borrowerName' | 'engineerId' | 'purpose' | 'bankRefNo' | 'localityHint'>>, tx: Tx = db) {
  const a = await tx.selectFrom('assignments').selectAll().where('id', '=', id).where('firm_id', '=', actor.firmId!).executeTakeFirst();
  if (!a) throw notFound('Assignment');
  if (a.signed_at) throw badRequest('The report is signed and locked. Reopen it to make changes.');
  const set: Record<string, unknown> = {};
  if (patch.bankContact !== undefined) set.bank_contact = patch.bankContact;
  if (patch.borrowerName !== undefined) set.borrower_name = patch.borrowerName;
  if (patch.engineerId !== undefined) set.engineer_id = patch.engineerId;
  if (patch.purpose !== undefined) set.purpose = patch.purpose;
  if (patch.bankRefNo !== undefined) set.bank_ref_no = patch.bankRefNo;
  if (patch.localityHint !== undefined) set.locality_hint = patch.localityHint;
  if (!Object.keys(set).length) return;
  await tx.updateTable('assignments').set(set).where('id', '=', id).execute();
  await audit(actor, { entityType: 'assignment', entityId: id, assignmentId: id, action: 'assignment.update', summary: `Case details changed: ${Object.keys(set).join(', ')}`, before: Object.fromEntries(Object.keys(set).map((k) => [k, (a as any)[k]])), after: set }, tx);
}

/** Recompute the stage from facts. Billed/paid are owned by the billing module. */
export async function recomputeStage(assignmentId: number, actorId: number | null = null, tx: Tx = db): Promise<Stage> {
  const a = await tx.selectFrom('assignments').select(['id', 'firm_id', 'stage', 'signed_at', 'sent_at']).where('id', '=', assignmentId).executeTakeFirstOrThrow();
  if (a.stage === 'billed' || a.stage === 'paid') return a.stage as Stage;
  const [docs, site, val, crit] = await Promise.all([
    tx.selectFrom('documents').select('id').where('assignment_id', '=', assignmentId).where('role', '=', 'bank_docs').where('status', '=', 'read').limit(1).executeTakeFirst(),
    tx.selectFrom('site_visits').select('id').where('assignment_id', '=', assignmentId).where('status', '=', 'submitted').limit(1).executeTakeFirst(),
    tx.selectFrom('valuations').select('id').where('assignment_id', '=', assignmentId).where('is_current', '=', 1).limit(1).executeTakeFirst(),
    tx.selectFrom('check_results').select('id').where('assignment_id', '=', assignmentId).where('severity', '=', 'crit').where('status', '=', 'open').limit(1).executeTakeFirst(),
  ]);
  let stage: Stage;
  if (a.sent_at) stage = 'sent';
  else if (a.signed_at) stage = 'signed';
  else if (val && !crit) stage = 'review';
  else if (site) stage = 'draft';
  else if (docs) stage = 'site';
  else stage = 'docs';
  if (stage !== a.stage) {
    await tx.updateTable('assignments').set({ stage, stage_changed_at: new Date() }).where('id', '=', assignmentId).execute();
    await tx.insertInto('stage_history').values({ assignment_id: assignmentId, from_stage: a.stage, to_stage: stage, actor_id: actorId }).execute();
    await publish({ type: 'assignment.stage_changed', firmId: a.firm_id, entityType: 'assignment', entityId: assignmentId, payload: { from: a.stage, to: stage } }, tx);
  }
  return stage;
}

export async function board(firmId: number, opts: { stage?: string; q?: string; limit?: number } = {}) {
  let q = db
    .selectFrom('assignments as a')
    .innerJoin('banks as b', 'b.id', 'a.bank_id')
    .innerJoin('bank_branches as br', 'br.id', 'a.branch_id')
    .leftJoin('engineers as e', 'e.id', 'a.engineer_id')
    .select([
      'a.id', 'a.case_no', 'a.borrower_name', 'a.property_type', 'a.locality_hint', 'a.stage', 'a.stage_changed_at', 'a.updated_at', 'a.created_at',
      'a.report_no', 'a.draft_version', 'a.personal_data_removed_at', 'b.code as bank_code', 'b.short_name as bank_short', 'br.name as branch_name', 'br.code as branch_code', 'e.name as engineer_name',
    ])
    .where('a.firm_id', '=', firmId)
    .orderBy('a.updated_at', 'desc')
    .limit(opts.limit ?? 200);
  if (opts.stage) q = q.where('a.stage', '=', opts.stage);
  if (opts.q) q = q.where((eb) => eb.or([eb('a.case_no', 'like', `%${opts.q}%`), eb('a.borrower_name', 'like', `%${opts.q}%`), eb('a.locality_hint', 'like', `%${opts.q}%`)]));
  const rows = await q.execute();
  const ids = rows.map((r) => r.id);
  const docCounts = ids.length
    ? await db.selectFrom('checklist_items').select((eb) => ['assignment_id', eb.fn.countAll<number>().as('total'), eb.fn.sum<number>(eb.case().when('state', '=', 'y').then(1).else(0).end()).as('got')])
        .where('assignment_id', 'in', ids).where('state', '!=', 'na').groupBy('assignment_id').execute()
    : [];
  const address = ids.length
    ? await db.selectFrom('field_values').select(['assignment_id', 'value_text']).where('assignment_id', 'in', ids).where('field_code', '=', 'PROP.ADDRESS').where('is_current', '=', 1).orderBy('confidence', 'desc').execute()
    : [];
  const dc = new Map(docCounts.map((d) => [d.assignment_id, d]));
  const addr = new Map<number, string>();
  for (const a of address) if (!addr.has(a.assignment_id) && a.value_text) addr.set(a.assignment_id, a.value_text);
  const counts = await db.selectFrom('assignments').select((eb) => ['stage', eb.fn.countAll<number>().as('n')]).where('firm_id', '=', firmId).groupBy('stage').execute();
  return {
    rows: rows.map((r) => ({
      ...r,
      borrower_name: r.personal_data_removed_at ? '(personal data removed)' : r.borrower_name,
      stage_label: stageLabel(r.stage),
      property: addr.get(r.id) ?? r.locality_hint,
      docs_got: Number(dc.get(r.id)?.got ?? 0),
      docs_total: Number(dc.get(r.id)?.total ?? 0),
    })),
    counts: Object.fromEntries(counts.map((c) => [c.stage, Number(c.n)])),
  };
}

const HOURS = 3600_000;

/** Overdue items with a ready reminder message. Thresholds are hours since the stage began. */
export async function alerts(firmId: number) {
  const rows = await db
    .selectFrom('assignments as a')
    .innerJoin('banks as b', 'b.id', 'a.bank_id')
    .innerJoin('bank_branches as br', 'br.id', 'a.branch_id')
    .leftJoin('engineers as e', 'e.id', 'a.engineer_id')
    .select(['a.id', 'a.case_no', 'a.stage', 'a.stage_changed_at', 'a.borrower_name', 'a.bank_contact', 'b.code as bank_code', 'br.name as branch_name', 'e.name as engineer_name', 'a.sent_for_review_at'])
    .where('a.firm_id', '=', firmId)
    .where('a.stage', 'in', ['docs', 'site', 'draft', 'review', 'signed'])
    .execute();
  const now = Date.now();
  const out: { severity: 'crit' | 'warn' | 'info'; assignmentId: number; caseNo: string; title: string; detail: string; action: string; purpose: string }[] = [];
  for (const r of rows) {
    const h = Math.floor((now - new Date(r.stage_changed_at).getTime()) / HOURS);
    if (r.stage === 'docs' && h >= 4) out.push({ severity: h >= 24 ? 'crit' : 'warn', assignmentId: r.id, caseNo: r.case_no, title: `${r.case_no} · awaiting documents ${h} h`, detail: `${r.bank_code} ${r.branch_name}`, action: 'Draft reminder to bank', purpose: 'doc_reminder' });
    else if (r.stage === 'site' && h >= 6) out.push({ severity: h >= 24 ? 'crit' : 'warn', assignmentId: r.id, caseNo: r.case_no, title: `${r.case_no} · site visit pending ${h} h`, detail: `${r.bank_code} ${r.branch_name}${r.engineer_name ? ` · engineer ${r.engineer_name}` : ''}`, action: 'Remind engineer', purpose: 'engineer_link' });
    else if (r.stage === 'review' && r.sent_for_review_at && now - new Date(r.sent_for_review_at).getTime() >= 4 * HOURS) out.push({ severity: 'info', assignmentId: r.id, caseNo: r.case_no, title: `${r.case_no} · waiting for valuer ${Math.floor((now - new Date(r.sent_for_review_at).getTime()) / HOURS)} h`, detail: 'Ready for review', action: 'Open case', purpose: 'open' });
    else if (r.stage === 'signed' && h >= 2) out.push({ severity: 'warn', assignmentId: r.id, caseNo: r.case_no, title: `${r.case_no} · signed, not dispatched`, detail: 'Email and hard copy pending', action: 'Open output', purpose: 'output' });
  }
  const rank = { crit: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 8);
}

export async function assignmentHeader(firmId: number, id: number) {
  const a = await db
    .selectFrom('assignments as a')
    .innerJoin('banks as b', 'b.id', 'a.bank_id')
    .innerJoin('bank_branches as br', 'br.id', 'a.branch_id')
    .leftJoin('engineers as e', 'e.id', 'a.engineer_id')
    .leftJoin('template_versions as tv', 'tv.id', 'a.template_version_id')
    .leftJoin('report_templates as t', 't.id', 'tv.template_id')
    .select([
      'a.id', 'a.case_no', 'a.borrower_name', 'a.property_type', 'a.locality_hint', 'a.purpose', 'a.stage', 'a.created_at', 'a.updated_at', 'a.bank_contact',
      'a.received_via', 'a.bank_ref_no', 'a.engineer_id', 'a.report_no', 'a.report_rev', 'a.signed_at', 'a.sent_at', 'a.sent_for_review_at', 'a.draft_version',
      'a.personal_data_removed_at', 'a.bank_id', 'a.branch_id', 'a.fee',
      'b.code as bank_code', 'b.name as bank_name', 'br.code as branch_code', 'br.name as branch_name', 'br.contact_email', 'e.name as engineer_name', 'e.phone as engineer_phone',
      't.name as template_name', 'tv.version as template_version',
    ])
    .where('a.id', '=', id)
    .where('a.firm_id', '=', firmId)
    .executeTakeFirst();
  if (!a) throw notFound('Assignment');
  const stages = await db.selectFrom('stage_history').select(['from_stage', 'to_stage', 'created_at']).where('assignment_id', '=', id).orderBy('id').execute();
  return { ...a, stage_label: stageLabel(a.stage), stages, borrower_name: a.personal_data_removed_at ? '(personal data removed)' : a.borrower_name };
}

export async function activity(firmId: number, id: number) {
  return db
    .selectFrom('audit_log')
    .select(['id', 'action', 'summary', 'actor_type', 'actor_name', 'reason', 'created_at'])
    .where('firm_id', '=', firmId)
    .where('assignment_id', '=', id)
    .orderBy('id', 'desc')
    .limit(500)
    .execute();
}

export const profileChecklist = (payload: any) => json<any[]>(payload?.checklist, []);
