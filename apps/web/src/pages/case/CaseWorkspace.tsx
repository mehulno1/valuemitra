import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useEffect } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { PROPERTY_TYPES } from '@vm/shared';
import { Loading, StageChip } from '@/components/ui';
import { api } from '@/lib/api';
import { caseKey, TABS, useCaseRefresh, type CaseHeader, type TabKey } from './context';

const Documents = lazy(() => import('./DocumentsTab'));
const Extracted = lazy(() => import('./ExtractedTab'));
const Site = lazy(() => import('./SiteTab'));
const Market = lazy(() => import('./MarketTab'));
const Valuation = lazy(() => import('./ValuationTab'));
const Checks = lazy(() => import('./ChecksTab'));
const Report = lazy(() => import('./ReportTab'));
const Output = lazy(() => import('./OutputTab'));
const History = lazy(() => import('./HistoryTab'));

const COMPONENTS: Record<TabKey, React.ComponentType<any>> = { docs: Documents, ext: Extracted, site: Site, mkt: Market, val: Valuation, chk: Checks, rep: Report, out: Output, hist: History };

export default function CaseWorkspace() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const loc = useLocation();
  const refresh = useCaseRefresh(id);
  const head = useQuery({ queryKey: caseKey(id, 'head'), queryFn: () => api.get<CaseHeader>(`/api/assignments/${id}`), refetchInterval: 8000 });
  const checks = useQuery({ queryKey: caseKey(id, 'checks'), queryFn: () => api.get(`/api/assignments/${id}/checks`), refetchInterval: 10000 });
  const docs = useQuery({ queryKey: caseKey(id, 'checklist'), queryFn: () => api.get<any[]>(`/api/assignments/${id}/checklist`) });
  const tab = (loc.pathname.split('/')[3] ?? 'docs') as TabKey;

  useEffect(() => { window.scrollTo(0, 0); }, [tab]);

  if (head.isLoading) return <Loading />;
  if (!head.data) return <div className="muted">Case not found.</div>;
  const c = head.data;
  const go = (t: TabKey) => nav(`/cases/${id}/${t}`);
  const locked = !!c.signed_at;
  const got = (docs.data ?? []).filter((d) => d.state === 'y').length;
  const total = (docs.data ?? []).filter((d) => d.state !== 'na').length;
  const crit = checks.data?.crit ?? 0;
  const reached = (s: string) => c.stages.some((x) => x.to_stage === s) || ['site', 'draft', 'review', 'signed', 'sent', 'billed', 'paid'].indexOf(c.stage) >= ['site', 'draft', 'review', 'signed', 'sent', 'billed', 'paid'].indexOf(s);
  const status = c.stage === 'paid' ? 'Paid' : c.stage === 'billed' ? 'Billed · awaiting payment' : c.sent_at ? 'Sent to bank' : c.signed_at ? 'Signed · to dispatch' : crit ? `Checks: ${crit} open` : c.stage === 'review' ? 'Ready for valuer review' : c.stage_label;

  return (
    <div>
      <section className="panel casehead">
        <div>
          <div className="eyebrow">Case <span className="mono">{c.case_no}</span></div>
          <h1>{c.borrower_name ?? 'Borrower to be confirmed'}{c.locality_hint ? ` · ${c.locality_hint}` : ''}</h1>
          <div className="caseids">
            <span>Bank <b>{c.bank_code}, {c.branch_name}</b></span>
            <span>Format <b>{c.template_name}{c.template_version ? ` v${c.template_version}` : ''}</b></span>
            <span>Property <b>{PROPERTY_TYPES.find((p) => p.key === c.property_type)?.label}</b></span>
            <span>Report no. <b className="mono">{c.report_no ?? 'issued at sign-off'}</b></span>
            <span>Field engineer <b>{c.engineer_name ?? 'not assigned'}</b></span>
          </div>
          <div className="progress">
            <span className={`pstep ${total && got >= Math.min(total, 5) ? 'done' : got ? 'live' : ''}`}>Documents {got}/{total}</span>
            <span className={`pstep ${reached('site') ? 'done' : ''}`}>Extraction {reached('site') ? 'done' : 'waiting'}</span>
            <span className={`pstep ${reached('draft') ? 'done' : reached('site') ? 'live' : ''}`}>Site visit {reached('draft') ? 'received' : 'assigned'}</span>
            <span className={`pstep ${reached('review') ? 'done' : ''}`}>Valuation {reached('review') ? 'done' : 'waiting'}</span>
            <span className={`pstep ${c.signed_at ? 'done' : c.draft_version ? 'live' : ''}`}>{c.signed_at ? 'Report final' : c.draft_version ? `Report draft v${c.draft_version}` : 'Report not started'}</span>
            <span className={`pstep ${crit ? '' : 'done'}`}>{status}</span>
          </div>
        </div>
        <div className="grid justify-items-end gap-2">
          <StageChip stage={c.stage} />
          <Link className="btn sm ghost" to="/">Back to assignments</Link>
        </div>
      </section>
      <nav className="tabs" aria-label="Case sections">
        {TABS.map((t) => (
          <Link key={t.key} to={`/cases/${id}/${t.key}`} className={tab === t.key ? 'on' : ''}>
            {t.label}{t.key === 'chk' && crit > 0 && <span className="badge">{crit}</span>}
          </Link>
        ))}
      </nav>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route index element={<Navigate to="docs" replace />} />
          {TABS.map((t) => {
            const C = COMPONENTS[t.key];
            return <Route key={t.key} path={t.key} element={<C c={c} go={go} refresh={refresh} locked={locked} />} />;
          })}
        </Routes>
      </Suspense>
    </div>
  );
}
