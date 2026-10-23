// Check engine. Checks are configuration (pinned check set version): built-in checks for facts that
// need code, and expression checks for everything else. Per-bank overrides switch checks off or
// change severity. A critical open check blocks sending to the valuer and signing.
import crypto from 'node:crypto';
import { evalExpr, type Severity } from '@vm/shared';
import { db, json, toJson, type Tx } from '../../db/index.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { audit, type Actor } from '../../platform/audit.js';
import { configById } from '../../platform/config.js';
import { publish } from '../../platform/events.js';
import { getSettings } from '../../platform/settings.js';
import { caseData, EXPR_FNS, type CaseData } from '../casedata/resolver.js';
import { versionFieldCodes } from '../templates/codes.js';

interface CheckDef {
  code: string;
  type: 'builtin' | 'expr';
  builtin?: string;
  enabled: boolean;
  severity: string;                 // builtin: a severity; expr: an expression returning one
  target?: string;
  title: string;
  detail?: string;
  pass_title?: string;
  pass_detail?: string;
  applies?: string;
  fail?: string;
  params?: Record<string, unknown>;
  acceptable?: boolean;             // false: the item can only be resolved, never accepted with a reason
}

interface CheckSetPayload { checks: CheckDef[]; banks: Record<string, Record<string, Partial<CheckDef>>>; accept?: { min_chars?: number; reasons?: string[] } }

interface Result {
  code: string;
  severity: Severity;
  title: string;
  detail: string | null;
  target: string | null;
  actions?: unknown;
}

/** Fields the pinned template prints, minus those filled at sign-off. */
export async function reportFieldCodes(templateVersionId: number | null, tx: Tx = db): Promise<string[]> {
  return (await versionFieldCodes(templateVersionId, tx)).filter((c) => !SIGN_OFF_FIELDS.has(c));
}
export const SIGN_OFF_FIELDS = new Set(['CASE.REPORT_NO', 'REPORT.SIGNATURE']);

const fill = (s: string, vars: Record<string, unknown>) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));

