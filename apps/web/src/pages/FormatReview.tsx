// Review of a bank format read by the AI: the bank's form as a list (green = matched to an existing
// field, blue = new field, amber = needs you, grey = earlier-case text cleared), the details of the
// selected item, one click to accept everything that is ready, then preview and publish.
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Panel, useErrorToast, useToast } from '@/components/ui';

export interface ReviewMapping {
  id: number; kind: string; label: string; context: string | null; sample: string | null; field_code: string | null; field_label: string | null;
  ignored: boolean; confidence: number | null; method: string | null; confirmed: boolean; suggestions: { code: string; confidence: number }[];
  status: 'match' | 'new' | 'needs' | 'clear' | 'fixed' | null; section: string | null; note: string | null; answer: string | null; template: string | null;
  ask: { question: string; options: { label: string; template: string }[] } | null;
}
export interface NewFieldInfo { code: string; label: string; type: string; sources: string[]; default_text: string | null; scope: 'shared' | 'bank'; hint: string | null }
export interface AiInfo { summary: { title: string; filled_report: boolean }; counts: { questions: number; match: number; new: number; needs: number; clear: number; new_fields: number }; new_fields: NewFieldInfo[]; warnings: string[] }
interface DictField { code: string; label: string; sources?: string[] }

export const READY = 85;
type Filter = 'all' | 'match' | 'new' | 'needs' | 'clear';
const PILL: Record<string, [string, string]> = { match: ['ok', 'Matched'], new: ['new', 'New field'], needs: ['warn', 'Needs you'], clear: ['info', 'Cleared'], fixed: ['info', "Bank's text"] };
const SOURCE: Record<string, string> = { site_sheet: 'Site sheet (engineer)', manual: 'Entered by you', derived: 'Standard wording', wording: 'Standard wording', valuation: 'Valuation tab', evidence: 'Market evidence', case: 'Case details', firm: 'Firm settings' };
const TAG_RE = /\{\{\s*([A-Z][A-Z0-9_]*(?:\.[A-Z0-9_]+)+)\s*\}\}/g;

/** What the valuer must still look at: open questions, and anything not yet accepted. */
const needsYou = (m: ReviewMapping) => !m.confirmed && (m.status === 'needs' || (m.confidence ?? 0) < READY);
const filterOf = (m: ReviewMapping): Filter => (m.status === 'needs' || (!m.confirmed && (m.confidence ?? 0) < READY && m.status !== 'clear') ? 'needs' : (m.status as Filter) ?? 'match');

