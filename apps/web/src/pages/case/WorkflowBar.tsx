// Who has the case: coordinator → Report Maker → Report Checker → valuer. Assign the maker and checker,
// hand over with an optional note, or send back with a reason (Universal review A1, B5).
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { HOLDER_LABEL, type Holder } from '@vm/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Field, Modal, useErrorToast, useToast } from '@/components/ui';
import type { CaseHeader } from './context';

interface Person { id: number; name: string; role: string }
const STEP: Record<Holder, string> = { coordinator: 'Coordinator', maker: 'Report maker', checker: 'Report checker', valuer: 'Valuer' };
const ORDER: Holder[] = ['coordinator', 'maker', 'checker', 'valuer'];

export default function WorkflowBar({ c, refresh }: { c: CaseHeader; refresh: () => void }) {
  const { user, can } = useAuth();
  const toast = useToast();
  const onErr = useErrorToast();
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api.get<{ team: Person[] }>('/api/meta') });
  const team = meta.data?.team ?? [];
  const [dlg, setDlg] = useState<{ kind: 'handover' | 'back'; to: Holder } | null>(null);
  const [text, setText] = useState('');
  const holder = (c.holder ?? 'coordinator') as Holder;
  const done = () => { setDlg(null); setText(''); refresh(); };
  const people = useMutation({ mutationFn: (b: { makerId?: number | null; checkerId?: number | null }) => api.post(`/api/assignments/${c.id}/people`, b), onSuccess: () => { toast('Assignment saved'); refresh(); }, onError: onErr });
  const hand = useMutation({ mutationFn: () => api.post(`/api/assignments/${c.id}/handover`, { to: dlg!.to, note: text || null }), onSuccess: () => { toast(`Handed over: ${HOLDER_LABEL[dlg!.to].toLowerCase()}`); done(); }, onError: onErr });
  const back = useMutation({ mutationFn: () => api.post(`/api/assignments/${c.id}/send-back`, { to: dlg!.to, reason: text }), onSuccess: () => { toast('Sent back'); done(); }, onError: onErr });

  if (c.signed_at) return null;
  // the next step forward skips steps nobody is assigned to
  const next = ORDER.slice(ORDER.indexOf(holder) + 1).find((h) => (h === 'maker' ? !!c.maker_id : h === 'checker' ? !!c.checker_id : true)) as Holder | undefined;
  const earlier = ORDER.slice(0, ORDER.indexOf(holder)).filter((h) => (h === 'maker' ? !!c.maker_id : h === 'checker' ? !!c.checker_id : true));
  const mine = user?.role === 'valuer' || (holder === 'coordinator' ? ['coordinator', 'admin'].includes(user?.role ?? '') : holder === 'maker' ? user?.id === c.maker_id : holder === 'checker' ? user?.id === c.checker_id : false);
  const makers = team.filter((p) => ['maker', 'checker', 'valuer'].includes(p.role));
  const checkers = team.filter((p) => ['checker', 'valuer'].includes(p.role) && p.id !== c.maker_id);
  const assign = can('assign');

  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-line pt-3 mt-3">
      <div>
        <div className="eyebrow">Now</div>
        <b>{STEP[holder]}{holder === 'maker' && c.maker_name ? `: ${c.maker_name}` : holder === 'checker' && c.checker_name ? `: ${c.checker_name}` : ''}</b>
        {c.handed_at && <div className="sub">since {new Date(c.handed_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div>}
      </div>
      <Field label="Report maker">
        <select value={c.maker_id ?? ''} disabled={!assign || people.isPending} onChange={(e) => people.mutate({ makerId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Not assigned</option>
          {makers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      <Field label="Report checker">
        <select value={c.checker_id ?? ''} disabled={!assign || people.isPending} onChange={(e) => people.mutate({ checkerId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Not assigned</option>
          {checkers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      {mine && can('edit') && (
        <div className="btns">
          {next && <button className="btn pri sm" onClick={() => setDlg({ kind: 'handover', to: next })}>Send to {STEP[next].toLowerCase()}</button>}
          {!!earlier.length && <button className="btn ghost sm" onClick={() => setDlg({ kind: 'back', to: earlier[earlier.length - 1] })}>Send back</button>}
        </div>
      )}
      <Modal
        open={!!dlg}
        onClose={() => setDlg(null)}
        title={dlg?.kind === 'back' ? 'Send the case back' : `Send to ${dlg ? STEP[dlg.to].toLowerCase() : ''}`}
        actions={<>
          <button className="btn ghost" onClick={() => setDlg(null)}>Cancel</button>
          <button className="btn pri" disabled={(dlg?.kind === 'back' && text.trim().length < 5) || hand.isPending || back.isPending} onClick={() => (dlg?.kind === 'back' ? back.mutate() : hand.mutate())}>{dlg?.kind === 'back' ? 'Send back' : 'Hand over'}</button>
        </>}
      >
        {dlg?.kind === 'back' && (
          <Field label="To"><select value={dlg.to} onChange={(e) => setDlg({ ...dlg, to: e.target.value as Holder })}>{earlier.map((h) => <option key={h} value={h}>{STEP[h]}</option>)}</select></Field>
        )}
        <Field label={dlg?.kind === 'back' ? 'Reason (required)' : 'Note (optional)'}><textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} /></Field>
        {dlg?.kind === 'handover' && <p className="sub">Only this step's checks apply: {dlg.to === 'maker' ? 'documents read and site visit received' : dlg.to === 'checker' ? 'valuation applied and no open items on documents, site, market or valuation' : 'no open items except those for signing'}.</p>}
      </Modal>
    </div>
  );
}