async function builtin(def: CheckDef, data: CaseData, ctx: { site: boolean; valuation: boolean; photos: any[]; profile: any; templateFields: string[]; comps: any[]; firmId: number }, tx: Tx): Promise<Result | Result[] | null> {
  const base = { code: def.code, target: def.target ?? null };
  const sev = def.severity as Severity;
  switch (def.builtin) {
    case 'field_conflicts': {
      const codes = new Set<string>([...ctx.templateFields, ...((ctx.profile.sections ?? []) as any[]).flatMap((s) => s.fields)]);
      const out: Result[] = [];
      for (const code of codes) {
        const r = data.get(code);
        if (r.conflict) out.push({ ...base, code: `${def.code}:${code}`, severity: r.conflict.minor ? 'info' : sev, title: r.conflict.minor ? `${r.label}: one source reads it more fully` : fill(def.title, { label: r.label }), detail: r.conflict.message, actions: { field: code, options: r.conflict.options.map((o) => ({ label: o.label, display: o.display })) } });
      }
      return out;
    }
    case 'low_confidence': {
      // values read from documents that the report prints, read with low confidence and not yet confirmed by a person
      const below = Number(def.params?.below ?? 75);
      const codes = new Set<string>(ctx.templateFields);
      const shaky = [...data.fields.keys()].map((c) => data.get(c)).filter((r) =>
        (r.source === 'document' || r.source === 'site_sheet') && !r.edited && r.confidence !== null && r.confidence < below &&
        r.candidates.every((c) => c.status !== 'accepted') && (codes.has(r.code) || [...codes].some((t) => data.wording.fields?.[t]?.includes(r.code))));
      if (!shaky.length) return null;
      return {
        ...base, severity: sev, title: fill(def.title, { count: shaky.length }), detail: `${shaky.map((r) => `${r.label} (${Math.round(r.confidence!)}%)`).join(', ')}. ${def.detail ?? ''}`,
        actions: { fields: shaky.map((r) => r.code), values: shaky.map((r) => ({ code: r.code, label: r.label, display: r.display, confidence: Math.round(r.confidence!), page: r.page, docType: r.sourceDocType })) },
      };
    }
    case 'pending_fields': {
      const pend = ctx.templateFields.map((c) => data.get(c)).filter((r) => r.state === 'pending');
      if (!pend.length) return { ...base, severity: 'ok', title: 'All report fields filled', detail: null };
      const byReason = new Map<string, string[]>();
      for (const p of pend) byReason.set(p.pendingLabel ?? 'Pending', [...(byReason.get(p.pendingLabel ?? 'Pending') ?? []), p.label]);
      return { ...base, severity: sev, title: fill(def.title, { count: pend.length }), detail: [...byReason].map(([k, v]) => `${k}: ${v.slice(0, 6).join(', ')}${v.length > 6 ? ` and ${v.length - 6} more` : ''}`).join(' · '), actions: { fields: pend.map((p) => p.code) } };
    }
    case 'site_received':
      return ctx.site ? { ...base, severity: 'ok', title: def.pass_title ?? 'Site visit received', detail: null } : { ...base, severity: sev, title: def.title, detail: 'Send the visit link to the field engineer, or upload the sheet and photos received another way.' };
    case 'valuation_done':
      return ctx.valuation ? { ...base, severity: 'ok', title: def.pass_title ?? 'Valuation applied', detail: null } : { ...base, severity: sev, title: def.title, detail: data.get('VAL.PROPOSED_RATE').state === 'filled' ? 'Evidence is ready; apply a rate on the Valuation tab.' : 'Capture market evidence first.', target: data.get('VAL.PROPOSED_RATE').state === 'filled' ? 'val' : 'mkt' };
    case 'photo_count': {
      if (!ctx.site) return null;
      const n = ctx.photos.filter((p) => p.selected).length;
      const min = ctx.profile.min_photos ?? 9;
      const max = ctx.profile.max_photos ?? 18;
      return n >= min && n <= max ? { ...base, severity: 'ok', title: fill(def.pass_title ?? '{count} photos selected', { count: n }), detail: null } : { ...base, severity: sev, title: fill(def.title, { min, max }), detail: `${n} selected now.` };
    }
    case 'photo_names_visible': {
      const hit = ctx.photos.filter((p) => p.selected && p.names_visible);
      return hit.length ? { ...base, severity: sev, title: def.title, detail: def.detail ?? null, actions: { photos: hit.map((p) => p.id) } } : null;
    }
    case 'photo_evidence': {
      if (!ctx.site) return null;
      const eng = ctx.photos.filter((p) => p.source === 'engineer');
      if (!eng.length) return null;
      const maxD = Number(def.params?.max_distance_m ?? 40);
      const problems: string[] = [];
      const geo = eng.filter((p) => p.lat !== null);
      if (geo.length < eng.length) problems.push(`${eng.length - geo.length} photo(s) without location (WhatsApp removes it)`);
      const far = geo.filter((p) => (p.distance_m ?? 0) > maxD);
      if (far.length) problems.push(`${far.length} photo(s) more than ${maxD} m from the map pin`);
      const dates = new Set(eng.filter((p) => p.taken_at).map((p) => new Date(p.taken_at).toISOString().slice(0, 10)));
      if (dates.size > 1) problems.push(`time stamps span ${dates.size} days`);
      if (!eng.some((p) => p.taken_at)) problems.push('no time stamps');
      if (!eng.some((p) => p.is_selfie)) problems.push('no selfie at site');
      const dups = eng.filter((p) => p.duplicate_of).length;
      return problems.length
        ? { ...base, severity: sev, title: def.title, detail: problems.join('; ') + '.' }
        : { ...base, severity: 'ok', title: def.pass_title ?? 'Site visit evidence complete', detail: `All photos geo-tagged within ${maxD} m, time-stamped on the visit date, selfie present${dups ? `; ${dups} duplicate(s) left out` : ''}.` };
    }
    case 'docs_missing': {
      const list = (data.value('DOC.NOT_RECEIVED_LIST') as string[]) ?? [];
      return list.length ? { ...base, severity: sev, title: fill(def.title, { list: list.join(', ') }), detail: def.detail ?? null } : null;
    }
    case 'old_comparables': {
      const old = ctx.comps.filter((c) => c.included && c.age_months !== null && Number(c.age_months) > data.rules.comparable_window_months);
      return old.length ? { ...base, severity: sev, title: fill(def.title, { count: old.length, months: data.rules.comparable_window_months }), detail: `${old.map((c) => `${c.source_ref ?? 'comparable'} (${Math.round(Number(c.age_months))} months, ${c.weight_label} weight)`).join('; ')}. ${def.detail ?? ''}` } : null;
    }
    case 'valuer_registration': {
      const settings = await getSettings(ctx.firmId, tx);
      const v = await tx.selectFrom('users').select(['ibbi_reg_no', 'ibbi_valid_upto']).where('firm_id', '=', ctx.firmId).where('role', '=', 'valuer').where('status', '=', 'active').executeTakeFirst();
      const missing: string[] = [];
      if (!v?.ibbi_reg_no) missing.push('registration no.');
      if (v?.ibbi_valid_upto && new Date(v.ibbi_valid_upto) < new Date()) missing.push('registration has expired');
      if (!settings.signature_file_id) missing.push('signature image');
      if (!settings.seal_file_id) missing.push('seal image');
      return missing.length ? { ...base, severity: sev, title: def.title, detail: `Missing: ${missing.join(', ')}. ${def.detail ?? ''}` } : null;
    }
  }
  return null;
}

