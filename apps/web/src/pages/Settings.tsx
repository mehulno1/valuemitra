// Firm settings: firm & valuer, branding, numbering, valuation rules (versioned), report layout,
// field engineers, banks & branches, users & permissions, retention & privacy, features.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { PERMISSIONS, ROLE_LABEL, ROLES, canHoldPermission, fillPattern, financialYear, pad, type Permission, type Role } from '@vm/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Field, FileImg, Loading, Modal, PageHead, Panel, ago, fmtDate, useErrorToast, useToast } from '@/components/ui';

// ---- types -----------------------------------------------------------------------------------------
interface FirmSettings {
  case_pattern: string; report_pattern: string; file_pattern: string; letterhead_file_id: number | null; signature_file_id: number | null; seal_file_id: number | null;
  doc_grid: number; photo_grid: number; evidence_per_page: number; retention_years: number; kyc_policy: 'never' | 'delete_30' | 'delete_90'; engineer_link_hours: number; place: string; billing_enabled: boolean;
}
interface FirmProfile {
  firm: { id: number; code: string; name: string; address: string | null; city: string | null; state_code: string | null; gstin: string | null; phone: string | null; email: string | null; shared_pool_consent: number };
  settings: FirmSettings;
  valuer: { id: number; name: string; qualifications: string | null; ibbi_reg_no: string | null; ibbi_valid_upto: string | null } | null;
  nextCase: number; nextReport: number; fy: string;
}
interface Bank { id: number; code: string; name: string; short_name?: string }
interface Branch { id: number; bank_id: number; code: string; name: string; bank_code: string; bank_name: string; contact_name: string | null; contact_role: string | null; contact_email: string | null; contact_phone: string | null; gstin: string | null; default_payer: string; billing_cycle: string; fee: number | null; city?: string | null }
interface Engineer { id: number; name: string; phone: string | null; email?: string | null; localities: string | null; fee_per_visit: number | null }
interface Meta { banks: Bank[]; branches: Branch[]; engineers: Engineer[]; flags: Record<string, boolean> }
interface ConfigVersion { id: number; firm_id: number | null; version: number; status: 'draft' | 'published' | 'retired'; effective_from: string | null; payload: any; change_note: string | null; published_at: string | null; created_at: string }

const useFirm = () => useQuery({ queryKey: ['firm'], queryFn: () => api.get<FirmProfile>('/api/firm') });
const useMeta = () => useQuery({ queryKey: ['meta'], queryFn: () => api.get<Meta>('/api/meta') });

function useFirmSave() {
  const qc = useQueryClient();
  const toast = useToast();
  const onErr = useErrorToast();
  return useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch<FirmProfile>('/api/firm', patch),
    onSuccess: (d) => { qc.setQueryData(['firm'], d); toast('Saved'); },
    onError: onErr,
  });
}

const ReadOnlyNote = ({ perm = 'Settings' }: { perm?: string }) => <div className="sub mb-3">You can view these settings. Changing them needs the “{perm}” permission.</div>;

/** Local form state seeded from server data; re-seeds when the data changes. */
function useForm<T>(seed: T | undefined) {
  const [v, setV] = useState<T | undefined>(seed);
  const key = JSON.stringify(seed);
  useEffect(() => { setV(seed); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(v) !== key;
  return [v, setV, dirty] as const;
}

// ---- 1. firm and valuer -------------------------------------------------------------------------------
function FirmSection() {
  const { can } = useAuth();
  const firm = useFirm();
  const save = useFirmSave();
  const d = firm.data;
  const seed = d && {
    name: d.firm.name ?? '', address: d.firm.address ?? '', city: d.firm.city ?? '', state_code: d.firm.state_code ?? '', gstin: d.firm.gstin ?? '', phone: d.firm.phone ?? '', email: d.firm.email ?? '', place: d.settings.place ?? '',
    qualifications: d.valuer?.qualifications ?? '', ibbi_reg_no: d.valuer?.ibbi_reg_no ?? '', ibbi_valid_upto: d.valuer?.ibbi_valid_upto ? String(d.valuer.ibbi_valid_upto).slice(0, 10) : '',
  };
  const [f, setF, dirty] = useForm(seed);
  if (!f || !d) return <Loading />;
  const ro = !can('set');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <section className="panel">
      <form className="form" onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ name: f.name, address: f.address, city: f.city, state_code: f.state_code, gstin: f.gstin, phone: f.phone, email: f.email, settings: { place: f.place },
          ...(d.valuer ? { valuer: { qualifications: f.qualifications, ibbi_reg_no: f.ibbi_reg_no, ibbi_valid_upto: f.ibbi_valid_upto || null } } : {}) });
      }}>
        {ro && <div className="full"><ReadOnlyNote /></div>}
        <h3>Firm</h3>
        <Field label="Firm name" full><input value={f.name} onChange={set('name')} disabled={ro} /></Field>
        <Field label="Office address" full><textarea rows={2} value={f.address} onChange={set('address')} disabled={ro} /></Field>
        <Field label="City"><input value={f.city} onChange={set('city')} disabled={ro} /></Field>
        <Field label="State code" hint="GST state code, e.g. 27 for Maharashtra"><input value={f.state_code} onChange={set('state_code')} disabled={ro} maxLength={2} /></Field>
        <Field label="GSTIN"><input className="mono" value={f.gstin} onChange={set('gstin')} disabled={ro} /></Field>
        <Field label="Phone"><input value={f.phone} onChange={set('phone')} disabled={ro} /></Field>
        <Field label="Email"><input type="email" value={f.email} onChange={set('email')} disabled={ro} /></Field>
        <Field label="Place (printed next to the signature)"><input value={f.place} onChange={set('place')} disabled={ro} placeholder="Thane" /></Field>
        <h3>Valuer</h3>
        {d.valuer ? (
          <>
            <Field label="Valuer name" hint="Change the name under Users & permissions"><input value={d.valuer.name} disabled /></Field>
            <Field label="Qualifications"><input value={f.qualifications} onChange={set('qualifications')} disabled={ro} /></Field>
            <Field label="IBBI registration no."><input className="mono" value={f.ibbi_reg_no} onChange={set('ibbi_reg_no')} disabled={ro} /></Field>
            <Field label="Registration valid up to"><input type="date" value={f.ibbi_valid_upto} onChange={set('ibbi_valid_upto')} disabled={ro} /></Field>
          </>
        ) : <div className="full sub">No active user with the Valuer role. Add one under Users & permissions.</div>}
        {!ro && <div className="full btns"><button className="btn pri" disabled={!dirty || save.isPending}>Save</button></div>}
      </form>
    </section>
  );
}

