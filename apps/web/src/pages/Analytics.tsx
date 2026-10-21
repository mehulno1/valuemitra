// Reports & analytics: throughput, turnaround and time per stage, banks, localities, property
// types and field engineers, from the firm's signed reports; every chart exports as CSV.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { inr } from '@vm/shared';
import { api, saveCsv } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Bars, Columns } from '@/components/charts';
import { Field, Loading, PageHead, Panel } from '@/components/ui';

interface Data {
  weeks: number; from: string;
  kpis: { reports: number; perWorkingDay: number; casesCreated: number; inProgress: number; avgTatHours: number | null; medianTatHours: number | null; fmvTotal: number; gvGapPct: number | null; over20: number; withGuideline: number };
  weekly: { week_ending: string; reports: number }[];
  banks: { label: string; reports: number }[]; localities: { label: string; reports: number }[]; types: { label: string; reports: number }[];
  stages: { stage: string; label: string; avg_hours: number; cases: number }[];
  engineers: { name: string; visits: number; reports: number; avg_tat_hours: number | null }[];
  rows: { report_no: string; signed: string; case_no: string; bank: string; branch: string; locality: string; type: string; area: number | null; rate: number | null; fmv: number | null; guideline: number | null; engineer: string; tat_hours: number | null }[];
}

const hours = (h: number | null) => (h === null ? '—' : h >= 48 ? `${(h / 24).toFixed(1)} days` : `${h.toFixed(1)} h`);
const crore = (n: number) => (n >= 1e7 ? `Rs. ${(n / 1e7).toFixed(1)} Cr` : `Rs. ${(n / 1e5).toFixed(1)} L`);