function exprCheck(def: CheckDef, data: CaseData): Result | null {
  const res = (n: string) => data.resolver(n);
  if (def.applies && !evalExpr(def.applies, res, EXPR_FNS)) return null;
  const failed = def.fail ? !!evalExpr(def.fail, res, EXPR_FNS) : false;
  if (!failed) {
    if (!def.pass_title) return null;
    return { code: def.code, severity: 'ok', title: data.wordingText(def.pass_title) ?? def.pass_title, detail: def.pass_detail ? data.wordingText(def.pass_detail) : null, target: def.target ?? null };
  }
  const sev = String(evalExpr(def.severity, res, EXPR_FNS) ?? 'warn') as Severity;
  return { code: def.code, severity: ['crit', 'warn', 'ok', 'info'].includes(sev) ? sev : 'warn', title: data.wordingText(def.title) ?? def.title, detail: def.detail ? data.wordingText(def.detail) : null, target: def.target ?? null };
}

export async function runChecks(assignmentId: number, firmId: number, tx: Tx = db) {
  const data = await caseData(assignmentId, firmId, tx);
  if (data.case.signed_at) return summary(assignmentId, tx);
  const cfg = await checkSet(data.case.check_version_id, tx);
  const [site, valuation, photos, comps, templateFields] = await Promise.all([
    tx.selectFrom('site_visits').select('id').where('assignment_id', '=', assignmentId).where('status', '=', 'submitted').executeTakeFirst(),
    tx.selectFrom('valuations').select('id').where('assignment_id', '=', assignmentId).where('is_current', '=', 1).executeTakeFirst(),
    tx.selectFrom('site_photos').selectAll().where('assignment_id', '=', assignmentId).execute(),
    tx.selectFrom('case_comparables as cc').innerJoin('comparables as c', 'c.id', 'cc.comparable_id').select(['cc.id', 'cc.included', 'cc.age_months', 'cc.weight_label', 'c.source_ref']).where('cc.assignment_id', '=', assignmentId).execute(),
    reportFieldCodes(data.case.template_version_id, tx),
  ]);
  const ctx = { site: !!site, valuation: !!valuation, photos, profile: data.profile, templateFields, comps, firmId };
  const bankOverrides = cfg.banks?.[data.case.bank_code] ?? {};
  const results: Result[] = [];
  for (const raw of cfg.checks) {
    const def = { ...raw, ...(bankOverrides[raw.code] ?? {}) } as CheckDef;
    if (!def.enabled) continue;
    try {
      const r = def.type === 'builtin' ? await builtin(def, data, ctx, tx) : exprCheck(def, data);
      const list = r ? (Array.isArray(r) ? r : [r]) : [];
      if ((def.acceptable ?? def.builtin !== 'low_confidence') === false) for (const x of list) x.actions = { ...((x.actions as object) ?? {}), acceptable: false };
      results.push(...list);
    } catch (e) {
      results.push({ code: def.code, severity: 'warn', title: `Check "${def.code}" could not run`, detail: (e as Error).message, target: null });
    }
  }
  const existing = await tx.selectFrom('check_results').selectAll().where('assignment_id', '=', assignmentId).execute();
  const byCode = new Map(existing.map((e) => [e.check_code, e]));
  for (const r of results) {
    const fp = crypto.createHash('sha1').update(`${r.code}|${r.severity}|${r.title}|${r.detail ?? ''}`).digest('hex');
    const prev = byCode.get(r.code);
    const accepted = prev?.status === 'accepted' && prev.fingerprint === fp && r.severity !== 'crit';
    const status = r.severity === 'ok' ? 'passed' : r.severity === 'info' ? 'info' : accepted ? 'accepted' : 'open';
    const row = { severity: r.severity, title: r.title.slice(0, 300), detail: r.detail?.slice(0, 2000) ?? null, target_tab: r.target, actions_json: r.actions ? toJson(r.actions) : null, status, fingerprint: fp } as const;
    if (prev) await tx.updateTable('check_results').set({ ...row, ...(accepted ? {} : { accepted_reason: null, accepted_by: null, accepted_at: null }) }).where('id', '=', prev.id).execute();
    else await tx.insertInto('check_results').values({ assignment_id: assignmentId, check_code: r.code, ...row }).execute();
    byCode.delete(r.code);
  }
  if (byCode.size) await tx.deleteFrom('check_results').where('id', 'in', [...byCode.values()].map((x) => x.id)).execute();
  const s = await summary(assignmentId, tx);
  await publish({ type: 'checks.updated', firmId, entityType: 'assignment', entityId: assignmentId, payload: s }, tx);
  return s;
}

