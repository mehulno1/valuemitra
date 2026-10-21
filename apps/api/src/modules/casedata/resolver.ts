// Resolves every canonical field for one case from its sources, in the priority order the
// dictionary defines, plus derivations and wording. This single view feeds Extracted details, the
// check engine, the report renderer and the learning system.
import { amountInWords, ddmmyyyy, evalExpr, financialYear, inr, PROPERTY_TYPES, type Resolver } from '@vm/shared';
import { db, json, type Tx } from '../../db/index.js';
import { notFound } from '../../lib/errors.js';
import { configById } from '../../platform/config.js';
import { getSettings } from '../../platform/settings.js';
import { dictionary, type Field } from '../master/dictionary.js';
import { rulesFor, type RuleSetPayload, type Rules } from '../master/rules.js';

export interface Candidate {
  id: number;
  value: string | null;
  num: number | null;
  sourceType: string;
  docType: string | null;
  partId: number | null;
  documentId: number | null;
  page: number | null;
  snippet: string | null;
  snippetLang: string | null;
  confidence: number | null;
  status: string;
  chosen: boolean;
  reason: string | null;
  createdBy: number | null;
  createdAt: Date;
}

export interface Resolved {
  code: string;
  label: string;
  group: string;
  type: string;
  value: unknown;              // raw value used in expressions
  display: string | null;      // formatted for the report
  state: 'filled' | 'pending' | 'not_applicable';
  pendingLabel: string | null;
  source: string | null;       // document, site_sheet, derived, wording, manual, ...
  sourceDocType: string | null;
  page: number | null;
  partId: number | null;
  snippet: string | null;
  confidence: number | null;
  edited: boolean;
  candidates: Candidate[];
  conflict: { message: string; options: { label: string; value: unknown; display: string; basis?: string; code?: string; candidateId?: number }[] } | null;
  formula?: string | null;     // derived arithmetic in words, e.g. "Built-up area 465 ÷ (1 + loading % 20 ÷ 100) = 388"
  ruleKeys?: string[];         // bank rule keys the derivation uses
}

const PENDING_BY_SOURCE: Record<string, string> = {
  oc: 'Awaiting O.C.',
  site_sheet: 'Awaiting site visit',
  valuation: 'Awaiting valuation',
  evidence: 'Awaiting market evidence',
  checklist: 'Awaiting documents',
};

const NUMERIC = new Set(['number', 'area', 'money']);

export function formatValue(type: string, v: unknown, unit?: string | null): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (Array.isArray(v)) return v.join(', ');
  switch (type) {
    case 'money': {
      const n = Number(v);
      if (!Number.isFinite(n)) return String(v);
      if (n === 0) return 'Nil';
      return `Rs. ${inr(n)}/-`;
    }
    case 'area': {
      const n = Number(v);
      return Number.isFinite(n) ? `${inr(n)} ${unit === 'sqm' ? 'sq.m.' : 'sq.ft.'}` : String(v);
    }
    case 'date':
      return ddmmyyyy(String(v)) || String(v);
    case 'number': {
      const n = Number(v);
      return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : String(v);
    }
    default:
      return String(v);
  }
}

function toDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v;
  const s = String(v);
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  const d = m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dms(lat: unknown, lng: unknown): string | null {
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b) || (a === 0 && b === 0)) return null;
  const f = (x: number, pos: string, neg: string) => {
    const v = Math.abs(x);
    const d = Math.floor(v);
    const m = Math.floor((v - d) * 60);
    const s = ((v - d) * 60 - m) * 60;
    return `${d}°${String(m).padStart(2, '0')}'${s.toFixed(1)}"${x >= 0 ? pos : neg}`;
  };
  return `${f(a, 'N', 'S')} ${f(b, 'E', 'W')}`;
}

export const EXPR_FNS: Record<string, (...a: unknown[]) => unknown> = {
  year: (d) => toDate(d)?.getUTCFullYear() ?? null,
  years_between: (a, b) => {
    const x = toDate(a);
    const y = toDate(b) ?? new Date();
    return x ? y.getUTCFullYear() - x.getUTCFullYear() : null;
  },
  date: (d) => { const x = toDate(d); return x ? ddmmyyyy(x) : null; },
  rs: (x) => (x === null || x === undefined || x === '' ? null : `Rs. ${inr(Number(x))}/-`),
  sqft: (x) => (x === null || x === undefined || x === '' ? null : `${inr(Number(x))} sq.ft.`),
  words: (x) => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? null : amountInWords(Number(x))),
  numbered: (list) => {
    const items = (Array.isArray(list) ? list : []).filter((x) => x !== null && x !== undefined && x !== '');
    return items.length ? items.map((x, i) => `${i + 1}) ${x}`).join('\n') : null;
  },
  dms,
};

