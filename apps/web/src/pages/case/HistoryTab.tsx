// History: every valuation applied (rate, FMV, reason, draft) and the case's audit trail.
import { useQuery } from '@tanstack/react-query';
import { inr } from '@vm/shared';
import { Panel, fmtDate } from '@/components/ui';
import { api } from '@/lib/api';
import { caseKey, type TabProps } from './context';

interface ValHist { id: number; adopted_rate: number | string | null; proposed_rate: number | string | null; reason: string | null; draft_version: number | null; created_at: string; fmv: number | null; by: string | null }
interface ValView { history: ValHist[]; proposal: { rate: number | null } | null }
interface Activity { id: number; action: string; summary: string; actor_name: string | null; actor_type: string; reason: string | null; created_at: string }

const rs = (n: number | string | null | undefined) => (n === null || n === undefined || n === '' ? '—' : `Rs. ${inr(Number(n))}`);
const who = (a: Activity) => a.actor_name ?? (a.actor_type === 'system' ? 'System' : a.actor_type === 'engineer' ? 'Field engineer' : a.actor_type);

export default function HistoryTab({ c }: TabProps) {
  const val = useQuery({ queryKey: caseKey(c.id, 'valuation'), queryFn: () => api.get<ValView>(`/api/assignments/${c.id}/valuation`) });
  const act = useQuery({ queryKey: caseKey(c.id, 'activity'), queryFn: () => api.get<Activity[]>(`/api/assignments/${c.id}/activity`) });
  const hist = val.data?.history ?? [];
  const log = act.data ?? [];

  return (
    <div className="grid gap-4">
      <Panel title="Value history" pad={false}>
        {val.isLoading ? (
          <div className="muted p-4"><span className="dots">Loading</span></div>
        ) : !hist.length ? (
          <p className="muted p-4 text-[13px]">
            No values applied yet.{val.data?.proposal?.rate ? ` Evidence-backed rate: ${rs(val.data.proposal.rate)}.` : ''}
          </p>
        ) : (
          <div className="tablewrap">
            <table className="list">
              <thead><tr><th>Time</th><th>By</th><th className="text-right">Rate/sq.ft.</th><th className="text-right">FMV</th><th>Reason</th><th>Draft</th></tr></thead>
              <tbody>
                {hist.map((h) => (
                  <tr key={h.id}>
                    <td className="whitespace-nowrap">{fmtDate(h.created_at, true)}</td>
                    <td>{h.by ?? 'System'}</td>
                    <td className="n mono">
                      {rs(h.adopted_rate)}
                      {h.proposed_rate !== null && Number(h.proposed_rate) !== Number(h.adopted_rate) && <div className="sub">proposed {rs(h.proposed_rate)}</div>}
                    </td>
                    <td className="n mono">{rs(h.fmv)}</td>
                    <td className="min-w-[160px]">{h.reason || '—'}</td>
                    <td className="whitespace-nowrap">{h.draft_version ? `v${h.draft_version}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Audit trail" right={<span className="tag">{log.length} entr{log.length === 1 ? 'y' : 'ies'}</span>} pad={false}>
        {act.isLoading ? (
          <div className="muted p-4"><span className="dots">Loading</span></div>
        ) : !log.length ? (
          <p className="muted p-4 text-[13px]">Nothing recorded yet.</p>
        ) : (
          <div className="tablewrap">
            <table className="list">
              <thead><tr><th>Time</th><th>By</th><th>What happened</th></tr></thead>
              <tbody>
                {log.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap">{fmtDate(a.created_at, true)}</td>
                    <td className="whitespace-nowrap">{who(a)}</td>
                    <td className="min-w-[220px]">
                      {a.summary}
                      {a.reason && <div className="sub">Reason: {a.reason}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="sub border-t border-line px-4 py-2">Kept for the retention period in Firm settings.</p>
      </Panel>
    </div>
  );
}
