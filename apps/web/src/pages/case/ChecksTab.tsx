// Checks: what blocks valuer review, what to look at, what passed. Conflicts resolve inline;
// warnings can be accepted with a reason.
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { SEVERITY_LABEL, type Severity } from '@vm/shared';
import { Empty, Loading, Modal, fmtDate, useErrorToast, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { caseKey, TABS, type TabKey, type TabProps } from './context';

interface Item {
  id: number; check_code: string; severity: Severity; title: string; detail: string | null; target_tab: string | null;
  status: 'open' | 'accepted' | 'passed' | 'info'; accepted_reason: string | null; accepted_at?: string | null; actions: any;
}
interface Summary { blocked: boolean; crit: number; warn: number; accepted: number; ok: number; info: number; items: Item[] }

const TAB_KEYS = new Set(TABS.map((t) => t.key));

export default function ChecksTab({ c, go, refresh, locked }: TabProps) {
  const { can } = useAuth();
  const toast = useToast();
  const err = useErrorToast();
  const q = useQuery({ queryKey: caseKey(c.id, 'checks'), queryFn: () => api.get<Summary>(`/api/assignments/${c.id}/checks`) });
  const [accepting, setAccepting] = useState<Item | null>(null);
  const [reason, setReason] = useState('');
  const canEdit = can('edit') && !locked;

  const run = useMutation({
    mutationFn: () => api.post<Summary>(`/api/assignments/${c.id}/checks/run`),
    onSuccess: (s) => { toast(s.crit ? `${s.crit} to resolve` : 'All clear for valuer review'); refresh(); },
    onError: err,
  });
  const resolve = useMutation({
    mutationFn: (b: { field: string; option: number }) => api.post(`/api/assignments/${c.id}/fields/${encodeURIComponent(b.field)}/resolve`, { option: b.option }),
    onSuccess: () => { toast('Resolved and recorded in the report'); refresh(); },
    onError: err,
  });
  const accept = useMutation({
    mutationFn: (b: { id: number; reason: string }) => api.post(`/api/assignments/${c.id}/checks/${b.id}/accept`, { reason: b.reason }),
    onSuccess: () => { toast('Accepted with reason'); setAccepting(null); setReason(''); refresh(); },
    onError: err,
  });

  if (q.isLoading) return <Loading />;
  if (!q.data) return <Empty title="Checks could not be loaded" />;
  const s = q.data;
  const warnTotal = s.warn + s.accepted;

  return (
    <div className="grid gap-4">
      <section className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-4">
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-[18px]">
            {s.crit ? `${s.crit} to resolve before valuer review` : <>Ready for valuer review <span className="chip c-review">Clear</span></>}
          </h2>
          <div className="sub mt-1">{warnTotal} to look at{s.accepted ? ` (${s.accepted} accepted)` : ''} · {s.ok} passed · {s.info} for information</div>
        </div>
        <button className="btn" disabled={run.isPending} onClick={() => run.mutate()}>{run.isPending ? <span className="dots">Checking</span> : 'Run checks again'}</button>
      </section>

      {s.items.length === 0 ? <p className="sub">No checks have run yet.</p> : (
        <div className="panel overflow-hidden">
          {s.items.map((it, i) => {
            const conflict = it.actions && typeof it.actions.field === 'string' && Array.isArray(it.actions.options) ? (it.actions as { field: string; options: { label: string; display: string }[] }) : null;
            const target = it.target_tab && TAB_KEYS.has(it.target_tab as TabKey) ? (it.target_tab as TabKey) : null;
            const sevClass = it.status === 'accepted' ? 'ok' : it.severity;
            return (
              <div key={it.id} className={`ck2 ${it.severity}`} style={i ? { borderTop: '1px solid var(--line)' } : undefined}>
                <span className={`sev ${sevClass}`}>{it.status === 'accepted' ? 'Accepted' : SEVERITY_LABEL[it.severity] ?? it.severity}</span>
                <div className="min-w-0">
                  <b>{it.title}</b>
                  {it.detail && <p style={{ whiteSpace: 'pre-wrap' }}>{it.detail}</p>}
                  {it.status === 'accepted' && it.accepted_reason && <p><span className="text-ok font-semibold">Accepted{it.accepted_at ? ` ${fmtDate(it.accepted_at, true)}` : ''}:</span> “{it.accepted_reason}”</p>}
                  {conflict && it.status === 'open' && canEdit && (
                    <div className="btns mt-2">
                      {conflict.options.map((o, k) => (
                        <button key={k} className="btn sm" disabled={resolve.isPending} onClick={() => resolve.mutate({ field: conflict.field, option: k })} title={o.label}>
                          {o.display || o.label}{o.display && o.label && o.label !== o.display ? <span className="sub">· {o.label}</span> : null}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="btns justify-end">
                  {it.severity === 'warn' && it.status === 'open' && canEdit && <button className="btn sm ghost" onClick={() => { setAccepting(it); setReason(''); }}>Accept</button>}
                  {target && <button className="btn sm" onClick={() => go(target)}>Open</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={!!accepting}
        onClose={() => setAccepting(null)}
        title="Accept this item"
        actions={<>
          <button className="btn ghost" onClick={() => setAccepting(null)}>Cancel</button>
          <button className="btn pri" disabled={!reason.trim() || accept.isPending} onClick={() => accepting && accept.mutate({ id: accepting.id, reason: reason.trim() })}>Accept with reason</button>
        </>}
      >
        {accepting && (
          <div className="grid gap-3">
            <div><b>{accepting.title}</b>{accepting.detail && <div className="sub">{accepting.detail}</div>}</div>
            <div className="field">
              <label>Reason (kept in the audit trail)</label>
              <textarea rows={3} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Bank expects the society name board photo" />
            </div>
            <p className="sub m-0">If the underlying facts change, the item opens again.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