export interface CaseRecord {
  id: number;
  firm_id: number;
  case_no: string;
  stage: string;
  property_type: string;
  borrower_name: string | null;
  bank_code: string;
  bank_name: string;
  branch_code: string;
  branch_name: string;
  bank_contact: string | null;
  purpose: string;
  created_at: Date;
  report_no: string | null;
  signed_at: Date | null;
  locality_hint: string | null;
  engineer_name: string | null;
  bank_ref_no: string | null;
  draft_version: number;
  rule_version_id: number | null;
  profile_version_id: number | null;
  check_version_id: number | null;
  wording_version_id: number | null;
  template_version_id: number | null;
}

export async function loadCase(assignmentId: number, firmId: number, tx: Tx = db): Promise<CaseRecord> {
  const r = await tx
    .selectFrom('assignments as a')
    .innerJoin('banks as b', 'b.id', 'a.bank_id')
    .innerJoin('bank_branches as br', 'br.id', 'a.branch_id')
    .leftJoin('engineers as e', 'e.id', 'a.engineer_id')
    .select([
      'a.id', 'a.firm_id', 'a.case_no', 'a.stage', 'a.property_type', 'a.borrower_name', 'a.bank_contact', 'a.purpose',
      'a.created_at', 'a.report_no', 'a.signed_at', 'a.locality_hint', 'a.bank_ref_no', 'a.draft_version',
      'a.rule_version_id', 'a.profile_version_id', 'a.check_version_id', 'a.wording_version_id', 'a.template_version_id',
      'b.code as bank_code', 'b.name as bank_name', 'br.code as branch_code', 'br.name as branch_name', 'e.name as engineer_name',
    ])
    .where('a.id', '=', assignmentId)
    .where('a.firm_id', '=', firmId)
    .executeTakeFirst();
  if (!r) throw notFound('Assignment');
  return r as CaseRecord;
}

export interface CaseData {
  case: CaseRecord;
  rules: Rules;
  fields: Map<string, Field>;
  profile: any;
  wording: any;
  get(code: string): Resolved;
  value(code: string): unknown;
  all(codes?: string[]): Resolved[];
  resolver: Resolver;
  wordingText(template: string, extra?: Record<string, unknown>): string | null;
}

