// Valuation Assignments board: stage tiles (filter), overdue alerts with ready messages, case list.
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { HOLDER_LABEL, HOLDERS, STAGES } from '@vm/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Loading, MessageBox, PageHead, StageChip, ago, useErrorToast } from '@/components/ui';

interface Row {
  id: number; case_no: string; borrower_name: string | null; property: string | null; bank_code: string; bank_short: string; branch_name: string;
  stage: string; stage_label: string; holder?: string; maker_name?: string | null; checker_name?: string | null; docs_got: number; docs_total: number; updated_at: string; engineer_name: string | null; report_no: string | null;
}
interface Alert { severity: 'crit' | 'warn' | 'info'; assignmentId: number; caseNo: string; title: string; detail: string; action: string; purpose: string }

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export default function Board() {
  const { user, can } = useAuth();
  const nav = useNavigate();
  const onErr = useErrorToast();
  const [stage, setStage] = useState<string>('');
  const [holder, setHolder] = useState<string>('');
  const [mine, setMine] = useState(false);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const [msg, setMsg] = useState<{ title: string; text: string; subject?: string | null } | null>(null);

  const board = useQuery({
    queryKey: ['board', stage, q, holder, mine],
    queryFn: () => api.get<{ rows: Row[]; counts: Record<string, number>; holders?: Record<string, number> }>(`/api/assignments?stage=${encodeURIComponent(stage)}&q=${encodeURIComponent(q)}&holder=${holder}&mine=${mine ? 1 : ''}`),
    placeholderData: (p) => p,
  });
  const alerts = useQuery({ queryKey: ['alerts'], queryFn: () => api.get<Alert[]>('/api/assignments/alerts'), refetchInterval: 60_000 });

  const draft = useMutation({
    mutationFn: (a: Alert) => api.post<{ title?: string; subject?: string | null; message: string }>(`/api/assignments/${a.assignmentId}/messages/${a.purpose}`),
    onSuccess: (r, a) => setMsg({ title: r.title ?? (a.purpose === 'engineer_link' ? `Site visit link · ${a.caseNo}` : a.action), text: r.message, subject: r.subject }),
    onError: onErr,
  });

  const act = (a: Alert) => {
    if (a.purpose === 'open') nav(`/cases/${a.assignmentId}/rep`);
    else if (a.purpose === 'output') nav(`/cases/${a.assignmentId}/out`);
    else draft.mutate(a);
  };

  const fy = (() => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-${String((y + 1) % 100).padStart(2, '0')}`; })();
  const counts = board.data?.counts ?? {};
  const rows = board.data?.rows ?? [];
  const total = Object.values(counts).reduce((s, n) => s + n, 0);

  return (
    <>
      <PageHead
        eyebrow={`${user?.firm_name ?? ''} · FY ${fy}`}
        title="Valuation Assignments"
        actions={can('create') && <Link className="btn pri" to="/new">+ New assignment</Link>}
      />

      <div className="stages" role="group" aria-label="Filter by stage">
        {STAGES.map((s) => (
          <button key={s.key} className={`stage ${stage === s.key ? 'on' : ''}`} aria-pressed={stage === s.key} onClick={() => setStage(stage === s.key ? '' : s.key)}>
            <div className="n">{counts[s.key] ?? 0}</div>
            <div className="l">{s.label}</div>
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Filter by who has the case">
        {HOLDERS.map((h) => (
          <button key={h} className={`btn sm ${holder === h ? 'pri' : 'ghost'}`} aria-pressed={holder === h} onClick={() => setHolder(holder === h ? '' : h)}>
            {HOLDER_LABEL[h]} <span className="mono">{board.data?.holders?.[h] ?? 0}</span>
          </button>
        ))}
        <label className="ml-2 flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> My cases</label>
      </div>
      <p className="sub -mt-1 mb-3">Click a stage or a step to show only its cases; click it again to show all. "My cases": the cases you have now, or make or check.</p>

      {alerts.data && !alerts.data.length && (
        <p className="sub mb-4">No overdue cases. An alert appears here when a case waits too long: documents over 4 h, site visit over 6 h, valuer review over 4 h, signed but not dispatched over 2 h.</p>
      )}
      {!!alerts.data?.length && (
        <div className="mb-4 grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {alerts.data.slice(0, 4).map((a) => (
            <div key={`${a.assignmentId}-${a.purpose}`} className="panel grid content-between gap-2 p-3" style={{ borderLeft: `4px solid var(--${a.severity === 'info' ? 'muted' : a.severity})` }}>
              <div>
                <div className="flex items-start justify-between gap-2"><b className="text-[13.5px]">{a.title}</b><span className={`sev ${a.severity}`}>{a.severity === 'crit' ? 'Overdue' : a.severity === 'warn' ? 'Late' : 'Info'}</span></div>
                <div className="sub">{a.detail}</div>
              </div>
              <div><button className="btn sm" disabled={draft.isPending && draft.variables?.assignmentId === a.assignmentId} onClick={() => act(a)}>{a.action}</button></div>
            </div>
          ))}
        </div>
      )}

      {msg && <div className="mb-4"><MessageBox title={msg.title} text={msg.text} subject={msg.subject} onClose={() => setMsg(null)} /></div>}

      <section className="panel">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h3 className="text-[14px] font-semibold">
            {stage ? STAGES.find((s) => s.key === stage)?.label : 'All assignments'}
            {stage && <button className="linkbtn ml-3" onClick={() => setStage('')}>Show all</button>}
          </h3>
          <input className="inp" style={{ maxWidth: 300 }} type="search" placeholder="Search case ID, borrower or locality" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search assignments" />
        </div>
        {board.isLoading ? <Loading /> : board.isError ? <div className="p-4 text-crit">{(board.error as Error).message}</div> : (
          <div className="tablewrap">
            <table className="list click">
              <thead>
                <tr><th>Case ID</th><th>Borrower &amp; property</th><th>Bank · branch</th><th>Stage</th><th>With</th><th>Documents</th><th>Updated</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const pct = r.docs_total ? Math.round((r.docs_got / r.docs_total) * 100) : 0;
                  return (
                    <tr key={r.id} onClick={() => nav(`/cases/${r.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && nav(`/cases/${r.id}`)}>
                      <td className="mono">{r.case_no}{r.report_no && <div className="sub mono">{r.report_no}</div>}</td>
                      <td><b className="font-semibold">{r.borrower_name || <span className="muted">Borrower not entered</span>}</b><div className="sub">{r.property || '—'}</div></td>
                      <td>{r.bank_short || r.bank_code}<div className="sub">{r.branch_name}</div></td>
                      <td><StageChip stage={r.stage} /></td>
                      <td className="sub">{r.report_no ? '—' : HOLDER_LABEL[(r.holder ?? 'coordinator') as keyof typeof HOLDER_LABEL]?.replace('With ', '')}{(r.maker_name || r.checker_name) && <div className="sub">{[r.maker_name && `RM ${r.maker_name}`, r.checker_name && `RC ${r.checker_name}`].filter(Boolean).join(' · ')}</div>}</td>
                      <td><span className="mono">{r.docs_got}/{r.docs_total}</span><div className="bar"><i style={{ width: `${pct}%` }} /></div></td>
                      <td className="sub whitespace-nowrap">{ago(r.updated_at)}</td>
                    </tr>
                  );
                })}
                {!rows.length && (
                  <tr><td colSpan={7} className="muted">
                    {stage ? 'No assignments at this stage.' : q ? 'No assignments match your search.' : total === 0 ? 'No assignments yet. Start with "+ New assignment".' : 'No assignments.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
