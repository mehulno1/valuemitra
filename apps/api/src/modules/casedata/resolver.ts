// Resolves every canonical field for one case from its sources, in the priority order the
// dictionary defines, plus derivations and wording. This single view feeds Extracted details, the
// check engine, the report renderer and the learning system.
import { amountInWords, ddmmyyyy, evalExpr, financialYear, inr, PROPERTY_TYPES, type Resolver } from '@vm/shared';
import { db, json, type Tx } from '../../db/index.js';
import { notFound } from '../../lib/errors.js';
import { activeConfig, configById } from '../../platform/config.js';
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
  conflict: { message: string; minor?: boolean; chosenId?: number | null; options: { label: string; value: unknown; display: string; basis?: string; code?: string; candidateId?: number }[] } | null;
  notProvided?: boolean;       // its documents are marked not provided / not applicable on the checklist
  formula?: string | null;     // derived arithmetic in words, e.g. "Built-up area 465 ÷ (1 + loading % 20 ÷ 100) = 388"
  ruleKeys?: string[];         // bank rule keys the derivation uses
  options?: string[];          // the choices of an enum field (a dropdown on Extracted details)
  blanked?: boolean;           // a placeholder was typed ("NA", "0"): treated as no value, never pending
  record?: string | null;      // a line built from a record (O.C. / C.C.): corrected through the record, not here
  preferred?: string;          // the value came from this other field (Carpet area ← RERA carpet area)
  earlierEdit?: string;        // text typed into a record line before it was built from the record (kept to compare)
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
      if (!Number.isFinite(n)) return String(v);
      return unit === 'sqm' ? `${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })} sq.m.` : `${inr(n)} sq.ft.`;
    }
    case 'date':
      return ddmmyyyy(String(v)) || String(v);
    case 'number': {
      const n = Number(v);
      return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : String(v);
    }
    default:
      // a date read into a text field ("Proposed date of completion": 2026-12-31) prints as dates do
      return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? ddmmyyyy(String(v)) || String(v) : String(v);
  }
}

export interface WorkWeight { key: string; label: string; weight: number; per_floor?: boolean }
export interface WorkStage { key: string; pct: number; note?: string | null }

/** Stage of each activity as stored (JSON text or a list): [{ key, pct 0-100, note }]. */
export function parseStages(v: unknown): WorkStage[] {
  let list: unknown = v;
  if (typeof v === 'string') { try { list = JSON.parse(v); } catch { return []; } }
  if (!Array.isArray(list)) return [];
  return list.filter((x) => x && typeof x === 'object' && typeof (x as any).key === 'string' && Number.isFinite(Number((x as any).pct)))
    .map((x: any) => ({ key: String(x.key), pct: Math.max(0, Math.min(100, Number(x.pct))), note: x.note ? String(x.note) : null }));
}

/** % of work completed: each activity's weight × its completion, summed over the firm's weightage table, then
 *  rounded to the nearest `step` with halves up (62.5 → 65). Null until any activity has a stage. */
