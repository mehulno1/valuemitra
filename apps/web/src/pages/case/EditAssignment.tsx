// Edit assignment (13 Nov re-test A3, A4): every field of the create form, for anyone on the case, at any
// stage before signing. The field engineer is assigned or changed here too. Every change goes to the audit trail.
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { PROPERTY_TYPES, RECEIVED_VIA } from '@vm/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Field, Modal, useErrorToast, useToast } from '@/components/ui';
import { BranchPicker, formatWords, SourcedByPicker, type Branch } from '@/components/CasePickers';
import type { CaseHeader } from './context';

interface Meta { banks: { id: number; code: string; name: string }[]; branches: Branch[]; engineers: { id: number; name: string; localities: string | null }[]; team: { id: number; name: string; role: string }[] }
interface Tpl { id: number; hidden?: boolean; name: string; bank_code: string | null; property_types: string[]; branch_scope: string[]; versions: { status: string }[] }

export function useEditAssignment(c: CaseHeader, refresh: () => void) {
  const [open, setOpen] = useState(false);
  const { can } = useAuth();
  const allowed = !c.signed_at && can('edit');
  const node = allowed ? <EditAssignment c={c} open={open} onClose={() => setOpen(false)} refresh={refresh} /> : null;
  return { open: () => setOpen(true), allowed, node };
}