async function checkSet(versionId: number | null, tx: Tx = db): Promise<CheckSetPayload> {
  return versionId ? (await configById<CheckSetPayload>(versionId, tx)).payload : { checks: [], banks: {} };
}

export async function summary(assignmentId: number, tx: Tx = db) {
  const rows = await tx.selectFrom('check_results').selectAll().where('assignment_id', '=', assignmentId).execute();
  const a = await tx.selectFrom('assignments').select('check_version_id').where('id', '=', assignmentId).executeTakeFirst();
  const acc = (await checkSet(a?.check_version_id ?? null, tx)).accept ?? {};
  const order = { crit: 0, warn: 1, info: 2, ok: 3 } as Record<string, number>;
  const sorted = rows.sort((a, b) => order[a.severity] - order[b.severity] || (a.status === 'accepted' ? 1 : 0) - (b.status === 'accepted' ? 1 : 0));
  const crit = rows.filter((r) => r.severity === 'crit' && r.status === 'open').length;
  return {
    blocked: crit > 0,
    crit,
    warn: rows.filter((r) => r.severity === 'warn' && r.status === 'open').length,
    accepted: rows.filter((r) => r.status === 'accepted').length,
    ok: rows.filter((r) => r.severity === 'ok').length,
    info: rows.filter((r) => r.severity === 'info').length,
    items: sorted.map((r) => ({ ...r, actions: json(r.actions_json, null), actions_json: undefined })),
    accept: { minChars: acc.min_chars ?? 15, reasons: acc.reasons ?? [] },
  };
}

/** Accept a warning with a reason (feeds threshold tuning in the learning system). */
export async function acceptCheck(actor: Actor, assignmentId: number, checkId: number, reason: string) {
  reason = reason?.trim() ?? '';
  const a = await db.selectFrom('assignments').select(['id', 'signed_at', 'check_version_id']).where('id', '=', assignmentId).where('firm_id', '=', actor.firmId!).executeTakeFirst();
  if (!a) throw notFound('Assignment');
  if (a.signed_at) throw badRequest('The report is signed and locked. Reopen it to make changes.');
  const c = await db.selectFrom('check_results').selectAll().where('id', '=', checkId).where('assignment_id', '=', assignmentId).executeTakeFirst();
  if (!c) throw notFound('Check');
  if (c.severity === 'crit') throw badRequest('A critical item must be resolved, not accepted');
  if (json<{ acceptable?: boolean } | null>(c.actions_json, null)?.acceptable === false) throw badRequest('This item cannot be accepted. Confirm or correct each value instead.');
  const acc = (await checkSet(a.check_version_id)).accept ?? {};
  const min = acc.min_chars ?? 15;
  if (!(acc.reasons ?? []).includes(reason) && reason.length < min) throw badRequest(`Pick a reason from the list, or write one of at least ${min} characters`);
  await db.updateTable('check_results').set({ status: 'accepted', accepted_reason: reason.trim(), accepted_by: actor.id ?? null, accepted_at: new Date() }).where('id', '=', checkId).execute();
  await db.insertInto('feedback_events').values({ firm_id: actor.firmId!, assignment_id: assignmentId, kind: 'check.override', field_code: c.check_code, before_json: toJson({ severity: c.severity, title: c.title }), after_json: toJson({ accepted: true }), context_json: toJson({ reason }), user_id: actor.id ?? null }).execute();
  await audit(actor, { entityType: 'check', entityId: checkId, assignmentId, action: 'check.accept', summary: `Accepted: ${c.title}`, reason });
}