// ---- 2. letterhead, signature, seal -----------------------------------------------------------------
function BrandingSection() {
  const { can } = useAuth();
  const firm = useFirm();
  const qc = useQueryClient();
  const toast = useToast();
  const onErr = useErrorToast();
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const up = useMutation({
    mutationFn: ({ kind, file }: { kind: string; file: File | null }) => (file ? api.upload(`/api/firm/branding/${kind}`, [file]) : api.del(`/api/firm/branding/${kind}`)),
    onSuccess: (_r, { file }) => { qc.invalidateQueries({ queryKey: ['firm'] }); toast(file ? 'Uploaded. Used on signed reports.' : 'Removed'); },
    onError: onErr,
  });
  if (!firm.data) return <Loading />;
  const s = firm.data.settings;
  const items = [
    { kind: 'letterhead', title: 'Letterhead', hint: 'Wide image, placed at the top of every report page', id: s.letterhead_file_id, h: 90 },
    { kind: 'signature', title: 'Signature', hint: 'PNG with transparent background works best', id: s.signature_file_id, h: 90 },
    { kind: 'seal', title: 'Round seal', hint: 'Square PNG; also used small on every page', id: s.seal_file_id, h: 110 },
  ];
  return (
    <Panel title="Letterhead, signature and seal">
      {!can('set') && <ReadOnlyNote />}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {items.map((it) => (
          <div key={it.kind} className="grid content-start gap-2">
            <b>{it.title}</b>
            <div className="grid place-items-center rounded-md border border-line bg-sunk p-2" style={{ minHeight: it.h + 16 }}>
              {it.id ? <FileImg id={it.id} alt={it.title} style={{ maxHeight: it.h, maxWidth: '100%', objectFit: 'contain', aspectRatio: 'auto' }} /> : <span className="sub">Not set</span>}
            </div>
            <div className="sub">{it.hint}</div>
            {can('set') && (
              <div className="btns">
                <button className="btn sm" disabled={up.isPending} onClick={() => inputs.current[it.kind]?.click()}>{it.id ? 'Replace' : 'Upload'}</button>
                {it.id && <button className="btn sm ghost danger" disabled={up.isPending} onClick={() => up.mutate({ kind: it.kind, file: null })}>Remove</button>}
                <input ref={(el) => { inputs.current[it.kind] = el; }} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) up.mutate({ kind: it.kind, file: f }); }} />
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="sub mb-0 mt-4">Placed only when the valuer approves and signs. Drafts carry a DRAFT watermark instead.</p>
    </Panel>
  );
}

// ---- 3. case and report numbers ---------------------------------------------------------------------
function NumbersSection() {
  const { can } = useAuth();
  const firm = useFirm();
  const meta = useMeta();
  const save = useFirmSave();
  const d = firm.data;
  const seed = d && { code: d.firm.code, nextCase: String(d.nextCase), nextReport: String(d.nextReport), case_pattern: d.settings.case_pattern, report_pattern: d.settings.report_pattern, file_pattern: d.settings.file_pattern };
  const [f, setF, dirty] = useForm(seed);
  if (!f || !d) return <Loading />;
  const ro = !can('set');
  const fy = financialYear();
  const br = meta.data?.branches.find((b) => b.bank_code === 'SBI') ?? meta.data?.branches[0];
  const vars = { FY: fy.short, FYC: fy.compact, FIRM: f.code, BANK: br?.bank_code ?? 'SBI', BRANCH: br?.code ?? 'BRANCH' };
  const caseNo = fillPattern(f.case_pattern, { ...vars, N: pad(Number(f.nextCase) || 1) });
  const reportNo = fillPattern(f.report_pattern, { ...vars, N: pad(Number(f.nextReport) || 1) });
  const fileName = fillPattern(f.file_pattern, { ...vars, CASE: caseNo, BORROWER: 'Patil', UNIT: 'Flat34' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: k === 'code' ? e.target.value.toUpperCase() : e.target.value });
  return (
    <div className="cols">
      <section className="panel">
        <form className="form" onSubmit={(e) => {
          e.preventDefault();
          const patch: Record<string, unknown> = { settings: { case_pattern: f.case_pattern, report_pattern: f.report_pattern, file_pattern: f.file_pattern } };
          if (f.code !== d.firm.code) patch.code = f.code;
          if (Number(f.nextCase) !== d.nextCase) patch.nextCase = Number(f.nextCase);
          if (Number(f.nextReport) !== d.nextReport) patch.nextReport = Number(f.nextReport);
          save.mutate(patch);
        }}>
          {ro && <div className="full"><ReadOnlyNote /></div>}
          <Field label="Firm code" hint="2 to 10 capital letters or digits; used in report numbers"><input className="mono" value={f.code} onChange={set('code')} disabled={ro} maxLength={10} /></Field>
          <div />
          <Field label={`Next case no. (FY ${d.fy})`} hint="Can only move forward"><input type="number" min={d.nextCase} value={f.nextCase} onChange={set('nextCase')} disabled={ro} /></Field>
          <Field label={`Next report no. (FY ${d.fy})`} hint="Continue your current series"><input type="number" min={1} value={f.nextReport} onChange={set('nextReport')} disabled={ro} /></Field>
          <h3>Patterns</h3>
          <Field label="Case ID pattern" hint="{FYC} = 2526, {FY} = 25-26, {N} = running no."><input className="mono" value={f.case_pattern} onChange={set('case_pattern')} disabled={ro} /></Field>
          <Field label="Report no. pattern" hint="{FIRM} {BANK} {BRANCH} {FY} {N}"><input className="mono" value={f.report_pattern} onChange={set('report_pattern')} disabled={ro} /></Field>
          <Field label="File name pattern" full hint="{CASE} {BORROWER} {UNIT} {BANK} {BRANCH}"><input className="mono" value={f.file_pattern} onChange={set('file_pattern')} disabled={ro} /></Field>
          {!ro && <div className="full btns"><button className="btn pri" disabled={!dirty || save.isPending}>Save</button></div>}
        </form>
      </section>
      <aside>
        <Panel title="Preview">
          <div className="grid gap-3">
            <div><div className="eyebrow">Next case ID</div><div className="mono text-[17px] font-semibold">{caseNo}</div></div>
            <div><div className="eyebrow">Next report no.{br ? ` (${br.bank_code}, ${br.name})` : ''}</div><div className="mono break-all text-[15px] font-semibold">{reportNo}</div></div>
            <div><div className="eyebrow">File name</div><div className="mono break-all text-[13px]">{fileName}.pdf</div></div>
            <p className="sub m-0 border-t border-line pt-3">Case IDs are given when a case is created; gaps are fine. Report numbers are issued only at valuer sign-off, one firm-wide series per financial year with no gaps. Reissues add /R1, /R2.</p>
          </div>
        </Panel>
      </aside>
    </div>
  );
}

// ---- 4. valuation rules (versioned rule set) ---------------------------------------------------------
const RULES: { k: string; label: string; hint?: string; step?: string }[] = [
  { k: 'distress_pct', label: 'Distress value, % of FMV' },
  { k: 'loading_pct', label: 'Loading on carpet, %', hint: 'Built-up = carpet × (1 + loading)' },
  { k: 'saleable_factor', label: 'Saleable factor', hint: 'Saleable = built-up × factor', step: '0.01' },
  { k: 'building_cost_per_sqft', label: 'Building cost / sq.ft.', hint: 'For insurable value' },
  { k: 'rental_yield_pct', label: 'Rental yield, % a year', step: '0.1' },
  { k: 'building_life_years', label: 'Building life, years' },
  { k: 'gv_variation_pct', label: 'FMV vs guideline value trigger, %', hint: 'Above this, the report needs a justification' },
  { k: 'rate_deviation_pct', label: 'Rate deviation from evidence, %', hint: 'Above this, a reason is required' },
  { k: 'comparable_window_months', label: 'Comparables: window, months' },
  { k: 'comparable_radius_km', label: 'Comparables: radius, km', step: '0.1' },
  { k: 'listing_discount_pct', label: 'Listing discount, %', hint: 'Asking prices are reduced by this' },
];

function RulesSection() {
  const { can, user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const onErr = useErrorToast();
  const meta = useMeta();
  const list = useQuery({ queryKey: ['config', 'rule_set', 'firm'], queryFn: () => api.get<ConfigVersion[]>('/api/admin/config/rule_set?key=firm') });
  const versions = list.data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const live = (fid: number | null) => versions.filter((v) => v.firm_id === fid && v.status === 'published' && (!v.effective_from || v.effective_from.slice(0, 10) <= today)).sort((a, b) => b.version - a.version)[0];
  const active = live(user!.firm_id) ?? live(null);
  const draft = versions.find((v) => v.status === 'draft' && v.firm_id === user!.firm_id);
  const base = draft ?? active;
  const [p, setP, dirty] = useForm<any>(base?.payload);
  const [note, setNote] = useState('');
  const [eff, setEff] = useState(today);
  const ro = !can('config');

  const saveDraft = useMutation({
    mutationFn: () => api.put<ConfigVersion>('/api/admin/config/rule_set/firm', { payload: p, note: note || null }),
    onSuccess: () => { toast('Draft saved. Publish it to use it for new cases.'); qc.invalidateQueries({ queryKey: ['config', 'rule_set'] }); },
    onError: onErr,
  });
  const publish = useMutation({
    mutationFn: (id: number) => api.post(`/api/admin/config/version/${id}/publish`, { effectiveFrom: eff }),
    onSuccess: () => { toast('Published. New cases use these rules.'); qc.invalidateQueries({ queryKey: ['config', 'rule_set'] }); },
    onError: onErr,
  });
  const discard = useMutation({
    mutationFn: (id: number) => api.del(`/api/admin/config/version/${id}`),
    onSuccess: () => { toast('Draft discarded'); qc.invalidateQueries({ queryKey: ['config', 'rule_set'] }); },
    onError: onErr,
  });

  if (list.isLoading || !p) return <Loading />;
  const defs = p.defaults ?? {};
  const banks = p.banks ?? {};
  const num = (v: string) => (v === '' ? null : Number(v));
  const setDef = (k: string, v: string) => setP({ ...p, defaults: { ...defs, [k]: num(v) } });
  const setBank = (code: string, v: string) => setP({ ...p, banks: { ...banks, [code]: { ...(banks[code] ?? {}), realizable_pct: num(v) } } });
  const bankList: Bank[] = meta.data?.banks ?? Object.keys(banks).map((code, i) => ({ id: i, code, name: code }));

  return (
    <div className="cols">
      <section className="panel">
        <form className="form" onSubmit={(e) => { e.preventDefault(); saveDraft.mutate(); }}>
          {ro && <div className="full"><ReadOnlyNote perm="Master data & templates" /></div>}
          <div className="full flex flex-wrap items-center gap-2">
            {draft ? <span className="sev warn">Editing draft v{draft.version}</span> : <span className="sev ok">Showing active v{active?.version}{active?.firm_id === null ? ' (platform default)' : ''}</span>}
            {dirty && <span className="sub">Unsaved changes</span>}
          </div>
          <h3>Realizable value, % of FMV, by bank</h3>
          {bankList.map((b) => (
            <Field key={b.code} label={`${b.short_name ?? b.code}`} hint={banks[b.code] ? undefined : `Uses the default (${defs.realizable_pct ?? '—'}%)`}>
              <input type="number" step="0.5" value={banks[b.code]?.realizable_pct ?? ''} placeholder={String(defs.realizable_pct ?? '')} onChange={(e) => setBank(b.code, e.target.value)} disabled={ro} />
            </Field>
          ))}
          <Field label="Default realizable %" hint="For banks without their own figure"><input type="number" step="0.5" value={defs.realizable_pct ?? ''} onChange={(e) => setDef('realizable_pct', e.target.value)} disabled={ro} /></Field>
          <h3>Rates and factors</h3>
          {RULES.map((r) => (
            <Field key={r.k} label={r.label} hint={r.hint}><input type="number" step={r.step ?? '1'} value={defs[r.k] ?? ''} onChange={(e) => setDef(r.k, e.target.value)} disabled={ro} /></Field>
          ))}
          {!ro && (
            <>
              <Field label="Change note" full><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why are the rules changing?" /></Field>
              <div className="full btns"><button className="btn pri" disabled={!dirty || saveDraft.isPending}>{draft ? 'Save draft' : 'Save as draft'}</button></div>
            </>
          )}
        </form>
      </section>
      <aside className="grid gap-3">
        {draft && !ro && (
          <Panel title={`Draft v${draft.version}`}>
            <div className="grid gap-3">
              <div className="sub">{draft.change_note || 'No note'} · saved {ago(draft.created_at)}</div>
              <Field label="Effective from"><input type="date" value={eff} onChange={(e) => setEff(e.target.value)} /></Field>
              <div className="btns">
                <button className="btn pri" disabled={dirty || publish.isPending} title={dirty ? 'Save the draft first' : undefined} onClick={() => publish.mutate(draft.id)}>Publish</button>
                <button className="btn danger" disabled={discard.isPending} onClick={() => window.confirm('Discard this draft?') && discard.mutate(draft.id)}>Discard</button>
              </div>
              {dirty && <div className="sub">Save the draft before publishing.</div>}
            </div>
          </Panel>
        )}
        <Panel title="Versions">
          <div className="grid gap-2">
            {versions.map((v) => (
              <div key={v.id} className="flex items-start justify-between gap-2 text-[13px]">
                <div><b>v{v.version}</b> {v.firm_id === null && <span className="tag">platform</span>}<div className="sub">{v.change_note}</div></div>
                <div className="text-right"><span className={`sev ${v.status === 'published' ? (v.id === active?.id ? 'ok' : 'info') : v.status === 'draft' ? 'warn' : 'info'}`}>{v.status === 'published' ? (v.id === active?.id ? 'Active' : 'Scheduled') : v.status}</span><div className="sub">{fmtDate(v.effective_from)}</div></div>
              </div>
            ))}
          </div>
          <p className="sub mb-0 mt-3 border-t border-line pt-3">New cases use the published version; existing cases keep the version they were created with. Each bank's report uses its own realizable % automatically.</p>
        </Panel>
      </aside>
    </div>
  );
}

// ---- 5. report layout ------------------------------------------------------------------------------
function LayoutSection() {
  const { can } = useAuth();
  const firm = useFirm();
  const save = useFirmSave();
  if (!firm.data) return <Loading />;
  const s = firm.data.settings;
  const ro = !can('set');
  return (
    <Panel title="Report layout">
      {ro && <ReadOnlyNote />}
      <div className="form" style={{ padding: 0 }}>
        <Field label="Site photos per page"><select disabled><option>9 (3×3)</option></select></Field>
        <Field label="Document pages per page" hint="Copies of documents attached at the end of the report">
          <select value={s.doc_grid} disabled={ro || save.isPending} onChange={(e) => save.mutate({ settings: { doc_grid: Number(e.target.value) } })}>
            <option value={9}>9 (3×3)</option><option value={4}>4 (2×2)</option><option value={1}>1 (full page)</option>
          </select>
        </Field>
        <Field label="Listings and evidence per page"><select disabled><option>2 (one above the other)</option></select></Field>
        <Field label="Engineer visit link valid for, hours">
          <select value={s.engineer_link_hours} disabled={ro || save.isPending} onChange={(e) => save.mutate({ settings: { engineer_link_hours: Number(e.target.value) } })}>
            {[24, 48, 72, 120, 168].map((h) => <option key={h} value={h}>{h} h</option>)}
          </select>
        </Field>
      </div>
    </Panel>
  );
}

// ---- 6. field engineers ----------------------------------------------------------------------------
function EngineersSection() {
  const { can } = useAuth();
  const meta = useMeta();
  const qc = useQueryClient();
  const toast = useToast();
  const onErr = useErrorToast();
  const blank = { id: 0, name: '', phone: '', localities: '', fee_per_visit: '' };
  const [edit, setEdit] = useState<typeof blank | null>(null);
  const save = useMutation({
    mutationFn: (e: typeof blank) => api.post<Engineer[]>('/api/engineers', { ...(e.id ? { id: e.id } : {}), name: e.name, phone: e.phone || undefined, localities: e.localities || undefined, fee_per_visit: e.fee_per_visit === '' ? null : Number(e.fee_per_visit) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['meta'] }); toast('Engineer saved'); setEdit(null); },
    onError: onErr,
  });
  const ro = !can('set');
  return (
    <Panel title="Field engineers" right={!ro && <button className="btn sm pri" onClick={() => setEdit(blank)}>+ Add engineer</button>} pad={false}>
      <div className="tablewrap">
        <table className="list">
          <thead><tr><th>Name</th><th>Localities</th><th>Phone</th><th className="n">Fee / visit</th>{!ro && <th />}</tr></thead>
          <tbody>
            {(meta.data?.engineers ?? []).map((e) => (
              <tr key={e.id}>
                <td><b className="font-semibold">{e.name}</b></td><td>{e.localities || <span className="muted">—</span>}</td><td className="mono">{e.phone}</td>
                <td className="n mono">{e.fee_per_visit != null ? Number(e.fee_per_visit).toLocaleString('en-IN') : '—'}</td>
                {!ro && <td><button className="btn sm ghost" onClick={() => setEdit({ id: e.id, name: e.name, phone: e.phone ?? '', localities: e.localities ?? '', fee_per_visit: e.fee_per_visit != null ? String(e.fee_per_visit) : '' })}>Edit</button></td>}
              </tr>
            ))}
            {!meta.data?.engineers.length && <tr><td colSpan={5} className="muted">No field engineers yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="sub mx-4 my-3">Localities are used to suggest an engineer on a new assignment. Engineers have no login; they get a visit link per case.</p>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit field engineer' : 'Add field engineer'}
        actions={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn pri" disabled={!edit?.name.trim() || save.isPending} onClick={() => edit && save.mutate(edit)}>Save</button></>}>
        {edit && (
          <div className="form" style={{ padding: 0 }}>
            <Field label="Name"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></Field>
            <Field label="Phone (WhatsApp)"><input type="tel" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="Localities" full hint="Comma separated, e.g. Thane (W), Majiwada, Kolshet"><input value={edit.localities} onChange={(e) => setEdit({ ...edit, localities: e.target.value })} /></Field>
            <Field label="Fee per visit (Rs.)"><input type="number" value={edit.fee_per_visit} onChange={(e) => setEdit({ ...edit, fee_per_visit: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </Panel>
  );
}

// ---- 7. banks and branches ---------------------------------------------------------------------------
function BranchesSection() {
  const { can } = useAuth();
  const meta = useMeta();
  const qc = useQueryClient();
  const toast = useToast();
  const onErr = useErrorToast();
  type B = { id?: number; address?: string | null; city?: string | null; state_code?: string | null; bank_id: number; code: string; name: string; contact_name: string; contact_role: string; contact_email: string; contact_phone: string; gstin: string; default_payer: string; billing_cycle: string; fee: string };
  const [edit, setEdit] = useState<B | null>(null);
  const save = useMutation({
    mutationFn: (b: B) => api.post('/api/branches', { ...b, fee: b.fee === '' ? null : Number(b.fee), ...Object.fromEntries((['contact_name', 'contact_role', 'contact_email', 'contact_phone', 'gstin'] as const).map((k) => [k, b[k] || null])) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['meta'] }); toast('Branch saved'); setEdit(null); },
    onError: onErr,
  });
  const ro = !can('set');
  const banks = meta.data?.banks ?? [];
  const open = (br?: Branch) => setEdit(br
    ? { id: br.id, address: (br as any).address ?? null, city: br.city ?? null, state_code: (br as any).state_code ?? null, bank_id: br.bank_id, code: br.code, name: br.name, contact_name: br.contact_name ?? '', contact_role: br.contact_role ?? '', contact_email: br.contact_email ?? '', contact_phone: br.contact_phone ?? '', gstin: br.gstin ?? '', default_payer: br.default_payer ?? 'bank', billing_cycle: br.billing_cycle ?? 'case', fee: br.fee != null ? String(br.fee) : '' }
    : { bank_id: banks[0]?.id ?? 0, code: '', name: '', contact_name: '', contact_role: '', contact_email: '', contact_phone: '', gstin: '', default_payer: 'bank', billing_cycle: 'case', fee: '' });
  const setE = (k: keyof B) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => edit && setEdit({ ...edit, [k]: k === 'bank_id' ? Number(e.target.value) : k === 'code' ? e.target.value.toUpperCase() : e.target.value });
  return (
    <Panel title="Banks & branches" right={!ro && <button className="btn sm pri" onClick={() => open()}>+ Add branch</button>} pad={false}>
      <div className="tablewrap">
        <table className="list">
          <thead><tr><th>Bank</th><th>Branch</th><th>Contact</th><th>Billing</th>{!ro && <th />}</tr></thead>
          <tbody>
            {(meta.data?.branches ?? []).map((b) => (
              <tr key={b.id}>
                <td><b>{b.bank_code}</b><div className="sub">{b.bank_name}</div></td>
                <td><span className="mono">{b.code}</span><div className="sub">{b.name}</div></td>
                <td>{b.contact_name || <span className="muted">—</span>}{b.contact_role && <div className="sub">{b.contact_role}</div>}{(b.contact_phone || b.contact_email) && <div className="sub">{[b.contact_phone, b.contact_email].filter(Boolean).join(' · ')}</div>}</td>
                <td className="sub">{b.default_payer === 'borrower' ? 'Borrower pays' : 'Bank pays'} · {b.billing_cycle === 'batch' ? 'monthly batch' : 'per case'}{b.fee != null && <div>Rs. {Number(b.fee).toLocaleString('en-IN')}</div>}</td>
                {!ro && <td><button className="btn sm ghost" onClick={() => open(b)}>Edit</button></td>}
              </tr>
            ))}
            {!meta.data?.branches.length && <tr><td colSpan={5} className="muted">No branches yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit branch' : 'Add branch'}
        actions={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn pri" disabled={!edit?.code || !edit?.name || !edit?.bank_id || save.isPending} onClick={() => edit && save.mutate(edit)}>Save</button></>}>
        {edit && (
          <div className="form" style={{ padding: 0 }}>
            <Field label="Bank"><select value={edit.bank_id} onChange={setE('bank_id')} disabled={!!edit.id}>{banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}</select></Field>
            <Field label="Branch code" hint="Used in report numbers, e.g. HLCTHN"><input className="mono" value={edit.code} onChange={setE('code')} /></Field>
            <Field label="Branch name" full><input value={edit.name} onChange={setE('name')} /></Field>
            <Field label="Contact person"><input value={edit.contact_name} onChange={setE('contact_name')} placeholder="Mr. Joshi" /></Field>
            <Field label="Contact role"><input value={edit.contact_role} onChange={setE('contact_role')} placeholder="Credit officer" /></Field>
            <Field label="Contact phone"><input type="tel" value={edit.contact_phone} onChange={setE('contact_phone')} /></Field>
            <Field label="Contact email"><input type="email" value={edit.contact_email} onChange={setE('contact_email')} /></Field>
            <Field label="Branch GSTIN"><input className="mono" value={edit.gstin} onChange={setE('gstin')} /></Field>
            <Field label="Fee per report (Rs.)"><input type="number" value={edit.fee} onChange={setE('fee')} /></Field>
            <Field label="Who pays"><select value={edit.default_payer} onChange={setE('default_payer')}><option value="bank">Bank</option><option value="borrower">Borrower</option></select></Field>
            <Field label="Billing"><select value={edit.billing_cycle} onChange={setE('billing_cycle')}><option value="case">Per case</option><option value="batch">Monthly batch</option></select></Field>
          </div>
        )}
      </Modal>
    </Panel>
  );
}

// ---- 8. users and permissions ------------------------------------------------------------------------
interface UserRow { id: number; name: string; email: string; role: Role; status: 'active' | 'disabled'; perms: string[]; totp_enabled: number | boolean; last_login_at: string | null }

function UsersSection() {
  const { can, user: me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const onErr = useErrorToast();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<{ permissions: Record<string, string>; users: UserRow[] }>('/api/users') });
  const [add, setAdd] = useState<{ name: string; email: string; role: Role; password: string } | null>(null);
  const perm = useMutation({
    mutationFn: ({ id, p, on }: { id: number; p: string; on: boolean }) => api.put(`/api/users/${id}/permissions/${p}`, { on }),
    onSuccess: (d) => { qc.setQueryData(['users'], d); toast('Permission updated'); },
    onError: onErr,
  });
  const status = useMutation({
    mutationFn: ({ id, s }: { id: number; s: 'active' | 'disabled' }) => api.put(`/api/users/${id}/status`, { status: s }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast('User updated'); },
    onError: onErr,
  });
  const create = useMutation({
    mutationFn: () => api.post('/api/users', add),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast('User added. Share the password with them; they set up two-factor sign-in on first login.'); setAdd(null); },
    onError: onErr,
  });
  if (!users.data) return <Loading />;
  const ro = !can('set');
  const permKeys = Object.keys(users.data.permissions ?? PERMISSIONS) as Permission[];
  return (
    <Panel title="Users & permissions" right={!ro && <button className="btn sm pri" onClick={() => setAdd({ name: '', email: '', role: 'coordinator', password: '' })}>+ Add user</button>} pad={false}>
      <div className="tablewrap">
        <table className="list">
          <thead>
            <tr><th>User</th><th>Role</th>{permKeys.map((p) => <th key={p} className="text-center" style={{ whiteSpace: 'normal', minWidth: 70 }}>{users.data.permissions[p] ?? p}</th>)}<th>Status</th></tr>
          </thead>
          <tbody>
            {users.data.users.map((u) => (
              <tr key={u.id} style={u.status === 'disabled' ? { opacity: 0.55 } : undefined}>
                <td><b className="font-semibold">{u.name}</b><div className="sub">{u.email}</div><div className="sub">{u.totp_enabled ? '2FA on' : '2FA not set up'}{u.last_login_at ? ` · last in ${ago(u.last_login_at)}` : ''}</div></td>
                <td>{ROLE_LABEL[u.role] ?? u.role}</td>
                {permKeys.map((p) => {
                  const allowed = canHoldPermission(u.role, p);
                  return (
                    <td key={p} className="text-center">
                      <input type="checkbox" className="h-4 w-4" aria-label={`${u.name}: ${users.data.permissions[p]}`} checked={u.perms.includes(p)}
                        disabled={ro || !allowed || perm.isPending || u.status === 'disabled'} title={!allowed ? 'Only a registered valuer can sign' : undefined}
                        onChange={(e) => perm.mutate({ id: u.id, p, on: e.target.checked })} />
                    </td>
                  );
                })}
                <td>
                  {u.id === me?.id ? <span className="sub">You</span> : ro ? <span className="sub">{u.status}</span> : (
                    <button className="btn sm ghost" disabled={status.isPending} onClick={() => status.mutate({ id: u.id, s: u.status === 'active' ? 'disabled' : 'active' })}>{u.status === 'active' ? 'Disable' : 'Enable'}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="sub mx-4 my-3">Signing is limited to users with the Valuer role. Admins manage settings and master data but never sign.</p>
      <Modal open={!!add} onClose={() => setAdd(null)} title="Add user"
        actions={<><button className="btn" onClick={() => setAdd(null)}>Cancel</button><button className="btn pri" disabled={!add?.name || !add?.email || (add?.password.length ?? 0) < 10 || create.isPending} onClick={() => create.mutate()}>Add user</button></>}>
        {add && (
          <div className="form" style={{ padding: 0 }}>
            <Field label="Name"><input value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} autoFocus /></Field>
            <Field label="Role"><select value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value as Role })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field>
            <Field label="Email" full><input type="email" value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} autoComplete="off" /></Field>
            <Field label="Temporary password" full hint="At least 10 characters"><input type="text" value={add.password} onChange={(e) => setAdd({ ...add, password: e.target.value })} autoComplete="new-password" /></Field>
            <div className="full sub">Default permissions follow the role; adjust them in the table afterwards.</div>
          </div>
        )}
      </Modal>
    </Panel>
  );
}

// ---- 9. retention and privacy ----------------------------------------------------------------------
function PrivacySection() {
  const { can } = useAuth();
  const firm = useFirm();
  const save = useFirmSave();
  const qc = useQueryClient();
  const toast = useToast();
  const onErr = useErrorToast();
  const [q, setQ] = useState('');
  const [by, setBy] = useState('');
  const [hits, setHits] = useState<{ id: number; case_no: string; borrower_name: string | null; created_at: string; personal_data_removed_at: string | null }[] | null>(null);
  const [confirmDel, setConfirmDel] = useState<{ id: number; case_no: string } | null>(null);
  const reqs = useQuery({ queryKey: ['privacy-requests'], queryFn: () => api.get<{ id: number; created_at: string; summary: string; reason: string | null; action: string }[]>('/api/privacy/requests') });
  const search = useMutation({ mutationFn: () => api.get<NonNullable<typeof hits>>(`/api/privacy/search?q=${encodeURIComponent(q.trim())}`), onSuccess: setHits, onError: onErr });
  const exp = useMutation({
    mutationFn: (id: number) => api.post(`/api/privacy/${id}/export`, { requestedBy: by.trim() }),
    onSuccess: (d: any) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }));
      a.download = `personal-data_${d.case?.case_no ?? 'case'}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('Copy of personal data downloaded');
      qc.invalidateQueries({ queryKey: ['privacy-requests'] });
    },
    onError: onErr,
  });
  const del = useMutation({
    mutationFn: (id: number) => api.post(`/api/privacy/${id}/delete`, { requestedBy: by.trim() }),
    onSuccess: () => { toast('Personal data removed; property data kept'); setConfirmDel(null); search.mutate(); qc.invalidateQueries({ queryKey: ['privacy-requests'] }); qc.invalidateQueries({ queryKey: ['board'] }); },
    onError: onErr,
  });
  if (!firm.data) return <Loading />;
  const s = firm.data.settings;
  const ro = !can('set');
  return (
    <div className="grid gap-4">
      <Panel title="Data retention">
        {ro && <ReadOnlyNote />}
        <div className="form" style={{ padding: 0 }}>
          <Field label="Keep case files and working papers for" hint="The Model Code of Conduct asks for at least 3 years">
            <select value={s.retention_years} disabled={ro || save.isPending} onChange={(e) => save.mutate({ settings: { retention_years: Number(e.target.value) } })}>
              {[3, 5, 7, 10].map((y) => <option key={y} value={y}>{y} years</option>)}
            </select>
          </Field>
          <Field label="KYC pages (Aadhaar, PAN)" hint="Never placed in reports">
            <select value={s.kyc_policy} disabled={ro || save.isPending} onChange={(e) => save.mutate({ settings: { kyc_policy: e.target.value } })}>
              <option value="never">Never stored</option><option value="delete_30">Delete 30 days after dispatch</option><option value="delete_90">Delete 90 days after dispatch</option>
            </select>
          </Field>
          <div className="field full">
            <label className="flex items-center gap-2" style={{ color: 'var(--ink)' }}><input type="checkbox" checked={!!firm.data.firm.shared_pool_consent} disabled /> Contribute to the shared comparables database</label>
            <div className="hint">Property and rate data only; names and loan details are stripped. Off until the shared database launches.</div>
          </div>
        </div>
      </Panel>

      <Panel title="Borrower data request">
        <p className="sub mb-3 mt-0">When a borrower asks for a copy of their data or for it to be deleted (DPDP Act), find their cases here. Deleting removes names, contacts and KYC; property and rate data are kept.</p>
        <form className="btns mb-3" onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 3) search.mutate(); }}>
          <input className="inp" style={{ maxWidth: 280 }} placeholder="Borrower name (3+ letters)" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn" disabled={q.trim().length < 3 || search.isPending}>Search</button>
        </form>
        {hits && (
          <div className="grid gap-3">
            <Field label="Request made by" hint="Name of the person asking, recorded in the audit trail"><input className="inp" style={{ maxWidth: 280 }} value={by} onChange={(e) => setBy(e.target.value)} placeholder="e.g. Rohan Patil (by email)" /></Field>
            <div className="tablewrap">
              <table className="list">
                <thead><tr><th>Case</th><th>Borrower</th><th>Created</th><th /></tr></thead>
                <tbody>
                  {hits.map((h) => (
                    <tr key={h.id}>
                      <td className="mono">{h.case_no}</td>
                      <td>{h.personal_data_removed_at ? <span className="muted">(personal data removed)</span> : h.borrower_name}</td>
                      <td className="sub">{fmtDate(h.created_at)}</td>
                      <td>
                        {!h.personal_data_removed_at && (
                          <div className="btns">
                            {can('exp') && <button className="btn sm" disabled={by.trim().length < 2 || exp.isPending} onClick={() => exp.mutate(h.id)}>Export their data</button>}
                            {can('set') && <button className="btn sm danger" disabled={by.trim().length < 2} onClick={() => setConfirmDel(h)}>Delete personal data</button>}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!hits.length && <tr><td colSpan={4} className="muted">No cases with that borrower name.</td></tr>}
                </tbody>
              </table>
            </div>
            {by.trim().length < 2 && !!hits.length && <div className="sub">Enter who made the request to enable the actions.</div>}
          </div>
        )}
      </Panel>

      <Panel title="Requests" pad={false}>
        <div className="tablewrap">
          <table className="list">
            <thead><tr><th>Date</th><th>Person</th><th>Request</th><th>Status</th></tr></thead>
            <tbody>
              {(reqs.data ?? []).map((r) => (
                <tr key={r.id}>
                  <td className="sub whitespace-nowrap">{fmtDate(r.created_at, true)}</td>
                  <td>{r.reason?.replace(/^Borrower data request:\s*/, '') ?? '—'}</td>
                  <td>{r.action === 'privacy.delete' ? 'Delete personal data' : 'Copy of personal data'}<div className="sub">{r.summary}</div></td>
                  <td>{r.action === 'privacy.delete' ? <span className="sev ok">Done · property data kept</span> : <span className="sev ok">Sent</span>}</td>
                </tr>
              ))}
              {!reqs.data?.length && <tr><td colSpan={4} className="muted">No requests yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>

      <Modal open={!!confirmDel} onClose={() => setConfirmDel(null)} title={`Delete personal data · ${confirmDel?.case_no ?? ''}`}
        actions={<><button className="btn" onClick={() => setConfirmDel(null)}>Cancel</button><button className="btn pri" style={{ background: 'var(--crit)', borderColor: 'var(--crit)' }} disabled={del.isPending} onClick={() => confirmDel && del.mutate(confirmDel.id)}>Yes, remove</button></>}>
        <p className="m-0">Remove names, contacts and KYC; keep property and rate data? This cannot be undone. Requested by <b>{by}</b>.</p>
      </Modal>
    </div>
  );
}

// ---- 10. features ------------------------------------------------------------------------------------
const FLAGS: Record<string, { label: string; note: string }> = {
  ai_photo_captions: { label: 'AI photo captions', note: 'Suggest a caption for each site photo from what it shows.' },
  billing: { label: 'Billing & payouts', note: 'GST invoices, payments and engineer payouts (next milestone).' },
  quick_estimate: { label: 'Quick Estimate', note: 'Estimate from an Index II before a full case (next milestone).' },
  shared_pool: { label: 'Shared anonymised comparables', note: 'Property and rate data only (next milestone).' },
};
function FeaturesSection() {
  const { can } = useAuth();
  const meta = useMeta();
  const qc = useQueryClient();
  const toast = useToast();
  const onErr = useErrorToast();
  const set = useMutation({
    mutationFn: ({ flag, enabled }: { flag: string; enabled: boolean }) => api.put<Record<string, boolean>>(`/api/firm/flags/${flag}`, { enabled }),
    onSuccess: (flags) => { qc.setQueryData(['meta'], (m: Meta | undefined) => (m ? { ...m, flags } : m)); toast('Feature updated'); },
    onError: onErr,
  });
  const flags = meta.data?.flags ?? {};
  return (
    <Panel title="Features" pad={false}>
      {Object.entries(flags).map(([k, on]) => (
        <label key={k} className="flex cursor-pointer items-start gap-3 border-b border-line px-4 py-3 last:border-b-0">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={on} disabled={!can('set') || set.isPending} onChange={(e) => set.mutate({ flag: k, enabled: e.target.checked })} />
          <span><b>{FLAGS[k]?.label ?? k}</b><span className="sub block">{FLAGS[k]?.note}</span></span>
        </label>
      ))}
    </Panel>
  );
}

// ---- page ------------------------------------------------------------------------------------------
const SECTIONS: { path: string; label: string; el: ReactNode }[] = [
  { path: 'firm', label: 'Firm & valuer', el: <FirmSection /> },
  { path: 'branding', label: 'Letterhead & seal', el: <BrandingSection /> },
  { path: 'numbers', label: 'Case & report numbers', el: <NumbersSection /> },
  { path: 'rules', label: 'Valuation rules', el: <RulesSection /> },
  { path: 'layout', label: 'Report layout', el: <LayoutSection /> },
  { path: 'engineers', label: 'Field engineers', el: <EngineersSection /> },
  { path: 'banks', label: 'Banks & branches', el: <BranchesSection /> },
  { path: 'users', label: 'Users & permissions', el: <UsersSection /> },
  { path: 'privacy', label: 'Retention & privacy', el: <PrivacySection /> },
  { path: 'features', label: 'Features', el: <FeaturesSection /> },
];

export default function Settings() {
  const { user } = useAuth();
  const tabs = useMemo(() => SECTIONS, []);
  return (
    <>
      <PageHead eyebrow={user?.firm_name} title="Firm settings" />
      <nav className="tabs" aria-label="Settings sections">
        {tabs.map((s) => <NavLink key={s.path} to={`/settings/${s.path}`} className={({ isActive }) => (isActive ? 'on' : '')}>{s.label}</NavLink>)}
      </nav>
      <Routes>
        <Route index element={<Navigate to="firm" replace />} />
        {tabs.map((s) => <Route key={s.path} path={s.path} element={s.el} />)}
        <Route path="*" element={<Navigate to="/settings/firm" replace />} />
      </Routes>
    </>
  );
}
