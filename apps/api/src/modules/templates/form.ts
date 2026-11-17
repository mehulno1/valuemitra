// The bank's form as it reads (retest of 13 Nov, H4): every line of the prepared format in document order,
// with the fields it prints in plain words and a tag per line: Ready (every field exists and is accepted),
// New field (a field proposed for this format), Question for you (not accepted yet) or the bank's own text.
// Works for every format (AI-read, label-matched and tagged {{FIELD}} files) because it reads the prepared file.
// With a case, each field also shows what would print.
import { db } from '../../db/index.js';
import { notFound } from '../../lib/errors.js';
import { buildRenderData } from '../reports/data.js';
import { templateCodes } from './codes.js';
import { CLOSE, OPEN } from './compile.js';
import { openDocx } from './docx.js';
import { outline } from './outline.js';
import { compileVersion, versionDetail } from './service.js';
import { dictionary } from '../master/dictionary.js';

export type Seg = { t: string } | { code: string; label: string; value?: string };
export interface FormLine { id: string; kind: 'para' | 'row'; segs: Seg[]; status: 'ready' | 'new' | 'question' | 'text'; mappingIds: number[] }

const TAG = new RegExp(`${OPEN}([^${CLOSE}]+)${CLOSE}`, 'g');

export async function formLines(firmId: number, versionId: number, assignmentId?: number | null) {
  const v = await db.selectFrom('template_versions as v').innerJoin('report_templates as t', 't.id', 'v.template_id').select(['t.firm_id']).where('v.id', '=', versionId).executeTakeFirst();
  if (!v || (v.firm_id !== null && v.firm_id !== firmId)) throw notFound('Template version');
  const d = await versionDetail(firmId, versionId);
  const fields = await dictionary(firmId);
  const proposed = new Map<string, any>((d.ai?.new_fields ?? []).map((f: any) => [f.code, f]));
  const bySlot = new Map(d.mappings.map((m) => [m.slot_key, m]));
  const byCode = new Map<string, typeof d.mappings>();
  for (const m of d.mappings) for (const c of new Set([m.field_code, ...templateCodes(m.template)].filter(Boolean) as string[])) byCode.set(c, [...(byCode.get(c) ?? []), m]);
  const { compiled } = await compileVersion(v.firm_id, versionId);
  const o = outline(openDocx(compiled).doc);
  const values = assignmentId ? (await buildRenderData(assignmentId, firmId, 'final_preview', db, versionId)).data : null;
  const label = (c: string) => fields.get(c)?.label ?? proposed.get(c)?.label ?? c;

  // lines: body paragraphs, and table rows (cells joined), in document order, up to the annexure pages
  const ids = [...o.order.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
  const raw: { id: string; kind: 'para' | 'row'; text: string }[] = [];
  for (const id of ids) {
    if (id.startsWith('p')) { raw.push({ id, kind: 'para', text: o.paras.get(Number(id.slice(1))) ?? '' }); continue; }
    const row = id.replace(/c\d+$/, '');
    const cell = o.cells.get(id) ?? '';
    const last = raw[raw.length - 1];
    if (last?.id === row) last.text += cell ? ` | ${cell}` : '';
    else raw.push({ id: row, kind: 'row', text: cell });
  }
  const lines: FormLine[] = [];
  for (const r of raw) {
    if (r.text.includes('ANNEX_PAGES')) break;
    const segs: Seg[] = [];
    const used: number[] = [];
    const codes: string[] = [];
    let at = 0;
    const text = r.text.replace(/^\s*\|\s*|\s*\|\s*$/g, '');
    const pushField = (c: string) => { codes.push(c); segs.push({ code: c, label: label(c), ...(values ? { value: String(values[c] ?? '') } : {}) }); };
    for (const m of text.matchAll(TAG)) {
      if (m.index! > at) segs.push({ t: text.slice(at, m.index) });
      at = m.index! + m[0].length;
      const inner = m[1].replace(/^%/, '');
      if (/^[#/^]|^SIGN_PENDING$|^(title|note)$/.test(inner)) continue;      // conditions, loops, signature block
      if (inner.startsWith('TPL.')) {
        const map = bySlot.get(inner.slice(4));
        if (!map?.template) continue;
        used.push(map.id);
        let k = 0;
        for (const t of map.template.matchAll(/\{\{\s*([A-Z][A-Z0-9_]*(?:\.[A-Z0-9_]+)+)\s*\}\}/g)) {
          if (t.index! > k) segs.push({ t: map.template.slice(k, t.index) });
          pushField(t[1]);
          k = t.index! + t[0].length;
        }
        if (k < map.template.length) segs.push({ t: map.template.slice(k) });
        continue;
      }
      if (/^[A-Z][A-Z0-9_]*(\.[A-Z0-9_]+)+$/.test(inner)) pushField(inner);
    }
    if (at < text.length) segs.push({ t: text.slice(at) });
    const plain = segs.map((s) => ('t' in s ? s.t : s.label)).join('').trim();
    if (!plain) continue;
    const maps = [...new Set([...used, ...codes.flatMap((c) => (byCode.get(c) ?? []).map((m) => m.id))])];
    const mm = d.mappings.filter((m) => maps.includes(m.id));
    const status: FormLine['status'] = !codes.length ? 'text'
      : mm.some((m) => !m.confirmed || (m.status === 'needs' && !m.answer)) ? 'question'
      : codes.some((c) => proposed.has(c) && !fields.has(c)) ? 'new' : 'ready';
    lines.push({ id: r.id, kind: r.kind, segs: segs.map((s) => ('t' in s ? { t: s.t.replace(/\s*\|\s*/g, ' · ') } : s)), status, mappingIds: maps });
  }
  // earlier-case text and standard sections the prepared file no longer has
  const cleared = d.mappings.filter((m) => m.kind === 'para' && (m.status === 'clear' || m.ignored)).map((m) => ({ id: m.id, label: m.label, sample: m.sample, kept: m.ignored, replacedBy: m.template }));
  const counts = { ready: 0, new: 0, question: 0, text: 0 } as Record<FormLine['status'], number>;
  for (const l of lines) counts[l.status]++;
  return { lines, cleared, counts: { ...counts, cleared: cleared.filter((c) => !c.kept).length } };
}
