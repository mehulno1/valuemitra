// The bank's form as it reads (retest of 13 Nov, H4), for every format: each line of the prepared file in order,
// its fields in plain words, and a tag: Ready, New field, Question for you, or the bank's own text. Pick a case to
// see what each field prints. The standard sections (photos, map, ready reckoner, listings, sale transactions,
// documents) are one line: ValueMitra's own pages print there, each can be left out (Undo).
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Loading, Panel, useErrorToast } from '@/components/ui';

type Seg = { t: string } | { code: string; label: string; value?: string };
interface Line { id: string; kind: 'para' | 'row'; segs: Seg[]; status: 'ready' | 'new' | 'question' | 'text'; mappingIds: number[] }
interface Form { lines: Line[]; cleared: { id: number; label: string; sample: string | null; kept: boolean; replacedBy: string | null }[]; counts: Record<string, number> }

const TAG: Record<Line['status'], [string, string]> = { ready: ['ok', 'Ready'], new: ['new', 'New field'], question: ['warn', 'Question for you'], text: ['info', "Bank's text"] };

export default function FormAsItReads({ vid, mappings, edit, annexOff, annexSections, onAnnex, annexBusy }: {
  vid: number; mappings: { id: number; field_code: string | null; confirmed: boolean }[]; edit: boolean;
  annexOff: string[]; annexSections: { key: string; label: string }[]; onAnnex: (off: string[]) => void; annexBusy?: boolean;
}) {
  const qc = useQueryClient();
  const onErr = useErrorToast();
  const cases = useQuery({ queryKey: ['board', '', ''], queryFn: () => api.get<{ rows: { id: number; case_no: string; borrower_name: string | null }[] }>('/api/assignments?stage=&q=') });
  const [aid, setAid] = useState(0);
  const [show, setShow] = useState<'all' | Line['status'] | 'cleared'>('all');
  const [bankText, setBankText] = useState(true);
  const form = useQuery({ queryKey: ['tplform', vid, aid, mappings.filter((m) => m.confirmed).length], queryFn: () => api.get<Form>(`/api/templates/versions/${vid}/form${aid ? `?assignmentId=${aid}` : ''}`) });
  const accept = useMutation({
    mutationFn: async (ids: number[]) => { for (const id of ids) { const m = mappings.find((x) => x.id === id); if (m && !m.confirmed) await api.patch(`/api/templates/versions/${vid}/mappings/${id}`, m.field_code ? { fieldCode: m.field_code } : {}); } },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tplv', vid] }); qc.invalidateQueries({ queryKey: ['tplform', vid] }); },
    onError: onErr,
  });
  if (form.isLoading) return <Panel title="The bank's form as it reads"><Loading what="Reading the format" /></Panel>;
  if (!form.data) return null;
  const f = form.data;
  const on = annexSections.filter((s) => !annexOff.includes(s.key));
  const tile = (k: typeof show, n: number, label: string) => (
    <button className="rv-tile" aria-pressed={show === k} onClick={() => setShow(show === k ? 'all' : k)}><div className="n">{n}</div><div className="sub">{label}</div></button>
  );
  const lines = f.lines.filter((l) => (show === 'all' ? bankText || l.status !== 'text' : l.status === show));
  return (
    <div className="grid gap-4">
      <div className="rv-tiles">
        {tile('ready', f.counts.ready ?? 0, 'Ready')}
        {tile('new', f.counts.new ?? 0, 'New fields')}
        {tile('question', f.counts.question ?? 0, 'Questions for you')}
        {tile('cleared', f.counts.cleared ?? 0, 'Earlier-case text cleared')}
        {tile('text', f.counts.text ?? 0, "Lines of the bank's own text")}
      </div>

      <div className="panel p-3">
        <b>{on.length} standard section{on.length === 1 ? '' : 's'} found and replaced</b>
        <span className="sub"> · the same in every bank's report, so no questions: ValueMitra's own pages print in their place, laid out by Report layout below</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {annexSections.map((s) => {
            const off = annexOff.includes(s.key);
            return (
              <span key={s.key} className="flex items-center gap-1.5 rounded-full border border-line py-1 pl-3 pr-1.5 text-[13px]" style={off ? { opacity: 0.65 } : undefined} title={off ? 'Left out of this format' : 'Printed by ValueMitra'}>
                {off ? <s>{s.label}</s> : s.label}
                {edit && <button className="linkbtn" disabled={annexBusy} onClick={() => onAnnex(off ? annexOff.filter((k) => k !== s.key) : [...annexOff, s.key])}>{off ? 'Print' : 'Undo'}</button>}
              </span>
            );
          })}
        </div>
      </div>

      <section className="panel min-w-0 rv-paper" style={{ paddingBottom: 10 }}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3" style={{ fontFamily: 'var(--f-body)' }}>
          <div><b>The bank's form as it reads</b><div className="sub">Each line as it prints, fields in [brackets]. Pick a case to see what each field prints.</div></div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={bankText} onChange={(e) => setBankText(e.target.checked)} /> Show the bank's own text</label>
            <select className="inp" style={{ maxWidth: 260 }} value={aid} onChange={(e) => setAid(Number(e.target.value))} aria-label="Case to fill the form with">
              <option value={0}>Fields only (no case)</option>
              {(cases.data?.rows ?? []).map((r) => <option key={r.id} value={r.id}>{r.case_no}{r.borrower_name ? ` · ${r.borrower_name}` : ''}</option>)}
            </select>
          </div>
        </div>
        {show === 'cleared' ? (
          <div className="grid gap-2 px-4 py-3" style={{ fontFamily: 'var(--f-body)' }}>
            {!f.cleared.length && <div className="sub">Nothing was cleared: the file had no earlier case's details.</div>}
            {f.cleared.map((c) => <div key={c.id}><b>{c.label}</b>{c.kept ? <span className="sub"> · kept as in the file</span> : <span className="sub"> · removed{c.replacedBy ? ', replaced' : ''}</span>}{c.sample && <div className="snip" style={{ fontSize: 12.5 }}>{c.sample.slice(0, 200)}</div>}</div>)}
          </div>
        ) : (
          <div className="grid content-start overflow-auto" style={{ maxHeight: '70vh' }}>
            {lines.map((l) => (
              <div key={l.id} className="flex items-start justify-between gap-3 border-b border-line px-4 py-1.5" style={l.status === 'text' ? { color: 'var(--muted)' } : l.status === 'question' ? { background: 'var(--warn-soft)' } : undefined}>
                <span className="min-w-0" style={{ whiteSpace: 'pre-wrap' }}>
                  {l.segs.map((s, i) => ('t' in s ? <span key={i}>{s.t}</span> : (
                    <span key={i} title={s.code} className="rounded px-1" style={{ background: aid ? 'transparent' : 'var(--sunk)', borderBottom: aid ? '1px dotted var(--stamp)' : undefined, fontFamily: aid ? undefined : 'var(--f-body)', fontSize: aid ? undefined : 12.5 }}>
                      {aid ? (s.value?.trim() ? s.value : <i className="sub">[{s.label}: blank for this case]</i>) : `[${s.label}]`}
                    </span>
                  )))}
                </span>
                {l.status !== 'text' && (
                  <span className="flex shrink-0 items-center gap-2">
                    <span className={`sev ${TAG[l.status][0]}`}>{TAG[l.status][1]}</span>
                    {l.status === 'question' && edit && <button className="btn sm" disabled={accept.isPending} onClick={() => accept.mutate(l.mappingIds)}>Accept</button>}
                  </span>
                )}
              </div>
            ))}
            {!lines.length && <div className="sub px-4 py-3">No lines in this view.</div>}
          </div>
        )}
      </section>
    </div>
  );
}