export default function FormatReview({ vid, ai, mappings, fields, edit, onChange, Picker }: {
  vid: number; ai: AiInfo; mappings: ReviewMapping[]; fields: DictField[]; edit: boolean; onChange: (d: any) => void;
  Picker: (p: { value: string | null; suggestions: { code: string; confidence: number }[]; onPick: (code: string) => void; disabled?: boolean }) => JSX.Element;
}) {
  const toast = useToast();
  const onErr = useErrorToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [selId, setSelId] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const byCode = useMemo(() => new Map(fields.map((f) => [f.code, f])), [fields]);
  const proposed = useMemo(() => new Map(ai.new_fields.map((f) => [f.code, f])), [ai]);
  const labelOf = (c: string) => byCode.get(c)?.label ?? proposed.get(c)?.label ?? c;
  const human = (t: string | null) => (t ? t.replace(TAG_RE, (_, c: string) => `[${labelOf(c)}]`) : '');

  const done = (d: any) => { onChange(d); qc.invalidateQueries({ queryKey: ['templates'] }); };
  const patch = useMutation({ mutationFn: ({ mid, body }: { mid: number; body: Record<string, unknown> }) => api.patch(`/api/templates/versions/${vid}/mappings/${mid}`, body), onSuccess: (d) => { setPicking(false); done(d); }, onError: onErr });
  const answer = useMutation({ mutationFn: ({ mid, option }: { mid: number; option: number }) => api.post(`/api/templates/versions/${vid}/mappings/${mid}/answer`, { option }), onSuccess: done, onError: onErr });
  const acceptReady = useMutation({
    mutationFn: () => api.post<{ accepted: number; version: any }>(`/api/templates/versions/${vid}/accept-ready`),
    onSuccess: (r) => { toast(`${r.accepted} item(s) accepted`); done(r.version); },
    onError: onErr,
  });
  const busy = patch.isPending || answer.isPending || acceptReady.isPending;

  const counts = { all: mappings.length, match: 0, new: 0, needs: 0, clear: 0 } as Record<Filter, number>;
  for (const m of mappings) counts[filterOf(m)] = (counts[filterOf(m)] ?? 0) + 1;
  const open = mappings.filter((m) => !m.confirmed);
  const ready = open.filter((m) => !needsYou(m));
  const sel = mappings.find((m) => m.id === selId) ?? mappings.find(needsYou) ?? mappings[0];
  const sections = [...new Set(mappings.map((m) => m.section || 'Other'))];
  const goNext = (after: ReviewMapping) => { const nx = mappings.find((m) => m.id !== after.id && needsYou(m)); if (nx) setSelId(nx.id); };

  const tile = (k: Filter, label: string) => (
    <button className="rv-tile" aria-pressed={filter === k} onClick={() => setFilter(filter === k ? 'all' : k)}>
      <div className="n">{counts[k] ?? 0}</div><div className="sub">{label}</div>
    </button>
  );

  return (
    <div className="grid gap-4">
      <div className="rv-tiles">
        {tile('all', 'Items found')}
        {tile('match', 'Matched to existing fields')}
        {tile('new', 'Get new fields')}
        {tile('needs', 'Need you')}
        {tile('clear', 'Earlier-case text cleared')}
      </div>
      {ai.summary.filled_report && (
        <p className="sub m-0">This file is a filled report of an earlier case. Its case details, photographs and the earlier valuer's name and registration are cleared (grey items); your firm's details print in their place. The uploaded original is deleted when you publish.</p>
      )}

      <div className="cols">
        <section className="panel min-w-0 rv-paper" style={{ paddingBottom: 10 }}>
          <div className="border-b border-line px-4 py-3" style={{ fontFamily: 'var(--f-body)' }}>
            <b>{ai.summary.title}</b>
            <div className="sub">As read from the uploaded file · click any line</div>
          </div>
          {sections.map((sec) => (
            <div key={sec}>
              <h3>{sec}</h3>
              {mappings.filter((m) => (m.section || 'Other') === sec).map((m) => {
                const [cls, text] = m.status === 'needs' && m.confirmed ? ['ok', 'Answered'] : PILL[m.status ?? 'match'] ?? PILL.match;
                const look = !m.confirmed && m.status !== 'needs' && m.status !== 'clear' && (m.confidence ?? 0) < READY;
                return (
                  <button key={m.id} className={`rv-q ${sel?.id === m.id ? 'sel' : ''} ${filter !== 'all' && filterOf(m) !== filter ? 'dim' : ''}`} onClick={() => { setSelId(m.id); setPicking(false); }}>
                    <span className="min-w-0">
                      {m.label}
                      {m.template && m.status !== 'clear' && <div className="pr">{human(m.template)}</div>}
                      {m.status === 'clear' && <div className="pr">{m.template ? `→ ${human(m.template)}` : 'removed'}</div>}
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <span className={`sev ${m.ignored ? 'info' : look ? 'warn' : cls}`}>{m.ignored ? (m.kind === 'para' ? 'Kept as is' : "Bank's text") : look ? 'Check' : text}{m.confidence !== null && m.status !== 'needs' && !m.ignored ? ` · ${Math.round(m.confidence)}%` : ''}</span>
                      {m.confirmed && <span className="sub" style={{ fontFamily: 'var(--f-body)' }}>✓ accepted</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </section>

        <aside className="grid content-start gap-3">
          {sel && (
            <Panel title={<span className="flex items-center gap-2"><span className={`sev ${(PILL[sel.status ?? 'match'] ?? PILL.match)[0]}`}>{(PILL[sel.status ?? 'match'] ?? PILL.match)[1]}</span></span>}>
              <div className="grid gap-2 text-[13.5px]">
                <b className="text-[15px]">{sel.label}</b>
                {sel.status === 'clear' ? (
                  <>
                    <div><span className="sub">In the uploaded file</span><div className="snip" style={{ whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}>{sel.sample || '(images or empty lines)'}</div></div>
                    <div><span className="sub">Prints instead</span><div>{sel.template ? human(sel.template) : 'Nothing: removed. ValueMitra adds its own photographs, map and annexure pages.'}</div></div>
                  </>
                ) : (
                  <>
                    {sel.template && <div><span className="sub">Prints</span><div>{human(sel.template)}</div></div>}
                    {[...new Set([...(sel.template ?? '').matchAll(TAG_RE)].map((x) => x[1]))].map((c) => {
                      const nf = proposed.get(c);
                      const src = nf?.sources ?? byCode.get(c)?.sources ?? [];
                      return (
                        <div key={c} className="rounded-[var(--r)] bg-sunk px-3 py-2">
                          <b>{labelOf(c)}</b> <span className="sub mono">{c}</span>
                          {nf && <div className="sub">New field · {nf.scope === 'bank' ? 'kept for this bank only' : 'joins the shared list'}{nf.default_text ? ` · prints “${nf.default_text}” until filled` : ''}</div>}
                          {src.length > 0 && <div className="sub">Value comes from: {src.map((s) => SOURCE[s] ?? s.replace(/_/g, ' ')).join(', ')}</div>}
                        </div>
                      );
                    })}
                    {sel.sample && <div className="sub">In the uploaded file: “{sel.sample.slice(0, 160)}”</div>}
                  </>
                )}
                {sel.note && <p className="sub m-0">{sel.note}</p>}
                {sel.confidence !== null && sel.status !== 'needs' && <div className="sub">Confidence {Math.round(sel.confidence)}%{(sel.confidence ?? 0) < READY && !sel.confirmed ? ' · check this one' : ''}</div>}
                {sel.status === 'needs' && sel.ask && (
                  <div className="grid gap-1.5">
                    <b>{sel.ask.question}</b>
                    {sel.ask.options.map((o, i) => (
                      <label key={i} className="flex items-start gap-2 font-normal">
                        <input type="radio" name={`ask-${sel.id}`} disabled={!edit || busy} checked={sel.answer === o.label} onChange={() => answer.mutate({ mid: sel.id, option: i }, { onSuccess: () => goNext(sel) })} />
                        <span>{o.label}<div className="sub mono">{human(o.template)}</div></span>
                      </label>
                    ))}
                  </div>
                )}
                {edit && (
                  <div className="btns mt-1">
                    {(!sel.confirmed || sel.ignored) && sel.status !== 'needs' && (sel.field_code || sel.status === 'clear' || sel.ignored) && (
                      <button className="btn sm pri" disabled={busy} onClick={() => patch.mutate({ mid: sel.id, body: {} }, { onSuccess: () => goNext(sel) })}>{sel.ignored ? "Use the AI's version" : 'Accept'}</button>
                    )}
                    {sel.kind !== 'para' && <button className="btn sm" disabled={busy} onClick={() => setPicking((x) => !x)}>{sel.field_code ? 'Use a different field' : 'Choose a field'}</button>}
                    {!sel.ignored && <button className="btn sm ghost" disabled={busy} onClick={() => patch.mutate({ mid: sel.id, body: { ignore: true } }, { onSuccess: () => goNext(sel) })}>{sel.kind === 'para' ? 'Keep the original text' : "Keep as the bank's fixed text"}</button>}
                  </div>
                )}
                {edit && picking && <Picker value={sel.field_code} suggestions={sel.suggestions} disabled={busy} onPick={(code) => patch.mutate({ mid: sel.id, body: { fieldCode: code } }, { onSuccess: () => goNext(sel) })} />}
              </div>
            </Panel>
          )}

          <Panel title={open.length ? `${open.filter(needsYou).length} item(s) need you` : 'Everything accepted'}>
            <div className="grid gap-2">
              <div className="sub">{ready.length ? `${ready.length} item(s) are ready: matched or new at ${READY}% or above, and cleared text.` : open.length ? 'Answer or check the amber items.' : 'Preview with a case, then publish.'}</div>
              {edit && ready.length > 0 && <button className="btn pri" disabled={busy} onClick={() => acceptReady.mutate()}>Accept all ready items ({ready.length})</button>}
            </div>
          </Panel>

          {ai.new_fields.length > 0 && (
            <Panel title={`New fields (${ai.new_fields.length})`}>
              <ul className="m-0 grid gap-1 pl-4 text-[13px]">
                {ai.new_fields.map((f) => <li key={f.code}>{f.label} <span className="sub">{f.scope === 'bank' ? '· this bank only' : ''}{f.sources.includes('site_sheet') ? ' · added to the site sheet' : ''}</span></li>)}
              </ul>
              <p className="sub mb-0 mt-2">Created when you publish. Site questions are added to the engineer's sheet.</p>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}