function EditAssignment({ c, open, onClose, refresh }: { c: CaseHeader; open: boolean; onClose: () => void; refresh: () => void }) {
  const toast = useToast();
  const onErr = useErrorToast();
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api.get<Meta>('/api/meta'), enabled: open });
  const tpls = useQuery({ queryKey: ['templates'], queryFn: () => api.get<Tpl[]>('/api/templates'), enabled: open });
  const init = () => ({
    bankId: c.bank_id ?? 0, branchId: c.branch_id ?? 0, propertyType: c.property_type, templateId: c.template_id ?? 0,
    borrowerName: c.borrower_name ?? '', sourcedById: c.sourced_by_id ?? 0, makerId: c.maker_id ?? 0, checkerId: c.checker_id ?? 0,
    engineerId: c.engineer_id ?? 0, bankRefNo: c.bank_ref_no ?? '', bankContact: c.bank_contact ?? '', receivedVia: c.received_via ?? '',
    purpose: c.purpose ?? '', localityHint: c.locality_hint ?? '',
  });
  const [f, setF] = useState(init);
  useEffect(() => { if (open) setF(init()); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof ReturnType<typeof init>>(k: K, v: ReturnType<typeof init>[K]) => setF((x) => ({ ...x, [k]: v }));
  const bank = meta.data?.banks.find((b) => b.id === f.bankId);
  const branch = meta.data?.branches.find((b) => b.id === f.branchId);
  useEffect(() => {
    if (!meta.data) return;
    const list = meta.data.branches.filter((b) => b.bank_id === f.bankId);
    if (list.length && !list.some((b) => b.id === f.branchId)) set('branchId', list[0].id);
  }, [f.bankId, meta.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const formats = useMemo(() => (tpls.data ?? []).filter((t) => !t.hidden && t.bank_code === bank?.code && t.property_types.includes(f.propertyType) && t.versions.some((v) => v.status === 'published')
    && (t.branch_scope.includes('*') || (!!branch && t.branch_scope.includes(branch.code)))), [tpls.data, bank, branch, f.propertyType]);
  useEffect(() => { if (formats.length && !formats.some((t) => t.id === f.templateId)) set('templateId', formats[0].id); }, [formats]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => {
      const b: Record<string, unknown> = {};
      const o = init();
      const diff = (k: keyof typeof o, out: string, empty: unknown = null) => { if (f[k] !== o[k]) b[out] = f[k] === '' || f[k] === 0 ? empty : f[k]; };
      diff('bankId', 'bankId'); diff('branchId', 'branchId'); diff('propertyType', 'propertyType'); diff('templateId', 'templateId');
      diff('borrowerName', 'borrowerName'); diff('sourcedById', 'sourcedById'); diff('makerId', 'makerId'); diff('checkerId', 'checkerId');
      diff('engineerId', 'engineerId'); diff('bankRefNo', 'bankRefNo'); diff('bankContact', 'bankContact'); diff('receivedVia', 'receivedVia');
      diff('purpose', 'purpose', undefined); diff('localityHint', 'localityHint');
      return api.patch(`/api/assignments/${c.id}`, b);
    },
    onSuccess: () => { toast('Assignment saved'); onClose(); refresh(); },
    onError: onErr,
  });

  const team = meta.data?.team ?? [];
  const makers = team.filter((p) => ['maker', 'checker', 'valuer'].includes(p.role));
  const checkers = team.filter((p) => ['checker', 'valuer'].includes(p.role) && p.id !== f.makerId);
  return (
    <Modal open={open} onClose={onClose} title="Edit assignment" actions={<>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn pri" disabled={save.isPending || !meta.data || !f.branchId || !formats.length} onClick={() => save.mutate()}>Save</button>
    </>}>
      {!meta.data ? <p className="sub">Loading…</p> : (
        <div className="form max-h-[70vh] overflow-y-auto pr-1">
          <Field label="Bank">
            <select value={f.bankId} onChange={(e) => set('bankId', Number(e.target.value))}>{meta.data.banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}</select>
          </Field>
          <BranchPicker bankId={f.bankId} branches={meta.data.branches} value={f.branchId} onChange={(id) => set('branchId', id)} />
          <Field label="Borrower name"><input value={f.borrowerName} onChange={(e) => set('borrowerName', e.target.value)} /></Field>
          <Field label="Property type">
            <select value={f.propertyType} onChange={(e) => set('propertyType', e.target.value)}>{PROPERTY_TYPES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
          </Field>
          <Field label="Report format" full hint={formats.length ? formatWords(formats.find((t) => t.id === f.templateId)?.name ?? '').hint : 'No published format for this bank, branch and property type'}>
            <select value={f.templateId} onChange={(e) => set('templateId', Number(e.target.value))} disabled={!formats.length}>{formats.map((t) => <option key={t.id} value={t.id}>{formatWords(t.name).label}</option>)}</select>
          </Field>
          <SourcedByPicker value={f.sourcedById} onChange={(id) => set('sourcedById', id)} />
          <Field label="Report maker">
            <select value={f.makerId} onChange={(e) => { const v = Number(e.target.value); setF((x) => ({ ...x, makerId: v, checkerId: x.checkerId === v ? 0 : x.checkerId })); }}>
              <option value={0}>Not assigned</option>{makers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Report checker">
            <select value={f.checkerId} onChange={(e) => set('checkerId', Number(e.target.value))}><option value={0}>Not assigned</option>{checkers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </Field>
          <Field label="Field engineer" full>
            <select value={f.engineerId} onChange={(e) => set('engineerId', Number(e.target.value))}>
              <option value={0}>Not assigned</option>{meta.data.engineers.map((e) => <option key={e.id} value={e.id}>{e.name}{e.localities ? ` · ${e.localities}` : ''}</option>)}
            </select>
          </Field>
          <Field label="Application no." hint="The bank's own number (optional)"><input value={f.bankRefNo} onChange={(e) => set('bankRefNo', e.target.value)} /></Field>
          <Field label="Bank contact"><input value={f.bankContact} onChange={(e) => set('bankContact', e.target.value)} /></Field>
          <Field label="Received via">
            <select value={f.receivedVia} onChange={(e) => set('receivedVia', e.target.value)}><option value="">—</option>{RECEIVED_VIA.map((v) => <option key={v}>{v}</option>)}</select>
          </Field>
          <Field label="Purpose"><input value={f.purpose} onChange={(e) => set('purpose', e.target.value)} /></Field>
          <Field label="Locality" full><input value={f.localityHint} onChange={(e) => set('localityHint', e.target.value)} /></Field>
          <p className="sub field full">A change of bank, branch, property type or format applies to the draft from now; values already captured carry over.</p>
        </div>
      )}
    </Modal>
  );
}