/** Build the resolved view of a case. Cheap enough to call per request (a handful of queries). */
export async function caseData(assignmentId: number, firmId: number, tx: Tx = db): Promise<CaseData> {
  const c = await loadCase(assignmentId, firmId, tx);
  const [fields, firm, valuer, settings, values, checklist, visit] = await Promise.all([
    dictionary(firmId, tx),
    tx.selectFrom('firms').selectAll().where('id', '=', firmId).executeTakeFirstOrThrow(),
    tx.selectFrom('users').select(['name', 'qualifications', 'ibbi_reg_no']).where('firm_id', '=', firmId).where('role', '=', 'valuer').where('status', '=', 'active').orderBy('id').executeTakeFirst(),
    getSettings(firmId, tx),
    tx.selectFrom('field_values').selectAll().where('assignment_id', '=', assignmentId).where('is_current', '=', 1).orderBy('id', 'asc').execute(),
    tx.selectFrom('checklist_items').selectAll().where('assignment_id', '=', assignmentId).orderBy('sort_order').execute(),
    tx.selectFrom('site_visits').select(['visit_date', 'submitted_at']).where('assignment_id', '=', assignmentId).where('status', '=', 'submitted').orderBy('id', 'desc').executeTakeFirst(),
  ]);
  const ruleSet = c.rule_version_id ? await configById<RuleSetPayload>(c.rule_version_id, tx) : null;
  const rules = ruleSet ? rulesFor(ruleSet.payload, c.bank_code) : ({} as Rules);
  const profile = c.profile_version_id ? (await configById(c.profile_version_id, tx)).payload : {};
  const wording = c.wording_version_id ? (await configById(c.wording_version_id, tx)).payload : { fields: {}, messages: {} };

  const byCode = new Map<string, Candidate[]>();
  for (const v of values) {
    const list = byCode.get(v.field_code) ?? [];
    list.push({
      id: v.id, value: v.value_text, num: v.value_num, sourceType: v.source_type, docType: v.source_doc_type,
      partId: v.part_id, documentId: v.document_id, page: v.page_no, snippet: v.snippet, snippetLang: v.snippet_lang,
      confidence: v.confidence, status: v.status, chosen: !!v.is_chosen, reason: v.reason, createdBy: v.created_by, createdAt: v.created_at,
    });
    byCode.set(v.field_code, list);
  }

  const reportDate = c.signed_at ?? new Date();
  const fy = financialYear(c.created_at);
  const engineer = c.engineer_name;
  const caseValues: Record<string, unknown> = {
    'CASE.NO': c.case_no,
    'CASE.BANK_NAME': c.bank_name,
    'CASE.BANK_CODE': c.bank_code,
    'CASE.BRANCH_NAME': c.branch_name,
    'CASE.BRANCH_CODE': c.branch_code,
    'CASE.BANK_BRANCH_TITLE': `${c.bank_name.toUpperCase()} – ${c.branch_name.toUpperCase()}`,
    'CASE.BANK_CONTACT': c.bank_contact,
    'CASE.PURPOSE': c.purpose,
    'CASE.APPOINTMENT_DATE': c.created_at.toISOString().slice(0, 10),
    'CASE.REPORT_DATE': reportDate.toISOString().slice(0, 10),
    'CASE.REPORT_NO': c.report_no,
    'CASE.APPLICATION_NO': c.bank_ref_no,
    'CASE.ENGINEER_NAME': engineer,
    'CASE.LOCALITY_HINT': c.locality_hint,
    'CASE.PROPERTY_TYPE_LABEL': PROPERTY_TYPES.find((x) => x.key === c.property_type)?.label ?? c.property_type,
    'CASE.FY': fy.short,
    'CUST.NAME': c.borrower_name,
    'SITE.INSPECTION_DATE': visit ? (visit.visit_date ?? visit.submitted_at)?.toISOString().slice(0, 10) ?? null : null,
  };
  const firmValues: Record<string, unknown> = {
    'FIRM.NAME': firm.name,
    'FIRM.ADDRESS': firm.address,
    'FIRM.VALUER_NAME': valuer?.name ?? null,
    'FIRM.VALUER_QUALS': valuer?.qualifications ?? null,
    'FIRM.VALUER_REG': valuer?.ibbi_reg_no ?? null,
    'FIRM.PLACE': settings.place || firm.city,
    'REPORT.SIGNATURE': c.signed_at ? 'signed' : null,
  };

  const checkLists = () => {
    const got: string[] = [];
    const not: string[] = [];
    for (const i of checklist) {
      if (!i.remark_label) continue;
      if (i.state === 'y') got.push(i.remark_label);
      else if (i.state === 'n') not.push(i.remark_label);
    }
    return { got, not };
  };

  const memo = new Map<string, Resolved>();
  const stack = new Set<string>();

  const parseRaw = (f: Field | undefined, cand: Candidate): unknown => {
    if (!f) return cand.value;
    if (NUMERIC.has(f.type)) return cand.num ?? (cand.value === null ? null : Number(String(cand.value).replace(/[^0-9.\-]/g, '')) || null);
    if (f.type === 'list') return json(cand.value, []);
    return cand.value;
  };

  const resolveIdent = (name: string): unknown => {
    if (name.startsWith('RULE.')) return Object.hasOwn(rules, name.slice(5)) ? (rules as any)[name.slice(5)] ?? null : null;
    if (fields.has(name)) return get(name).value;
    if (Object.hasOwn(caseValues, name)) return caseValues[name];
    if (Object.hasOwn(firmValues, name)) return firmValues[name];
    return null;
  };

  /** Arithmetic derivations in words with the values used; text and conditional ones are not explained. */
  const explain = (expr: string, result: unknown): { formula: string | null; ruleKeys: string[] } => {
    const ruleKeys = [...expr.matchAll(/RULE\.([a-z0-9_]+)/g)].map((m) => m[1]);
    const body = expr.replace(/^\s*round\((.*)\)\s*$/, '$1');
    if (typeof result !== 'number' || !/^[A-Za-z0-9_.\s()+\-*/]+$/.test(body)) return { formula: null, ruleKeys };
    const words = body
      .replace(/[A-Z][A-Z0-9_]*(\.[A-Za-z0-9_]+)+/g, (id) => {
        const v = resolveIdent(id);
        const label = id.startsWith('RULE.') ? id.slice(5).replace(/_pct$/, ' %').replace(/_/g, ' ') : (fields.get(id)?.label ?? id);
        return `${label} ${typeof v === 'number' ? v.toLocaleString('en-IN') : (v ?? '?')}`;
      })
      .replace(/\s*\/\s*/g, ' ÷ ').replace(/\s*\*\s*/g, ' × ');
    return { formula: `${words} = ${result.toLocaleString('en-IN')}`, ruleKeys };
  };

  /** {{ IDENT }} shows the formatted value; any other expression is evaluated on raw values. */
  const wordingText = (template: string, extra: Record<string, unknown> = {}): string | null => {
    let missing = false;
    const out = template.replace(/\{\{([\s\S]+?)\}\}/g, (_, expr: string) => {
      const e = expr.trim();
      let v: unknown;
      if (Object.hasOwn(extra, e)) v = extra[e];
      else if (/^[A-Z][A-Z0-9_]*(\.[A-Z0-9_]+)+$/.test(e) && fields.has(e)) {
        v = get(e).display;
      } else if (/^[A-Z][A-Z0-9_]*(\.[A-Z0-9_]+)+$/.test(e)) {
        v = resolveIdent(e);
      } else {
        v = evalExpr(e, (n) => (Object.hasOwn(extra, n) ? extra[n] : resolveIdent(n)), EXPR_FNS);
      }
      if (v === null || v === undefined) { missing = true; return ''; }
      return Array.isArray(v) ? v.join(', ') : String(v);
    });
    return missing ? null : out;
  };

  function firstPendingDependency(expr: string): string | null {
    const ids = expr.match(/[A-Z][A-Z0-9_]*(\.[A-Z0-9_]+)+/g) ?? [];
    for (const id of ids) {
      if (!fields.has(id)) continue;
      const r = get(id);
      if (r.state === 'pending') return r.pendingLabel;
    }
    return null;
  }

  function get(code: string): Resolved {
    const hit = memo.get(code);
    if (hit) return hit;
    const f = fields.get(code);
    const base: Resolved = {
      code, label: f?.label ?? code, group: f?.group ?? '', type: f?.type ?? 'text', value: null, display: null,
      state: 'pending', pendingLabel: f?.pending ?? null, source: null, sourceDocType: null, page: null, partId: null,
      snippet: null, confidence: null, edited: false, candidates: byCode.get(code) ?? [], conflict: null,
    };
    if (stack.has(code)) return base; // cycle guard: treat as pending
    stack.add(code);
    try {
      const r = compute(f, base);
      if (r.value !== null && r.value !== undefined && r.value !== '' && r.display === null) r.display = formatValue(r.type, r.value, f?.unit);
      if (r.value === null || r.value === undefined || r.value === '') {
        r.state = f && !(f.applies.includes('*') || f.applies.includes(c.property_type)) ? 'not_applicable' : 'pending';
      } else r.state = 'filled';
      memo.set(code, r);
      return r;
    } finally {
      stack.delete(code);
    }
  }

  function setFrom(r: Resolved, f: Field | undefined, cand: Candidate, edited: boolean) {
    r.value = parseRaw(f, cand);
    r.source = cand.sourceType;
    r.sourceDocType = cand.docType;
    r.page = cand.page;
    r.partId = cand.partId;
    r.snippet = cand.snippet;
    r.confidence = cand.confidence;
    r.edited = edited;
  }

  function compute(f: Field | undefined, r: Resolved): Resolved {
    const cands = r.candidates.filter((x) => x.status !== 'rejected' && x.status !== 'superseded');
    // 1. a person's edit wins (most recent)
    const manual = [...cands].reverse().find((x) => x.sourceType === 'manual' || x.sourceType === 'report_edit');
    if (manual) { setFrom(r, f, manual, true); return r; }
    // 2. a candidate a person explicitly chose in a conflict
    const chosen = cands.find((x) => x.chosen);
    if (chosen) { setFrom(r, f, chosen, false); return r; }
    if (!f) {
      if (Object.hasOwn(caseValues, r.code)) { r.value = caseValues[r.code]; r.source = 'case'; }
      else if (Object.hasOwn(firmValues, r.code)) { r.value = firmValues[r.code]; r.source = 'firm'; }
      return r;
    }
    let pending: string | null = f.pending;
    const docCands: Candidate[] = [];
    const DOC_LIKE = (s: string) => !['manual', 'case', 'firm', 'checklist', 'derived', 'wording', 'valuation', 'evidence', 'site_sheet'].includes(s);
    for (const src of f.sources) {
      if (src === 'manual') continue;
      // a document higher in the list already gave the value: later documents are only conflict candidates
      if (r.value !== null && !DOC_LIKE(src)) break;
      if (src === 'case' || src === 'firm') {
        const v = src === 'case' ? caseValues[r.code] : firmValues[r.code];
        if (v !== null && v !== undefined && v !== '') { r.value = v; r.source = src; break; }
        continue;
      }
      if (src === 'checklist') {
        const l = checkLists();
        if (checklist.length) { r.value = r.code === 'DOC.RECEIVED_LIST' ? l.got : l.not; r.source = 'checklist'; break; }
        pending ??= PENDING_BY_SOURCE.checklist;
        continue;
      }
      if (src === 'derived') {
        if (!f.derivation) continue;
        const v = evalExpr(f.derivation, resolveIdent, EXPR_FNS);
        if (v !== null && v !== undefined && v !== '' && !(typeof v === 'number' && !Number.isFinite(v))) {
          r.value = v; r.source = 'derived';
          Object.assign(r, explain(f.derivation, v));
          break;
        }
        pending ??= firstPendingDependency(f.derivation);
        continue;
      }
      if (src === 'wording') {
        const t = wording.fields?.[r.code];
        if (!t) continue;
        const v = wordingText(t);
        if (v !== null) { r.value = v; r.display = v; r.source = 'wording'; break; }
        pending ??= firstPendingDependency(t);
        continue;
      }
      if (src === 'valuation' || src === 'evidence' || src === 'site_sheet') {
        const hit = [...cands].reverse().find((x) => x.sourceType === src);
        if (hit) { setFrom(r, f, hit, false); break; }
        pending ??= PENDING_BY_SOURCE[src] ?? null;
        continue;
      }
      // a document type
      const list = cands.filter((x) => x.sourceType === 'document' && x.docType === src).sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
      if (list.length) {
        docCands.push(...list);
        if (r.value === null) setFrom(r, f, list[0], false);
      } else if (src === 'oc') pending ??= PENDING_BY_SOURCE.oc;
    }
    if (r.value === null) {
      r.pendingLabel = pending ?? 'Awaiting documents';
    }
    // conflicts between documents: same field read differently from two document types
    if (docCands.length > 1 && !r.edited) {
      const norm = (x: Candidate) => (NUMERIC.has(f.type) ? String(parseRaw(f, x)) : String(x.value ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''));
      const distinct = new Map<string, Candidate>();
      for (const d of docCands) if (!distinct.has(norm(d))) distinct.set(norm(d), d);
      const tol = NUMERIC.has(f.type) ? 0.02 : 0;
      const vals = [...distinct.values()];
      const differs = NUMERIC.has(f.type)
        ? vals.some((v) => Math.abs(Number(parseRaw(f, v)) - Number(r.value)) / Math.max(1, Math.abs(Number(r.value))) > tol)
        : vals.length > 1 && f.type !== 'longtext';
      if (differs) {
        r.conflict = {
          message: `${f.label} reads differently in ${vals.map((v) => v.docType).join(' and ')}`,
          options: vals.map((v) => ({ label: v.docType ?? v.sourceType, value: parseRaw(f, v), display: formatValue(f.type, parseRaw(f, v), f.unit) ?? '', candidateId: v.id })),
        };
      }
    }
    // configured agreement rules between derived candidates (e.g. building age from O.C. vs site sheet)
    const agree = f.rules?.agree;
    if (agree && !r.edited) {
      const opts = (agree.candidates as { code: string; basis: string }[])
        .map((cand) => ({ cand, v: get(cand.code).value }))
        .filter((x) => x.v !== null && x.v !== undefined);
      if (opts.length > 1) {
        const nums = opts.map((o) => Number(o.v));
        if (Math.max(...nums) - Math.min(...nums) > (agree.tolerance_abs ?? 0)) {
          r.conflict = {
            message: opts.map((o) => `${fields.get(o.cand.code)?.label ?? o.cand.code}: ${formatValue(f.type, o.v, f.unit)}${f.unit === 'years' ? ' years' : ''}`).join(' · '),
            options: opts.map((o) => ({ label: o.cand.basis, value: o.v, display: `${o.v}${f.unit === 'years' ? ' years' : ''}`, basis: o.cand.basis, code: o.cand.code })),
          };
        }
      }
    }
    return r;
  }

  return {
    case: c,
    rules,
    fields,
    profile,
    wording,
    get,
    value: (code) => get(code).value,
    all: (codes) => (codes ?? [...fields.keys()]).map(get),
    resolver: resolveIdent,
    wordingText,
  };
}
