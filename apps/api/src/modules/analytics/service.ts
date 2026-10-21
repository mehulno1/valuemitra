// Reports & analytics: reports issued per week, turnaround (case created to sent) and time per
// stage, banks, localities, property types and field engineers, from the firm's own signed reports.
import { PROPERTY_TYPES, stageLabel } from '@vm/shared';
import { db } from '../../db/index.js';
import { badRequest } from '../../lib/errors.js';

const HOUR = 3600_000;
const DAY = 86400_000;
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);
const num = (v: unknown) => { const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };

/** Latest value per case for some fields (highest confidence first). */
async function fieldMap(ids: number[], code: string) {
  const out = new Map<number, { text: string | null; num: number | null }>();
  if (!ids.length) return out;
  const rows = await db.selectFrom('field_values').select(['assignment_id', 'value_text', 'value_num']).where('assignment_id', 'in', ids).where('field_code', '=', code).where('is_current', '=', 1).where('status', '!=', 'rejected').orderBy('confidence', 'desc').execute();
  for (const r of rows) if (!out.has(r.assignment_id)) out.set(r.assignment_id, { text: r.value_text, num: r.value_num !== null ? Number(r.value_num) : num(r.value_text) });
  return out;
}

export async function analytics(firmId: number, opts: { weeks: number; bankId?: number | null }) {
  if (![4, 8, 12, 26, 52].includes(opts.weeks)) throw badRequest('Period: 4, 8, 12, 26 or 52 weeks');
  const end = Date.now();
  const from = new Date(end - opts.weeks * 7 * DAY);
  let q = db.selectFrom('report_register as r').innerJoin('assignments as a', 'a.id', 'r.assignment_id').innerJoin('banks as b', 'b.id', 'a.bank_id').innerJoin('bank_branches as br', 'br.id', 'a.branch_id').leftJoin('engineers as e', 'e.id', 'a.engineer_id')
    .select(['r.report_no', 'r.signed_at', 'r.fmv', 'a.id', 'a.case_no', 'a.created_at', 'a.sent_at', 'a.property_type', 'a.locality_hint', 'a.engineer_id', 'b.id as bank_id', 'b.code as bank_code', 'b.short_name as bank_short', 'br.name as branch_name', 'e.name as engineer_name'])
    .where('r.firm_id', '=', firmId).where('r.superseded_at', 'is', null).where('r.signed_at', '>=', from).orderBy('r.signed_at');
  if (opts.bankId) q = q.where('a.bank_id', '=', opts.bankId);
  const reps = await q.execute();
  const ids = reps.map((r) => r.id);
  const [village, guideline, vals, history, visits] = await Promise.all([
    fieldMap(ids, 'PROP.VILLAGE'),
    fieldMap(ids, 'REG.GUIDELINE_VALUE'),
    ids.length ? db.selectFrom('valuations').select(['assignment_id', 'basis_area', 'adopted_rate']).where('assignment_id', 'in', ids).where('is_current', '=', 1).execute() : Promise.resolve([]),
    ids.length ? db.selectFrom('stage_history').select(['assignment_id', 'to_stage', 'created_at']).where('assignment_id', 'in', ids).orderBy('assignment_id').orderBy('id').execute() : Promise.resolve([]),
    db.selectFrom('site_visits as v').innerJoin('assignments as a', 'a.id', 'v.assignment_id').select((eb) => [eb.fn.coalesce('v.engineer_id', 'a.engineer_id').as('engineer_id'), eb.fn.countAll<number>().as('n')])
      .where('a.firm_id', '=', firmId).where('v.status', '=', 'submitted').where('v.submitted_at', '>=', from).$if(!!opts.bankId, (qq) => qq.where('a.bank_id', '=', opts.bankId!))
      .groupBy((eb) => eb.fn.coalesce('v.engineer_id', 'a.engineer_id')).execute(),
  ]);

  const rows = reps.map((r) => {
    const tat = r.sent_at ? (new Date(r.sent_at).getTime() - new Date(r.created_at).getTime()) / HOUR : null;
    const v = vals.find((x) => x.assignment_id === r.id);
    const gv = guideline.get(r.id)?.num ?? null;
    return {
      report_no: r.report_no, signed: new Date(r.signed_at).toISOString().slice(0, 10), case_no: r.case_no, bank: r.bank_code, branch: r.branch_name,
      locality: village.get(r.id)?.text ?? r.locality_hint ?? '', type: PROPERTY_TYPES.find((p) => p.key === r.property_type)?.label ?? r.property_type,
      area: v ? Number(v.basis_area) : null, rate: v ? Number(v.adopted_rate) : null, fmv: r.fmv !== null ? Number(r.fmv) : null, guideline: gv,
      engineer: r.engineer_name ?? '', engineer_id: r.engineer_id, tat_hours: r1(tat), bank_id: r.bank_id, bank_short: r.bank_short ?? r.bank_code,
    };
  });

  // reports per week, the last bar ending today
  const weekly = Array.from({ length: opts.weeks }, (_, k) => {
    const hi = end - (opts.weeks - 1 - k) * 7 * DAY;
    const lo = hi - 7 * DAY;
    return { week_ending: new Date(hi + 5.5 * HOUR).toISOString().slice(0, 10), reports: reps.filter((r) => { const t = new Date(r.signed_at).getTime(); return t > lo && t <= hi; }).length };
  });
  const count = <K extends string>(key: (r: (typeof rows)[number]) => K) => {
    const m = new Map<K, number>();
    for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
    return [...m.entries()].map(([label, reports]) => ({ label, reports })).sort((a, b) => b.reports - a.reports);
  };

  // time spent in each stage before the report was sent
  const per = new Map<string, number[]>();
  const byCase = new Map<number, { to_stage: string; created_at: Date }[]>();
  for (const h of history) (byCase.get(h.assignment_id) ?? byCase.set(h.assignment_id, []).get(h.assignment_id)!).push(h);
  for (const [, hs] of byCase) {
    for (let i = 0; i < hs.length - 1; i++) {
      if (['sent', 'billed', 'paid'].includes(hs[i].to_stage)) continue;
      const hours = (new Date(hs[i + 1].created_at).getTime() - new Date(hs[i].created_at).getTime()) / HOUR;
      (per.get(hs[i].to_stage) ?? per.set(hs[i].to_stage, []).get(hs[i].to_stage)!).push(hours);
    }
  }
  const stages = ['docs', 'site', 'draft', 'review', 'signed'].map((k) => ({ stage: k, label: k === 'signed' ? 'Signed, waiting for dispatch' : stageLabel(k), avg_hours: r1(avg(per.get(k) ?? [])) ?? 0, cases: per.get(k)?.length ?? 0 }));

  const engIds = new Set([...rows.map((r) => r.engineer_id).filter((x): x is number => !!x), ...visits.map((v) => Number(v.engineer_id)).filter(Boolean)]);
  const engNames = engIds.size ? await db.selectFrom('engineers').select(['id', 'name']).where('firm_id', '=', firmId).where('id', 'in', [...engIds]).execute() : [];
  const engineers = engNames.map((e) => {
    const mine = rows.filter((r) => r.engineer_id === e.id);
    return { name: e.name, visits: Number(visits.find((v) => Number(v.engineer_id) === e.id)?.n ?? 0), reports: mine.length, avg_tat_hours: r1(avg(mine.map((r) => r.tat_hours).filter((x): x is number => x !== null))) };
  }).sort((a, b) => b.visits - a.visits);

  const tats = rows.map((r) => r.tat_hours).filter((x): x is number => x !== null);
  const gaps = rows.filter((r) => r.fmv && r.guideline).map((r) => ((r.fmv! - r.guideline!) / r.guideline!) * 100);
  const [cases, sent] = await Promise.all([
    db.selectFrom('assignments').select((eb) => eb.fn.countAll<number>().as('n')).where('firm_id', '=', firmId).where('created_at', '>=', from).$if(!!opts.bankId, (qq) => qq.where('bank_id', '=', opts.bankId!)).executeTakeFirst(),
    db.selectFrom('assignments').select((eb) => eb.fn.countAll<number>().as('n')).where('firm_id', '=', firmId).where('stage', 'not in', ['signed', 'sent', 'billed', 'paid']).$if(!!opts.bankId, (qq) => qq.where('bank_id', '=', opts.bankId!)).executeTakeFirst(),
  ]);
  return {
    weeks: opts.weeks, from: from.toISOString().slice(0, 10),
    kpis: {
      reports: rows.length, perWorkingDay: r1(rows.length / (opts.weeks * 6)) ?? 0, casesCreated: Number(cases?.n ?? 0), inProgress: Number(sent?.n ?? 0),
      avgTatHours: r1(avg(tats)), medianTatHours: tats.length ? r1([...tats].sort((a, b) => a - b)[Math.floor(tats.length / 2)]) : null,
      fmvTotal: rows.reduce((t, r) => t + (r.fmv ?? 0), 0), gvGapPct: r1(avg(gaps)), over20: gaps.filter((g) => Math.abs(g) >= 20).length, withGuideline: gaps.length,
    },
    weekly, banks: count((r) => r.bank_short), localities: count((r) => r.locality || '(not read)').slice(0, 8), types: count((r) => r.type), stages, engineers,
    rows: rows.map(({ engineer_id: _e, bank_id: _b, bank_short: _s, ...r }) => r),
  };
}