export default function Analytics() {
  const { can } = useAuth();
  const [weeks, setWeeks] = useState(12);
  const [bankId, setBankId] = useState(0);
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api.get<{ banks: { id: number; code: string; name: string }[] }>('/api/meta') });
  const q = useQuery({ queryKey: ['analytics', weeks, bankId], queryFn: () => api.get<Data>(`/api/analytics?weeks=${weeks}${bankId ? `&bankId=${bankId}` : ''}`) });
  const d = q.data;
  const exp = can('exp');
  const tag = `${weeks}w${bankId ? `_${meta.data?.banks.find((b) => b.id === bankId)?.code ?? bankId}` : ''}`;
  const X = ({ name, head, rows }: { name: string; head: string[]; rows: unknown[][] }) => (exp ? <button className="btn sm" onClick={() => saveCsv(`${name}_${tag}.csv`, head, rows)}>Export CSV</button> : null);

  return (
    <>
      <PageHead eyebrow="Menu" title="Reports & analytics" />
      <div className="btns mb-4">
        <Field label="Period"><select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>{[4, 8, 12, 26, 52].map((w) => <option key={w} value={w}>Last {w} weeks</option>)}</select></Field>
        <Field label="Bank"><select value={bankId} onChange={(e) => setBankId(Number(e.target.value))}><option value={0}>All banks</option>{(meta.data?.banks ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        {d && exp && <button className="btn self-end" disabled={!d.rows.length} onClick={() => saveCsv(`reports_${tag}.csv`, ['report_no', 'signed', 'case_id', 'bank', 'branch', 'locality', 'property_type', 'area_sqft', 'rate_per_sqft', 'fmv', 'guideline_value', 'field_engineer', 'turnaround_hours'], d.rows.map((r) => [r.report_no, r.signed, r.case_no, r.bank, r.branch, r.locality, r.type, r.area, r.rate, r.fmv, r.guideline, r.engineer, r.tat_hours]))}>Export all rows</button>}
      </div>
      {q.isLoading || !d ? <Loading /> : (
        <>
          <div className="kpis">
            <div className="panel kpi"><div className="l">Reports issued</div><div className="n">{d.kpis.reports.toLocaleString('en-IN')}</div><div className="s">{d.kpis.perWorkingDay} per working day · {d.kpis.casesCreated} cases received</div></div>
            <div className="panel kpi"><div className="l">Average turnaround</div><div className="n">{hours(d.kpis.avgTatHours)}</div><div className="s">case created to report sent{d.kpis.medianTatHours !== null ? ` · median ${hours(d.kpis.medianTatHours)}` : ''}</div></div>
            <div className="panel kpi"><div className="l">Value of property assessed</div><div className="n">{crore(d.kpis.fmvTotal)}</div><div className="s">sum of fair market values</div></div>
            <div className="panel kpi"><div className="l">FMV vs guideline, average</div><div className="n">{d.kpis.gvGapPct === null ? '—' : `${d.kpis.gvGapPct > 0 ? '+' : ''}${d.kpis.gvGapPct}%`}</div><div className="s">{d.kpis.over20} of {d.kpis.withGuideline} needed a 20% justification</div></div>
            <div className="panel kpi"><div className="l">In progress now</div><div className="n">{d.kpis.inProgress}</div><div className="s">cases not yet signed</div></div>
          </div>
          <div className="charts">
            <Panel title="Reports issued per week" right={<X name="reports_per_week" head={['week_ending', 'reports']} rows={d.weekly.map((w) => [w.week_ending, w.reports])} />}>
              <Columns label="Reports issued per week" data={d.weekly.map((w) => ({ x: `${Number(w.week_ending.slice(8))}/${Number(w.week_ending.slice(5, 7))}`, y: w.reports }))} fmt={(v) => `${v} report${v === 1 ? '' : 's'}`} />
              <span className="sub">Week ending date under each column. Hover a column for the count.</span>
            </Panel>
            <Panel title="Where the time goes, average per case" right={<X name="time_per_stage" head={['stage', 'avg_hours', 'cases']} rows={d.stages.map((s) => [s.label, s.avg_hours, s.cases])} />}>
              <Bars label="Average time per stage" data={d.stages.map((s) => ({ x: s.label, y: s.avg_hours }))} fmt={(v) => hours(v)} labelWidth={190} />
              {(() => { const top = [...d.stages].sort((a, b) => b.avg_hours - a.avg_hours)[0]; return top?.avg_hours ? <span className="sub">{top.label} is the longest step.</span> : null; })()}
            </Panel>
            <Panel title="Reports by bank" right={<X name="reports_by_bank" head={['bank', 'reports']} rows={d.banks.map((b) => [b.label, b.reports])} />}>
              <Bars label="Reports by bank" data={d.banks.map((b) => ({ x: b.label, y: b.reports }))} fmt={(v) => v.toLocaleString('en-IN')} />
            </Panel>
            <Panel title="Top localities" right={<X name="reports_by_locality" head={['locality', 'reports']} rows={d.localities.map((b) => [b.label, b.reports])} />}>
              <Bars label="Reports by locality" data={d.localities.map((b) => ({ x: b.label, y: b.reports }))} fmt={(v) => v.toLocaleString('en-IN')} />
            </Panel>
          </div>
          <div className="split">
            <Panel title="Field engineers" right={<X name="field_engineers" head={['engineer', 'site_visits', 'reports', 'avg_turnaround_hours']} rows={d.engineers.map((e) => [e.name, e.visits, e.reports, e.avg_tat_hours])} />} pad={false}>
              <table className="list">
                <thead><tr><th>Engineer</th><th className="n">Site visits</th><th className="n">Reports</th><th className="n">Avg turnaround</th></tr></thead>
                <tbody>
                  {d.engineers.map((e) => <tr key={e.name}><td>{e.name}</td><td className="n mono">{e.visits}</td><td className="n mono">{e.reports}</td><td className="n mono">{hours(e.avg_tat_hours)}</td></tr>)}
                  {!d.engineers.length && <tr><td colSpan={4} className="muted">No site visits in this period.</td></tr>}
                </tbody>
              </table>
            </Panel>
            <Panel title="Property types" right={<X name="reports_by_type" head={['property_type', 'reports']} rows={d.types.map((b) => [b.label, b.reports])} />} pad={false}>
              <table className="list">
                <thead><tr><th>Type</th><th className="n">Reports</th><th className="n">Share</th></tr></thead>
                <tbody>
                  {d.types.map((t) => <tr key={t.label}><td>{t.label}</td><td className="n mono">{t.reports}</td><td className="n mono">{Math.round((t.reports / Math.max(1, d.kpis.reports)) * 100)}%</td></tr>)}
                  {!d.types.length && <tr><td colSpan={3} className="muted">No reports signed in this period.</td></tr>}
                </tbody>
              </table>
            </Panel>
          </div>
          <Panel title="Reports in this period" className="mt-4" pad={false}>
            <div className="tablewrap">
              <table className="list">
                <thead><tr><th>Report no.</th><th>Signed</th><th>Bank</th><th>Locality</th><th className="n">Rate / sq.ft.</th><th className="n">FMV</th><th className="n">Turnaround</th></tr></thead>
                <tbody>
                  {d.rows.slice(-50).reverse().map((r) => <tr key={r.report_no}><td className="mono whitespace-nowrap">{r.report_no}</td><td className="whitespace-nowrap">{r.signed.split('-').reverse().join('/')}</td><td>{r.bank}<div className="sub">{r.branch}</div></td><td>{r.locality}<div className="sub">{r.type}</div></td><td className="n mono">{r.rate ? inr(r.rate) : '—'}</td><td className="n mono">{r.fmv ? inr(r.fmv) : '—'}</td><td className="n mono">{hours(r.tat_hours)}</td></tr>)}
                  {!d.rows.length && <tr><td colSpan={7} className="muted">No reports signed in this period.</td></tr>}
                </tbody>
              </table>
            </div>
            {d.rows.length > 50 && <p className="sub px-4 pb-3">Latest 50 shown; Export all rows for the full list.</p>}
          </Panel>
        </>
      )}
    </>
  );
}