export function workPct(stagesIn: unknown, weightsIn: unknown, stepIn?: unknown) {
  const weights = (Array.isArray(weightsIn) ? weightsIn : []) as WorkWeight[];
  const stages = new Map(parseStages(stagesIn).map((x) => [x.key, x]));
  const total = weights.reduce((t, w) => t + (Number(w.weight) || 0), 0);
  if (!total || !weights.some((w) => stages.has(w.key))) return null;
  const rows = weights.map((w) => {
    const st = stages.get(w.key);
    const pct = st?.pct ?? 0;
    return { key: w.key, label: w.label, weight: Math.round((Number(w.weight) / total) * 10000) / 100, pct, note: st?.note ?? null, weighted: Math.round((Number(w.weight) / total) * pct * 100) / 100, per_floor: !!w.per_floor };
  });
  const raw = Math.round(rows.reduce((t, r) => t + r.weighted, 0) * 100) / 100;
  const step = Number(stepIn) > 0 ? Number(stepIn) : 1;
  return { rows, raw, step, pct: Math.min(100, Math.floor(raw / step + 0.5) * step) };
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

/** Text compared for conflicts: titles dropped, common abbreviations spelled one way (S.No. = Survey No., (P) = Part). */
export function sameText(v: unknown): string {
  return ` ${String(v ?? '').toLowerCase()} `
    .replace(/[.,]/g, ' ')
    .replace(/\b(mr|mrs|ms|miss|shri|shree|smt|kum|kumari|dr|m\/s|late)\b/g, ' ')
    .replace(/\b(s|sr|survey|sy)\s*(no|number)\b/g, ' survey ')
    .replace(/\b(h|hissa)\s*(no|number)\b/g, ' hissa ')
    .replace(/\b(c\s*t\s*s|cts)\s*(no|number)?\b/g, ' cts ')
    .replace(/\(\s*(p|pt|part)\s*\)|\bpt\b/g, ' part ')
    .replace(/\b(flat|unit|shop|office)\s*(no|number)\b/g, ' $1 ')
    .replace(/[^a-z0-9ऀ-ॿ]/g, '');
}

export const EXPR_FNS: Record<string, (...a: unknown[]) => unknown> = {
  year: (d) => toDate(d)?.getUTCFullYear() ?? null,
  years_between: (a, b) => {
    const x = toDate(a);
    const y = toDate(b) ?? new Date();
    return x ? y.getUTCFullYear() - x.getUTCFullYear() : null;
  },
  /** whole days from a to b (negative when b is earlier) */
  days_between: (a, b) => { const x = toDate(a); const y = toDate(b); return x && y ? Math.round((y.getTime() - x.getTime()) / 86400_000) : null; },
  date: (d) => { const x = toDate(d); return x ? ddmmyyyy(x) : null; },
  /** financial year of a date, as ready reckoner years are labelled: 2026-27 */
  fy: (d) => { const x = toDate(d); return x ? `${financialYear(x).start}-${financialYear(x).short.slice(3)}` : null; },
  rs: (x) => (x === null || x === undefined || x === '' ? null : `Rs. ${inr(Number(x))}/-`),
  sqft: (x) => (x === null || x === undefined || x === '' ? null : `${inr(Number(x))} sq.ft.`),
  words: (x) => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? null : amountInWords(Number(x))),
  numbered: (list) => {
    const items = (Array.isArray(list) ? list : []).filter((x) => x !== null && x !== undefined && x !== '');
    return items.length ? items.map((x, i) => `${i + 1}) ${x}`).join('\n') : null;
  },
  dms,
  /** upper floors of a building from "Stilt + 1st to 16th upper floors" (16) or "Ground + 5 podiums + 6th to
   *  36th floors" (31) or "G + 7" (7); podiums, stilts and amenity floors do not count (insurance band, A7) */
  upper_floors: (t) => upperFloors(t),
  work_pct: (stages, weights, step) => workPct(stages, weights, step)?.pct ?? null,
  /** bedrooms of a "2 BHK" / "1.5 BHK" / "1 RK" configuration (1 RK: 0) */
  bhk: (t) => { const m = /(\d+(?:\.5)?)\s*(?:b\.?\s*h\.?\s*k|bed)/i.exec(String(t ?? '')); return m ? Math.floor(Number(m[1])) : null; },
  pad2: (x) => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? null : String(Math.round(Number(x))).padStart(2, '0')),
  /** a Yes / No answer from words: "no", "Not displayed" → No; "yes", "displayed on the board" → Yes (C5) */
  yes_no: (t) => {
    const s = String(t ?? '').trim().toLowerCase();
    if (!s) return null;
    if (/^(no|n|nil|none|absent|not\b)|\bnot\s+(displayed|seen|visible|available|found)|\bno\s+name/.test(s)) return 'No';
    if (/^(yes|y)\b|displayed|seen|visible|available/.test(s)) return 'Yes';
    return null;
  },
  /** a company, firm or builder rather than a person (Pvt. Ltd., LLP, Developers, Builders, Constructions, Realty) */
  is_company: (t) => /\b(pvt|private|ltd|limited|llp|developers?|builders?|constructions?|realty|realtors?|infra(structure)?|estates?|homes|associates|enterprises?|corporation|co-?op|housing|grihanirman|nirman|promoters?)\b/i.test(String(t ?? '')),
  /** a placeholder typed to get past a screen ("NA", "0", "Ok", "Not provided (clear copy required)") */
  placeholder: (t) => isPlaceholder(t, true),
  /** the revenue village written in an address: "…, Village Vasind, Tal. Shahapur" → "Vasind" (D5) */
  village_from: (t) => { const m = /\b(?:village|vill\.|mouje|mauje|mouza|revenue village)\s*[:\-]?\s*([A-Za-z][A-Za-z .'-]*?)\s*(?=,|;|\(|\btal\b|\btaluka\b|\bdist\b|\bdistrict\b|$)/i.exec(String(t ?? '')); return m ? m[1].replace(/\.$/, '').trim() || null : null; },
  /** the first area in square metres written in a text: "37.36 sq.m. (RERA carpet) + balcony 2.77 sq.m." → 37.36 */
  first_sqm: (t) => { const m = /(\d+(?:\.\d+)?)\s*(?:sq\.?\s*m|sq\.?\s*mtr|square\s*met|चौ)/i.exec(String(t ?? '')); return m ? Number(m[1]) : null; },
  /** "Thane railway station, 2.5 km; bus stop 100 m" → "Thane" */
  station_name: (t) => (t === null || t === undefined || t === '' ? null : String(t).split(/[,;(]/)[0].replace(/\b(railway|rly\.?|local)?\s*(station|stn\.?)\b.*$/i, '').trim() || String(t).trim()),
};

/** Words typed only to get past a screen (13 Nov re-test: "NA", "0", "Ok", "-"); with `answers`, a bare Yes / No
 *  too. A field with rules.blank_words treats such an entry as no value (never pending, never printed). */
export function isPlaceholder(v: unknown, answers: boolean | string = false): boolean {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return false;
  if (/^(n\.?\s*a\.?|n\/a|nil|none|ok|okay|0+(\.0+)?|-+|x|not\s+(provided|applicable|available|known|stated))\.?$/.test(s)) return true;
  if (/\b(clear copy|not readable|unreadable|illegible)\b/.test(s)) return true;
  return !!answers && answers !== 'false' && /^(yes|no|y|n)\.?$/.test(s);
}

export function upperFloors(t: unknown): number | null {
  if (t === null || t === undefined || t === '') return null;
  if (typeof t === 'number') return t;
  const s = String(t).toLowerCase().replace(/(\d+)\s*(st|nd|rd|th|h)\b/g, '$1');
  const range = /(\d+)\s*(?:to|-|–)\s*(\d+)/.exec(s);
  if (range) return Number(range[2]) - Number(range[1]) + 1;
  const plus = /(?:g|ground|stilt|s)\s*\+\s*(\d+)(?!\s*(?:level|podium|basement))/.exec(s);
  if (plus) return Number(plus[1]);
  const n = /^\s*(\d+)\s*(?:upper\s*)?(?:floors?|storeys?)/.exec(s);
  return n ? Number(n[1]) : null;
}

/** Comparable rows a format can print (rate indicators chart). */
export const COMP_ROWS = 4;
const SOURCE_LABEL: Record<string, string> = { index2: 'Index II', igr_search: 'IGR', listing: 'Listing', broker: 'Broker', own_report: 'Own report', import: 'Imported' };

/** EVID.COMPn.* for one comparable: source, description, price, area and rate on the case's area basis
 *  (comparables are kept per sq.ft. built-up; the basis factor turns them into the area the rate is quoted on). */
function compValues(n: number, x: any, f: number | null): Record<string, unknown> {
  const k = `EVID.COMP${n}`;
  const price = Number(x.price) || null;
  const area = x.area_bua_sqft ? Math.round(Number(x.area_bua_sqft) / (f ?? 1)) : Number(x.area_value) || null;
  const where = [x.building, x.society].filter(Boolean)[0] ?? x.locality ?? '';
  return {
    [`${k}.SOURCE`]: x.source_type === 'igr_search' && x.txn_date ? `IGR-${new Date(x.txn_date).getFullYear()}` : (x.source_type === 'listing' ? listingSite(x) : SOURCE_LABEL[x.source_type] ?? x.source_type),
    [`${k}.DESC`]: `${x.bhk ? `${x.bhk} ` : ''}Flat${where ? ` at ${where}` : ''}`,
    [`${k}.VALUE`]: price,
    [`${k}.AREA`]: area,
    [`${k}.RATE`]: price && area ? Math.round(price / area) : null,
  };
}

const site = (s: unknown) => String(s ?? '').trim().replace(/^https?:\/\/(www\.)?/i, '').split(/[/?#]/)[0];
const ID_LIKE = /^[A-Za-z]{0,4}[-_ ]?\d{5,}$/;
/** The website a listing came from (99acres, Housing.com), never the listing's id: the comparable's own source when
 *  it names a site, else the captured page's source name or address. */
export function listingSite(x: { source_ref?: string | null; capture_source?: string | null; capture_url?: string | null }): string {
  const own = site(x.source_ref);
  if (own && !ID_LIKE.test(own)) return own;
  return site(x.capture_source) || site(x.capture_url) || 'Listing';
}

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
  signed_by?: number | null;
  rules_json?: unknown;
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
      'a.created_at', 'a.report_no', 'a.signed_at', 'a.signed_by', 'a.rules_json', 'a.locality_hint', 'a.bank_ref_no', 'a.draft_version',
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
  /** where a rule's value comes from: the firm's rules for the bank, the report format, or this case */
  ruleOrigin: (key: string) => 'firm' | 'format' | 'case' | 'rera';
  /** the RERA rule (E2): applied and what triggered it */
  rera: () => { applied: boolean; trigger: string | null };
  ruleBase: (key: string) => unknown;
  fields: Map<string, Field>;
  profile: any;
  wording: any;
  get(code: string): Resolved;
  value(code: string): unknown;
  all(codes?: string[]): Resolved[];
  resolver: Resolver;
  wordingText(template: string, extra?: Record<string, unknown>): string | null;
  /** agreements in a resale chain: the current one (latest, or chosen) and the earlier ones (B4, C7) */
  chain: { current: number | null; earlier: ChainDoc[]; chosen: boolean };
  /** every received document as it can be listed under Legal documents, in the chosen order (B2) */
  legalItems(): LegalItem[];
}

export interface ChainDoc { partId: number; date: string | null; seller: string | null; buyer: string | null; title: string | null }
export interface LegalItem { key: string; label: string; line: string; on: boolean; kind: 'document' | 'chain' | 'other' | 'kyc' | 'comparable' | 'blank'; partIds: number[] }

/** Legal documents of the property profile and the document types each one covers (older profiles name no types). */
const LEGAL_TYPES: Record<string, string[]> = {
  agreement: ['agreement', 'sale_deed'], index2: ['index2'], index2_prev: ['index2_prev'], noc: ['society_noc'], cc: ['cc'], plan: ['approved_plan'],
  oc: ['oc'], title: ['title_report'], fplan: ['floor_plan'], rera: ['rera_cert'],
};
/** the date that orders documents of a chain (the latest is the current one) */
const CHAIN_DATE: Record<string, string> = { agreement: 'DOC.AGREEMENT.DATE', sale_deed: 'DOC.AGREEMENT.DATE' };

/** Build the resolved view of a case. Cheap enough to call per request (a handful of queries). */
export async function caseData(assignmentId: number, firmId: number, tx: Tx = db): Promise<CaseData> {
  const c = await loadCase(assignmentId, firmId, tx);
  const [fields, firm, valuer, settings, values, checklist, visit, photos, parts, docTypeCfg] = await Promise.all([
    dictionary(firmId, tx),
    tx.selectFrom('firms').selectAll().where('id', '=', firmId).executeTakeFirstOrThrow(),
    // whoever signed (a Report Checker may sign); before signing, the firm's valuer
    c.signed_by
      ? tx.selectFrom('users').select(['name', 'title', 'print_name', 'qualifications', 'ibbi_reg_no', 'ibbi_valid_upto']).where('id', '=', c.signed_by).where('firm_id', '=', firmId).executeTakeFirst()
      : tx.selectFrom('users').select(['name', 'title', 'print_name', 'qualifications', 'ibbi_reg_no', 'ibbi_valid_upto']).where('firm_id', '=', firmId).where('role', '=', 'valuer').where('status', '=', 'active').orderBy('id').executeTakeFirst(),
    getSettings(firmId, tx),
    tx.selectFrom('field_values').selectAll().where('assignment_id', '=', assignmentId).where('is_current', '=', 1).orderBy('id', 'asc').execute(),
    tx.selectFrom('checklist_items').selectAll().where('assignment_id', '=', assignmentId).orderBy('sort_order').execute(),
    tx.selectFrom('site_visits').select(['visit_date', 'submitted_at']).where('assignment_id', '=', assignmentId).where('status', '=', 'submitted').orderBy('id', 'desc').executeTakeFirst(),
    tx.selectFrom('site_photos').select(['id', 'names_visible', 'caption']).where('assignment_id', '=', assignmentId).execute(),
    tx.selectFrom('document_parts').select(['id', 'document_id', 'detected_type', 'corrected_type', 'title', 'is_kyc', 'excluded', 'moved_to', 'pages_json']).where('assignment_id', '=', assignmentId).orderBy('document_id').orderBy('page_from').execute(),
    activeConfig<{ types: { key: string; label: string; in_report?: boolean; is_kyc?: boolean }[] }>('doc_types', 'default', firmId, tx),
  ]);
  const ruleSet = c.rule_version_id ? await configById<RuleSetPayload>(c.rule_version_id, tx) : null;
  // the case's report format may bring its own rules (SBI Flat Under Construction: realizable 98%, other area factors)
  const fmt = c.template_version_id
    ? await tx.selectFrom('template_versions as v').innerJoin('report_templates as t', 't.id', 'v.template_id').select(['t.rules_json', 'v.rules_json as v_rules', 't.name']).where('v.id', '=', c.template_version_id).executeTakeFirst()
    : null;
  // firm rules for the bank, then the format's own, then this case's changes (Valuation tab, A6/A8)
  const caseRules = json<Partial<Rules>>(c.rules_json, {});
  // the pinned version's own rules (formats revised as a new version, H2); older versions fall back to the format's
  const fmtRules = json<Partial<Rules>>(fmt?.v_rules ?? fmt?.rules_json, {});
  const rules = { ...(ruleSet ? rulesFor(ruleSet.payload, c.bank_code) : ({} as Rules)), ...fmtRules, ...caseRules } as Rules;
  // E2: the RERA rule. When the agreement states a RERA carpet or a MahaRERA certificate is uploaded, loading and
  // saleable factor come from rera_loading_pct / rera_saleable_factor (worked out when first read; a case's own
  // figures still win). Applies to every format.
  const RERA_KEYS: Record<string, string> = { loading_pct: 'rera_loading_pct', saleable_factor: 'rera_saleable_factor' };
  let reraMemo: { applied: boolean; trigger: string | null } | null = null;
  const reraRule = () => {
    if (reraMemo) return reraMemo;
    reraMemo = { applied: false, trigger: null };
    const raw = rules as any;
    if (raw.rera_loading_pct === undefined && raw.rera_saleable_factor === undefined) return reraMemo;
    const rc = get('AREA.RERA_CARPET');
    if (rc.state === 'filled' && rc.source === 'document') reraMemo = { applied: true, trigger: `${rc.sourceDocType === 'rera_cert' ? 'RERA certificate' : 'agreement'}${rc.page ? ` p. ${rc.page}` : ''} states RERA carpet` };
    else if (docState.get('rera_cert') === 'provided') { const no = get('DOC.RERA.NUMBER').display; reraMemo = { applied: true, trigger: `MahaRERA certificate${no ? ` ${no}` : ''} uploaded` }; }
    return reraMemo;
  };
  const baseRules: Record<string, unknown> = { ...rules };
  for (const [k, rk] of Object.entries(RERA_KEYS)) {
    if (Object.hasOwn(caseRules, k)) continue;
    Object.defineProperty(rules, k, { enumerable: true, configurable: true, get: () => (reraRule().applied && (baseRules as any)[rk] !== undefined && (baseRules as any)[rk] !== null ? (baseRules as any)[rk] : baseRules[k]) });
  }
  /** a rule's value for this case without the case's own change (the default the Valuation tab compares with, E4) */
  const ruleBase = (k: string): unknown => (RERA_KEYS[k] && reraRule().applied && (baseRules as any)[RERA_KEYS[k]] != null ? (baseRules as any)[RERA_KEYS[k]] : ({ ...(ruleSet ? rulesFor(ruleSet.payload, c.bank_code) : {}), ...fmtRules } as any)[k] ?? null);
  const ruleOrigin = (k: string) => (Object.hasOwn(caseRules, k) ? 'case' : RERA_KEYS[k] && reraRule().applied && (baseRules as any)[RERA_KEYS[k]] != null ? 'rera' : Object.hasOwn(fmtRules, k) ? 'format' : 'firm');
  // the rate indicators chart: the strongest comparables used for the rate, on the case's area basis
  const comps = await tx.selectFrom('case_comparables as cc').innerJoin('comparables as cp', 'cp.id', 'cc.comparable_id')
    .leftJoin('evidence_captures as ec', 'ec.id', 'cc.capture_id')
    .select(['ec.source_name as capture_source', 'ec.url as capture_url', 'cp.source_type', 'cp.source_ref', 'cp.building', 'cp.society', 'cp.locality', 'cp.bhk', 'cp.price', 'cp.area_bua_sqft', 'cp.area_value', 'cp.txn_date', 'cp.is_asking_price'])
    .where('cc.assignment_id', '=', assignmentId).where('cc.is_subject', '=', 0).where('cc.included', '=', 1)
    .orderBy('cc.weight', 'desc').orderBy('cc.id').limit(COMP_ROWS).execute();
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

  // ---- resale chain (B4, C7): of several agreements, the latest (or the one a person marked current) is the
  // current one; earlier agreements are chain history only and give no values or conflict choices
  const partType = (p: { corrected_type: string | null; detected_type: string }) => p.corrected_type ?? p.detected_type;
  const chainOf = (docType: string) => parts.filter((p) => partType(p) === docType && !p.is_kyc);
  const partCand = (partId: number, code: string) => (byCode.get(code) ?? []).filter((x) => x.partId === partId && x.sourceType === 'document' && x.status !== 'rejected' && x.status !== 'superseded').sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0]?.value ?? null;
  const chosenCurrent = (() => { const m = [...(byCode.get('DOC.AGREEMENT.CURRENT_PART') ?? [])].reverse().find((x) => x.sourceType === 'manual'); return m?.value ? Number(m.value) : null; })();
  const chainParts = new Set<number>();
  const chain: { current: number | null; earlier: ChainDoc[]; chosen: boolean } = { current: null, earlier: [], chosen: false };
  {
    const list = [...new Set(Object.keys(CHAIN_DATE).flatMap((t) => chainOf(t)))];
    // only agreements that carry their own date take part, and only when the dates differ (two parts of one
    // agreement bound apart are not a chain)
    const dated = list.map((p) => ({ p, date: partCand(p.id, CHAIN_DATE[partType(p)]) })).filter((x) => toDate(x.date));
    const day = (d: string | null) => toDate(d)?.toISOString().slice(0, 10) ?? '';
    if (new Set(dated.map((x) => day(x.date))).size > 1) {
      const chosenHit = chosenCurrent ? dated.find((x) => x.p.id === chosenCurrent) : undefined;
      const pick = chosenHit ?? [...dated].sort((a, b) => (toDate(b.date)?.getTime() ?? 0) - (toDate(a.date)?.getTime() ?? 0) || b.p.id - a.p.id)[0];
      chain.current = pick.p.id;
      chain.chosen = !!chosenHit;
      for (const x of dated) {
        if (x.p.id === pick.p.id || day(x.date) === day(pick.date)) continue;
        chainParts.add(x.p.id);
        chain.earlier.push({ partId: x.p.id, date: x.date, seller: partCand(x.p.id, 'DOC.AGREEMENT.SELLER'), buyer: partCand(x.p.id, 'DOC.AGREEMENT.BUYER'), title: x.p.title });
      }
      chain.earlier.sort((a, b) => (toDate(b.date)?.getTime() ?? 0) - (toDate(a.date)?.getTime() ?? 0));
    }
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
    // the kind of building the report format is for (C4): a Flat Completed format never asks for completion dates
    'CASE.FORMAT_KIND': !fmt?.name ? null : /under\s*construction|\buc\b/i.test(fmt.name) ? 'under_construction' : /complete/i.test(fmt.name) ? 'completed' : null,
    'CUST.NAME': c.borrower_name,
    'SITE.INSPECTION_DATE': visit ? (visit.visit_date ?? visit.submitted_at)?.toISOString().slice(0, 10) ?? null : null,
    // a site photo shows a readable name board (C5); No once the visit is in and none does
    'SITE.NAMEBOARD_PHOTO': photos.some((p) => p.names_visible || /name\s*board/i.test(p.caption ?? '')) ? 'Yes' : visit ? 'No' : null,
  };
  // worked out when first read: the basis factor is itself a resolved field
  for (let n = 1; n <= COMP_ROWS; n++) {
    for (const part of ['SOURCE', 'DESC', 'VALUE', 'AREA', 'RATE']) {
      Object.defineProperty(caseValues, `EVID.COMP${n}.${part}`, {
        enumerable: true,
        get: () => (comps[n - 1] ? compValues(n, comps[n - 1], Number(get('VAL.BASIS_FACTOR').value) || null)[`EVID.COMP${n}.${part}`] : null),
      });
    }
  }
  const firmValues: Record<string, unknown> = {
    'FIRM.NAME': firm.name,
    'FIRM.ADDRESS': firm.address,
    // the full name as printed ("Manoj Kumar Sharma"); the login name may be shorter (#4)
    'FIRM.VALUER_NAME': valuer?.print_name?.trim() || valuer?.name || null,
    'FIRM.VALUER_TITLE': valuer?.title?.trim() || null,
    'FIRM.VALUER_REG_VALID': valuer?.ibbi_valid_upto ? new Date(valuer.ibbi_valid_upto).toISOString().slice(0, 10) : null,
    'FIRM.VALUER_QUALS': valuer?.qualifications ?? null,
    'FIRM.VALUER_REG': valuer?.ibbi_reg_no ?? null,
    'FIRM.PLACE': settings.place || firm.city,
    'REPORT.SIGNATURE': c.signed_at ? 'signed' : null,
  };

  const profileItem = new Map<string, { optional?: boolean; unreadable_field?: string }>(((profile.checklist ?? []) as any[]).map((x) => [x.code, x]));
  const checkLists = () => {
    const got: string[] = [];
    const not: string[] = [];
    for (const i of checklist) {
      if (!i.remark_label) continue;
      const cfg = profileItem.get(i.item_code);
      // a document that could not be read (plan marked "Not readable") is not cited as seen; it is listed as not
      // provided only when the valuer chose that wording, else Remark 1 asks for a clear copy
      const unreadable = cfg?.unreadable_field && i.state === 'y' && get(cfg.unreadable_field).value === 'Yes';
      if (unreadable) { if (!/clear copy/i.test(String(get(`${cfg!.unreadable_field}_TEXT`).value ?? ''))) not.push(i.remark_label); continue; }
      if (i.state === 'y') got.push(i.remark_label);
      // an optional document (title report) that was not received is simply left out
      else if (i.state === 'n' && !(cfg?.optional && !i.overridden)) not.push(i.remark_label);
    }
    return { got, not };
  };

  // document types the checklist settles: received, marked not provided (✕ by a person), or not applicable
  const docState = new Map<string, 'provided' | 'not_provided' | 'na'>();
  for (const i of checklist) {
    // crossed by a person, or optional and not received: nothing to wait for
    const st = i.state === 'y' ? 'provided' : i.state === 'na' ? 'na' : i.overridden || profileItem.get(i.item_code)?.optional ? 'not_provided' : null;
    if (!st) continue;
    for (const dt of json<string[]>(i.doc_types, [])) if (docState.get(dt) !== 'provided') docState.set(dt, st);
  }
  const itemState = new Map<string, 'provided' | 'not_provided' | 'na'>();
  for (const i of checklist) itemState.set(String(i.item_code).toLowerCase(), i.state === 'y' ? 'provided' : i.state === 'na' ? 'na' : 'not_provided');
  const DOC_LIKE = (s: string) => !['manual', 'case', 'firm', 'checklist', 'derived', 'wording', 'valuation', 'evidence', 'site_sheet'].includes(s);
  const closedDoc = (dt: string) => { const st = docState.get(dt); return st === 'not_provided' || st === 'na'; };

  const memo = new Map<string, Resolved>();
  const stack = new Set<string>();

  const parseRaw = (f: Field | undefined, cand: Candidate): unknown => {
    if (!f) return cand.value;
    if (NUMERIC.has(f.type)) return cand.num ?? (cand.value === null ? null : Number(String(cand.value).replace(/[^0-9.\-]/g, '')) || null);
    if (f.type === 'list') return json(cand.value, []);
    return cand.value;
  };

  const resolveIdent = (name: string): unknown => {
    if (name.startsWith('DOCSTATE.')) return docState.get(name.slice(9).toLowerCase()) ?? null;
    // a checklist item as Remark 1 reads it (ticked = provided, crossed = not provided): enclosures use the same state
    if (name.startsWith('CHECKLIST.')) return itemState.get(name.slice(10).toLowerCase()) ?? null;
    // a value stated in a document, on the site sheet or by a person: never one worked out by a derivation
    if (name.startsWith('STATED.')) { const r = fields.has(name.slice(7)) ? get(name.slice(7)) : null; return r && r.source !== 'derived' ? r.value : null; }
    if (name.startsWith('RULE.')) return Object.hasOwn(rules, name.slice(5)) ? (rules as any)[name.slice(5)] ?? null : null;
    // a value as a person or the site sheet gave it, before any wording or placeholder rule (C5: the name board
    // answer "no"; G1: "Not provided (clear copy required)" typed into the plan number)
    if (name.startsWith('RAW.')) { const h = [...(byCode.get(name.slice(4)) ?? [])].reverse().find((x) => ['manual', 'report_edit', 'site_sheet'].includes(x.sourceType) && x.status !== 'rejected' && x.status !== 'superseded'); return h?.value ?? null; }
    // the ticked Legal documents lines in the chosen order (B2)
    if (name === 'LEGAL.LINES') { const l = legalItems().filter((x) => x.on).map((x) => x.line); return l.length ? l : null; }
    if (fields.has(name)) return get(name).value;
    if (Object.hasOwn(caseValues, name)) return caseValues[name];
    if (Object.hasOwn(firmValues, name)) return firmValues[name];
    return null;
  };

  /** Arithmetic derivations in words with the values used; text and conditional ones are not explained. */
  const explain = (expr: string, result: unknown): { formula: string | null; ruleKeys: string[] } => {
    const ruleKeys = [...expr.matchAll(/RULE\.([a-z0-9_]+)/g)].map((m) => m[1]);
    let body = expr.replace(/^\s*round\((.*)\)\s*$/, '$1');
    // coalesce(a, b): explain the alternative that gave the value
    body = body.replace(/coalesce\(([^()]*(?:\([^()]*\)[^()]*)*)\)/, (whole, args: string) => {
      const alts = args.split(',').map((a) => a.trim());
      const hit = alts.find((a) => { const v = evalExpr(a, resolveIdent, EXPR_FNS); return v !== null && v !== undefined && v !== ''; }) ?? alts[0];
      return whole === body.trim() || !/[+\-*/]/.test(hit) ? hit : `(${hit})`;
    });
    if (typeof result !== 'number' || !/^[A-Za-z0-9_.\s()+\-*/]+$/.test(body)) return { formula: null, ruleKeys };
    const words = body
      .replace(/[A-Z][A-Z0-9_]*(\.[A-Za-z0-9_]+)+/g, (id) => {
        const v = resolveIdent(id);
        const label = id.startsWith('RULE.') ? id.slice(5).replace(/_pct$/, ' %').replace(/_/g, ' ') : (fields.get(id.replace(/^STATED\./, ''))?.label ?? id);
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
    for (const raw of ids) {
      const id = raw.replace(/^STATED\./, '');
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
      ...(f?.type === 'enum' && Array.isArray((f as any).enum) ? { options: (f as any).enum as string[] } : {}),
      ...((f?.rules as { record?: string } | null)?.record ? { record: (f!.rules as { record: string }).record } : {}),
    };
    if (stack.has(code)) return base; // cycle guard: treat as pending
    stack.add(code);
    try {
      const r = compute(f, base);
      // a unit can name a field (VAL.RATE_UNIT): the case's chosen unit
      const unit = f?.unit && /^[A-Z][A-Z0-9_]*\.[A-Z0-9_]+$/.test(f.unit) ? String(get(f.unit).value ?? 'sqft') : f?.unit;
      if (r.value !== null && r.value !== undefined && r.value !== '' && r.display === null) r.display = formatValue(r.type, r.value, unit);
      if (r.value === null || r.value === undefined || r.value === '') {
        r.state = f && !(f.applies.includes('*') || f.applies.includes(c.property_type)) ? 'not_applicable' : 'pending';
        // printed only in some cases (value as per work completed, when switched on): otherwise nothing is pending
        const when = (f?.rules as { only_when?: string } | null | undefined)?.only_when;
        if (r.state === 'pending' && when && !evalExpr(when, resolveIdent, EXPR_FNS)) r.state = 'not_applicable';
        if (r.state === 'pending' && f && notProvided(f)) { r.state = 'not_applicable'; r.notProvided = true; r.pendingLabel = 'Not provided'; }
        // a placeholder typed by a person, or a field that is optional by rule (an empty comparable, D1): nothing to wait for
        if (r.state === 'pending' && (r.blanked || (f?.rules as { optional?: boolean } | null)?.optional)) r.state = 'not_applicable';
      } else {
        r.state = 'filled';
        // a field this case's format does not ask for (work done in a Flat Completed format, C4) is hidden, whatever was read
        const when = (f?.rules as { only_when?: string } | null | undefined)?.only_when;
        if (when && !evalExpr(when, resolveIdent, EXPR_FNS)) r.state = 'not_applicable';
      }
      memo.set(code, r);
      return r;
    } finally {
      stack.delete(code);
    }
  }

  /** Nothing to wait for: every document it could come from is marked not provided, or what it is worded / derived from is. */
  function notProvided(f: Field): boolean {
    const srcs = f.sources.filter((s) => s !== 'manual');
    if (srcs.length && srcs.every((s) => DOC_LIKE(s) && closedDoc(s))) return true;
    const exprs = srcs.flatMap((s) => (s === 'wording' ? [wording.fields?.[f.code]] : s === 'derived' ? [f.derivation] : [null]));
    if (!exprs.length || exprs.some((e) => !e)) return false;
    const deps = exprs.flatMap((e) => (e as string).match(/[A-Z][A-Z0-9_]*(\.[A-Z0-9_]+)+/g) ?? []).filter((id) => fields.has(id)).map(get);
    const missing = deps.filter((d) => d.state !== 'filled');
    return missing.length > 0 && missing.every((d) => d.notProvided);
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
    // an earlier agreement of a resale chain gives no values (B4, C7)
    const cands = r.candidates.filter((x) => x.status !== 'rejected' && x.status !== 'superseded' && !(x.partId && chainParts.has(x.partId)) && x.docType !== 'index2_comp');
    // 1. a person's edit wins (most recent). A line built from the bank rules is changed on the Valuation tab, not
    //    here; a line built from the O.C. / C.C. / approved plan record can be typed over (21 Nov: the valuer could
    //    not sign while the record had no C.C.). A placeholder ("NA", "0", "Ok") is no value (13 Nov re-test).
    const fr = (f?.rules ?? {}) as { record?: string; blank_words?: boolean | string };
    const locked = !!fr.record && !/O\.C\./.test(fr.record);
    const typed = [...cands].reverse().find((x) => x.sourceType === 'manual' || x.sourceType === 'report_edit');
    if (locked && typed?.value) r.earlierEdit = typed.value;
    const manual = locked ? undefined : typed;
    if (manual && fr.blank_words && isPlaceholder(manual.value, fr.blank_words)) r.blanked = true;
    else if (manual) { setFrom(r, f, manual, true); return r; }
    // another field that, when filled, gives this one (E3: the carpet is the RERA carpet when the project has one)
    const prefer = (f?.rules as { prefer?: string } | null)?.prefer;
    if (prefer && fields.has(prefer)) {
      const pr = get(prefer);
      if (pr.state === 'filled' && pr.source !== 'derived') {
        Object.assign(r, { value: pr.value, source: pr.source, sourceDocType: pr.sourceDocType, page: pr.page, partId: pr.partId, snippet: pr.snippet, confidence: pr.confidence, edited: pr.edited, preferred: pr.label });
        return r;
      }
    }
    // 2. a candidate a person explicitly chose in a conflict: it gives the value, but the other readings stay
    //    on offer so the choice can be switched until signing (B2)
    const chosen = cands.find((x) => x.chosen);
    if (chosen) setFrom(r, f, chosen, false);
    if (chosen && !f) return r;
    if (!f) {
      if (Object.hasOwn(caseValues, r.code)) { r.value = caseValues[r.code]; r.source = 'case'; }
      else if (Object.hasOwn(firmValues, r.code)) { r.value = firmValues[r.code]; r.source = 'firm'; }
      return r;
    }
    let pending: string | null = f.pending;
    const docCands: Candidate[] = [];
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
      const norm = (x: Candidate) => (NUMERIC.has(f.type) ? String(parseRaw(f, x)) : sameText(x.value));
      const distinct = new Map<string, Candidate>();
      for (const d of docCands) if (!distinct.has(norm(d))) distinct.set(norm(d), d);
      const tol = NUMERIC.has(f.type) ? 0.02 : 0;
      const vals = [...distinct.values()];
      const differs = NUMERIC.has(f.type)
        ? vals.some((v) => Math.abs(Number(parseRaw(f, v)) - Number(r.value)) / Math.max(1, Math.abs(Number(r.value))) > tol)
        : vals.length > 1 && f.type !== 'longtext';
      if (differs) {
        // one reading contains the other (e.g. survey no. with and without the hissa): information, not a conflict to resolve
        const keys = vals.map(norm).sort((a, b) => b.length - a.length);
        const minor = !NUMERIC.has(f.type) && keys.slice(1).every((k) => k && keys[0].includes(k));
        const fuller = minor ? vals.find((v) => norm(v) === keys[0]) : null;
        const oneDoc = new Set(vals.map((v) => v.partId ?? v.docType)).size === 1;
        if (fuller && !cands.some((x) => x.chosen)) setFrom(r, f, fuller, false);
        r.conflict = {
          chosenId: chosen?.id ?? null,
          minor,
          message: minor ? `${f.label}: ${vals.map((v) => v.docType).join(' and ')} give the same value, one more fully. The fuller reading is used; pick another if needed.`
            : oneDoc ? `${f.label}: the document carries ${vals.length} dated entries. The latest is used; an earlier one can be picked.`
            : `${f.label} reads differently in ${[...new Set(vals.map((v) => v.docType))].join(' and ')}`,
          options: vals.map((v) => ({ label: `${v.docType ?? v.sourceType}${oneDoc && v.page ? ` p. ${v.page}` : ''}${oneDoc ? (v.id === Math.min(...vals.map((x) => x.id)) ? ' (latest)' : ' (earlier)') : ''}`, value: parseRaw(f, v), display: formatValue(f.type, parseRaw(f, v), f.unit) ?? '', candidateId: v.id })),
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

  /** Every received document as a Legal documents line (B2). The profile's legal documents come first with their
   *  worded summaries; earlier agreements of a chain follow as chain documents; then every other document received.
   *  Defaults: the property's own documents ticked; KYC, other flats' Index II and blank / unreadable pages not. A
   *  person's choice and order (DOC.LEGAL_PICK) wins; older cases honour DOC.LEGAL_SKIP. */
  function legalItems(): LegalItem[] {
    const types = new Map((docTypeCfg?.payload.types ?? []).map((t) => [t.key, t]));
    const label = (k: string) => types.get(k)?.label ?? k;
    const cfg = (profile.legal_documents ?? []) as { key: string; field: string; doc_types?: string[] }[];
    const skip = (get('DOC.LEGAL_SKIP').value as string[] | null) ?? [];
    const out: LegalItem[] = [];
    const covered = new Set<string>();
    for (const it of cfg) {
      const dts = it.doc_types ?? LEGAL_TYPES[it.key] ?? [];
      dts.forEach((d) => covered.add(d));
      const line = fields.has(it.field) ? (get(it.field).display ?? null) : null;
      const ps = parts.filter((p) => dts.includes(partType(p)) && !chainParts.has(p.id)).map((p) => p.id);
      // a placeholder typed into a summary ("no", "N.A", "Not provided") is not a document received
      if (!line || isPlaceholder(line, true)) continue;
      // the approved plan is listed only when its copy was received (a plan quoted in the C.C. is not a copy)
      if (it.key === 'plan' && docState.get('approved_plan') !== 'provided') continue;
      out.push({ key: it.key, label: fields.get(it.field)?.label ?? it.key, line, on: !skip.includes(it.key), kind: 'document', partIds: ps });
    }
    for (const e of chain.earlier) {
      const line = `Agreement for Sale${e.date ? ` dated ${ddmmyyyy(e.date) || e.date}` : ''}${e.seller && e.buyer ? ` between ${e.seller} (Transferor) and ${e.buyer} (Transferee)` : ''} (earlier agreement in the chain)`;
      out.push({ key: `chain:${e.partId}`, label: 'Earlier agreement (chain)', line, on: true, kind: 'chain', partIds: [e.partId] });
    }
    const seen = new Map<string, LegalItem>();
    for (const p of parts) {
      const t = partType(p);
      if (covered.has(t) || chainParts.has(p.id) || t === 'site_photo' || t === 'site_sheet' || p.moved_to === 'site_photos') continue;
      const kyc = !!p.is_kyc || !!types.get(t)?.is_kyc;
      const blank = t === 'other' && /\b(blank|unreadable|illegible)\b/i.test(p.title ?? '');
      const kind: LegalItem['kind'] = kyc ? 'kyc' : t === 'index2_comp' ? 'comparable' : blank ? 'blank' : 'other';
      const line = kyc ? 'KYC documents of the parties' : t === 'index2_comp' ? `Index II of another property (comparable)${p.title ? `: ${p.title}` : ''}` : (p.title?.trim() || label(t));
      const k = `${kind}|${sameText(line)}`;
      const hit = seen.get(k);
      if (hit) { hit.partIds.push(p.id); continue; }
      const it: LegalItem = { key: `part:${p.id}`, label: label(t), line, on: kind === 'other' && !!types.get(t)?.in_report, kind, partIds: [p.id] };
      seen.set(k, it);
      out.push(it);
    }
    // a person's choice and order
    const pick = get('DOC.LEGAL_PICK').value as { k: string; on: boolean }[] | null;
    if (!Array.isArray(pick) || !pick.length) return out;
    const order = new Map(pick.map((x, i) => [String(x.k), i]));
    for (const it of out) { const x = pick.find((y) => String(y.k) === it.key); if (x) it.on = !!x.on; }
    return out.map((it, i) => ({ it, i })).sort((a, b) => (order.get(a.it.key) ?? 1000 + a.i) - (order.get(b.it.key) ?? 1000 + b.i)).map((x) => x.it);
  }

  return {
    chain,
    legalItems,
    rera: reraRule,
    ruleBase,
    case: c,
    rules,
    ruleOrigin,
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
