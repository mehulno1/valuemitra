// Step 3: match each detected label to a canonical field using the label text, its section context
// and mappings confirmed before (any bank) — the learning loop for template onboarding.
import { db } from '../../db/index.js';
import type { Field } from '../master/dictionary.js';
import type { Slot } from './detect.js';

const STOP = new Set(['of', 'the', 'a', 'an', 'and', 'in', 'as', 'per', 'to', 'for', 'is', 'on', 'by', 'if', 'any', 'be', 'or', 'at', 'with', 'no', 'name']);

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, (m) => (m.length < 6 ? ' ' : m)) // drop (s), (if any) style noise
    .replace(/[^a-z0-9ऀ-ॿ|]+/g, ' ')
    .replace(/\b(\d+|[ivx]+)\b(?=\s)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const tokens = (s: string) =>
  normalize(s)
    .split(/[\s|]+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => w.replace(/(ies)$/, 'y').replace(/(?<=[a-z]{3})s$/, ''));

function bigrams(s: string) {
  const x = s.replace(/\s+/g, '');
  const out = new Map<string, number>();
  for (let i = 0; i < x.length - 1; i++) out.set(x.slice(i, i + 2), (out.get(x.slice(i, i + 2)) ?? 0) + 1);
  return out;
}

function dice(a: string, b: string) {
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  let total = 0;
  for (const [k, v] of A) { inter += Math.min(v, B.get(k) ?? 0); total += v; }
  for (const v of B.values()) total += v;
  return total ? (2 * inter) / total : 0;
}

export function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return dice(na, nb) * 0.8;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const jacc = inter / (ta.size + tb.size - inter);
  // composite labels ("Row | Column") must agree on both halves
  const pa = na.includes('|');
  const pb = nb.includes('|');
  if (pa !== pb) return Math.min(0.55, 0.6 * dice(ta.size ? [...ta].join(' ') : na, [...tb].join(' ')) + 0.4 * jacc);
  if (ta.size === tb.size && inter === ta.size) return 0.97;
  return 0.6 * dice([...ta].join(' '), [...tb].join(' ')) + 0.4 * jacc;
}

const CONTEXT_GROUP: [RegExp, string[]][] = [
  [/area/i, ['AREA']],
  [/valuation|value/i, ['VAL']],
  [/document|approval|legal/i, ['DOC', 'APPR']],
  [/physical|building|construction/i, ['PHYS', 'APPR']],
  [/tenure|occupan/i, ['OCC']],
  [/customer|owner|borrower/i, ['CUST']],
  [/property|location/i, ['PROP']],
  [/declaration|remark/i, ['REPORT', 'VAL']],
  [/valuer/i, ['FIRM']],
];

export interface MatchResult {
  fieldCode: string | null;
  confidence: number;
  method: 'auto' | 'history' | 'placeholder' | null;
  alternatives: { code: string; confidence: number }[];
}

/** Confirmed mappings from every template version, by normalized label → most used field. */
export async function mappingHistory(firmId: number): Promise<Map<string, { code: string; count: number }>> {
  const rows = await db
    .selectFrom('template_mappings as m')
    .innerJoin('template_versions as v', 'v.id', 'm.template_version_id')
    .innerJoin('report_templates as t', 't.id', 'v.template_id')
    .select(['m.label_text', 'm.field_code'])
    .where('m.field_code', 'is not', null)
    .where('m.confirmed_at', 'is not', null)
    .where('m.method', 'in', ['manual', 'new_field'])
    .where((eb) => eb.or([eb('t.firm_id', 'is', null), eb('t.firm_id', '=', firmId)]))
    .execute();
  const counts = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const k = normalize(r.label_text);
    const m = counts.get(k) ?? new Map();
    m.set(r.field_code!, (m.get(r.field_code!) ?? 0) + 1);
    counts.set(k, m);
  }
  const out = new Map<string, { code: string; count: number }>();
  for (const [k, m] of counts) {
    const best = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    out.set(k, { code: best[0], count: best[1] });
  }
  return out;
}

export function matchSlot(slot: Slot, fields: Map<string, Field>, history: Map<string, { code: string; count: number }>): MatchResult {
  if (slot.explicitCode) {
    const ok = fields.has(slot.explicitCode);
    return { fieldCode: ok ? slot.explicitCode : null, confidence: ok ? 100 : 0, method: ok ? 'placeholder' : null, alternatives: [] };
  }
  const h = history.get(normalize(slot.label));
  const groups = CONTEXT_GROUP.filter(([re]) => slot.context && re.test(slot.context)).flatMap(([, g]) => g);
  const scored: { code: string; confidence: number }[] = [];
  for (const f of fields.values()) {
    if (f.status !== 'active') continue;
    let best = 0;
    for (const name of [f.label, ...f.aliases]) best = Math.max(best, similarity(slot.label, name));
    if (groups.includes(f.group)) best = Math.min(1, best + 0.04);
    if (best > 0.35) scored.push({ code: f.code, confidence: Math.round(best * 100) });
  }
  scored.sort((a, b) => b.confidence - a.confidence);
  if (h && fields.has(h.code)) {
    const conf = Math.min(99, 92 + h.count);
    return { fieldCode: h.code, confidence: conf, method: 'history', alternatives: scored.filter((s) => s.code !== h.code).slice(0, 4) };
  }
  const top = scored[0];
  return {
    fieldCode: top && top.confidence >= 60 ? top.code : null,
    confidence: top?.confidence ?? 0,
    method: top && top.confidence >= 60 ? 'auto' : null,
    alternatives: scored.slice(0, 5),
  };
}

export const AUTO_ACCEPT = 85;
