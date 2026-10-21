// New assignment: intake form plus an ID card showing the case ID now and the report number at sign-off.
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { PROPERTY_TYPES, RECEIVED_VIA } from '@vm/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Empty, Field, Loading, PageHead, Panel, useErrorToast, useToast } from '@/components/ui';

interface Meta {
  banks: { id: number; code: string; name: string; short_name?: string }[];
  branches: { id: number; bank_id: number; code: string; name: string; bank_code: string; contact_name: string | null; contact_role: string | null }[];
  engineers: { id: number; name: string; localities: string | null; phone: string | null }[];
  flags: Record<string, boolean>;
}
interface Tpl { id: number; name: string; bank_code: string | null; property_types: string[]; branch_scope: string[]; versions: { status: string; version: number }[] }

/** Score an engineer by how many words of the locality appear in their localities. */
function engineerScore(localities: string | null, hint: string) {
  if (!localities || !hint.trim()) return 0;
  const l = localities.toLowerCase();
  const words = hint.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !['society', 'road', 'west', 'east', 'near', 'the', 'bldg', 'flat'].includes(w));
  return words.reduce((s, w) => s + (l.includes(w) ? 1 : 0), 0);
}

export default function NewAssignment() {
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const onErr = useErrorToast();
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api.get<Meta>('/api/meta') });
  const tpls = useQuery({ queryKey: ['templates'], queryFn: () => api.get<Tpl[]>('/api/templates') });

  const [f, setF] = useState({ bankId: 0, branchId: 0, bankContact: '', receivedVia: 'WhatsApp', bankRefNo: '', borrowerName: '', propertyType: 'flat', localityHint: '', purpose: '', engineerId: 0 });
  const [engTouched, setEngTouched] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const branches = useMemo(() => (meta.data?.branches ?? []).filter((b) => b.bank_id === f.bankId), [meta.data, f.bankId]);
  const bank = meta.data?.banks.find((b) => b.id === f.bankId);
  const branch = branches.find((b) => b.id === f.branchId);

  // defaults: first bank that has branches and a published format (else any bank with branches)
  useEffect(() => {
    if (!meta.data || !tpls.data || f.bankId) return;
    const withBranches = meta.data.banks.filter((b) => meta.data!.branches.some((br) => br.bank_id === b.id));
    const live = (code: string) => tpls.data!.some((t) => t.bank_code === code && t.versions.some((v) => v.status === 'published'));
    const first = withBranches.find((b) => live(b.code)) ?? withBranches[0];
    if (first) set('bankId', first.id);
  }, [meta.data, tpls.data, f.bankId]);
  // branch follows bank
  useEffect(() => {
    if (!branches.length) { if (f.branchId) set('branchId', 0); return; }
    if (!branches.some((b) => b.id === f.branchId)) set('branchId', branches[0].id);
  }, [branches, f.branchId]);
  // contact prefilled from branch
  useEffect(() => {
    if (branch) set('bankContact', [branch.contact_name, branch.contact_role && `(${branch.contact_role})`].filter(Boolean).join(' '));
  }, [branch?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ranked = useMemo(() => (meta.data?.engineers ?? []).map((e) => ({ e, s: engineerScore(e.localities, f.localityHint) })).sort((a, b) => b.s - a.s), [meta.data, f.localityHint]);
  const suggested = ranked[0]?.s ? ranked[0].e : null;
  useEffect(() => { if (!engTouched && suggested) set('engineerId', suggested.id); }, [suggested?.id, engTouched]); // eslint-disable-line react-hooks/exhaustive-deps

  const preview = useQuery({
    queryKey: ['id-preview', f.bankId, f.branchId],
    queryFn: () => api.get<{ caseNo: string; reportNo: string; fy: string }>(`/api/assignments/id-preview?bankId=${f.bankId || ''}&branchId=${f.branchId || ''}`),
    placeholderData: (p) => p,
  });

  const format = useMemo(() => {
    if (!bank || !tpls.data) return null;
    const live = tpls.data.filter((t) => t.bank_code === bank.code && t.property_types.includes(f.propertyType) && t.versions.some((v) => v.status === 'published'));
    return live.find((t) => branch && t.branch_scope.includes(branch.code)) ?? live.find((t) => t.branch_scope.includes('*')) ?? null;
  }, [bank, branch, tpls.data, f.propertyType]);

  const create = useMutation({
    mutationFn: () => api.post<{ id: number; caseNo: string }>('/api/assignments', {
      bankId: f.bankId, branchId: f.branchId, bankContact: f.bankContact || null, receivedVia: f.receivedVia || null, bankRefNo: f.bankRefNo || null,
      borrowerName: f.borrowerName || null, propertyType: f.propertyType, localityHint: f.localityHint || null, purpose: f.purpose || null, engineerId: f.engineerId || null,
    }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['board'] });
      toast(`Case ${r.caseNo} created`);
      nav(`/cases/${r.id}/docs`);
    },
    onError: onErr,
  });

  if (!can('create')) return <Empty title="New assignment">Your account cannot create cases. Ask an admin to grant “Create cases”.</Empty>;
  if (meta.isLoading) return <Loading />;
  if (meta.isError) return <Empty title="Could not load">{(meta.error as Error).message}</Empty>;

  const caseParts = preview.data?.caseNo.split(/[-/]/) ?? [];
  const reportParts = preview.data?.reportNo.split('/') ?? [];
  const ready = f.bankId && f.branchId && f.propertyType;

  return (
    <>
      <PageHead
        eyebrow="Valuation Assignments"
        title="New assignment"
        actions={<>
          <button className="btn" onClick={() => nav('/')}>Cancel</button>
          <button className="btn pri" disabled={!ready || create.isPending} onClick={() => create.mutate()}>{create.isPending ? 'Creating…' : 'Create assignment'}</button>
        </>}
      />
      <div className="cols">
        <section className="panel">
          <form className="form" onSubmit={(e) => { e.preventDefault(); if (ready) create.mutate(); }}>
            <h3>Assignment</h3>
            <Field label="Bank">
              <select value={f.bankId} onChange={(e) => set('bankId', Number(e.target.value))}>
                <option value={0} disabled>Choose bank</option>
                {meta.data!.banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
              </select>
            </Field>
            <Field label="Branch" hint={f.bankId && !branches.length ? 'No branches for this bank yet. Add one in Firm settings → Banks & branches.' : undefined}>
              <select value={f.branchId} onChange={(e) => set('branchId', Number(e.target.value))} disabled={!branches.length}>
                {!branches.length && <option value={0}>No branches</option>}
                {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
              </select>
            </Field>
            <Field label="Bank contact"><input value={f.bankContact} onChange={(e) => set('bankContact', e.target.value)} placeholder="Mr. Joshi (Credit officer)" /></Field>
            <Field label="Received via">
              <select value={f.receivedVia} onChange={(e) => set('receivedVia', e.target.value)}>{RECEIVED_VIA.map((v) => <option key={v}>{v}</option>)}</select>
            </Field>
            <Field label="Bank reference no." hint="Optional: the bank's application or file number"><input value={f.bankRefNo} onChange={(e) => set('bankRefNo', e.target.value)} /></Field>
            <Field label="Purpose" hint="Optional, e.g. Home loan, Top-up, Takeover"><input value={f.purpose} onChange={(e) => set('purpose', e.target.value)} /></Field>

            <h3>Borrower and property</h3>
            <Field label="Borrower name"><input value={f.borrowerName} onChange={(e) => set('borrowerName', e.target.value)} autoComplete="off" /></Field>
            <Field label="Property type">
              <select value={f.propertyType} onChange={(e) => set('propertyType', e.target.value)}>{PROPERTY_TYPES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
            </Field>
            <Field label="Locality (rough, from the call)" full><input value={f.localityHint} onChange={(e) => set('localityHint', e.target.value)} placeholder="Vrindavan Society, Majiwada, Thane (W)" /></Field>
            <Field label="Report format" full hint="Picked automatically from bank and property type">
              <input readOnly value={format ? `${bank?.code} · ${format.name}` : tpls.isLoading ? 'Checking…' : 'No published format for this bank and property type. Add one under Bank formats.'} className={format ? '' : 'text-crit'} />
            </Field>

            <h3>Site visit</h3>
            <Field label="Field engineer" full hint={suggested ? 'Suggested by locality. Call to confirm availability, then create the case.' : 'Type the locality above to get a suggestion. Call to confirm availability, then create the case.'}>
              <select value={f.engineerId} onChange={(e) => { setEngTouched(true); set('engineerId', Number(e.target.value)); }}>
                <option value={0}>Assign later</option>
                {ranked.map(({ e, s }) => <option key={e.id} value={e.id}>{e.name}{e.localities ? ` · ${e.localities}` : ''}{s > 0 && e.id === suggested?.id ? ' (suggested)' : ''}</option>)}
              </select>
            </Field>
          </form>
        </section>

        <aside className="grid gap-3">
          <Panel title="IDs for this case">
            <div className="grid gap-4">
              <div>
                <div className="eyebrow">Case ID · given now</div>
                <div className="mono mt-1 text-[20px] font-semibold">{preview.data?.caseNo ?? '…'}</div>
                {caseParts.length >= 3 && (
                  <div className="sub mt-1">{caseParts[0]} = system · {caseParts[1]} = FY {preview.data?.fy} · {caseParts.slice(2).join('-')} = running no.</div>
                )}
              </div>
              <div>
                <div className="eyebrow">Report no. · given at valuer sign-off</div>
                <div className="mono mt-1 text-[15px] font-semibold break-all">{preview.data?.reportNo ?? '…'}</div>
                {reportParts.length >= 5 && <div className="sub mt-1">firm / bank / branch / FY / report serial</div>}
              </div>
              <div className="sub grid gap-1.5 border-t border-line pt-3">
                <p className="m-0">Gaps in case IDs are fine: a cancelled case keeps its number.</p>
                <p className="m-0">Report numbers have no gaps. The next serial is issued only when the valuer signs, so the register is continuous.</p>
                <p className="m-0">A reissued report keeps its serial and adds /R1, /R2.</p>
              </div>
            </div>
          </Panel>
        </aside>
      </div>
    </>
  );
}
