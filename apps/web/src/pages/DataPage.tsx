// Data import & export: CSV imports with a preview (ready reckoner, branches, engineers, comparables,
// past reports), report register and case list exports.
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Loading, PageHead, Panel, fmtDate, useErrorToast, useToast } from '@/components/ui';

const RR_COLS = ['year_label', 'state_code', 'district', 'taluka', 'village', 'village_alt', 'zone', 'category', 'rate_per_sqm'];

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (head: string[], rows: unknown[][]) => [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
function download(name: string, text: string) {
  const a = document.createElement('a');
  // BOM so Excel opens UTF-8 (Marathi village names) correctly
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const fyNow = () => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${String(y % 100).padStart(2, '0')}-${String((y + 1) % 100).padStart(2, '0')}`; };

interface RrRow { id?: number; firm_id?: number | null; year_label: string; state_code: string; district: string; taluka: string | null; village: string; village_alt: string | null; zone: string | null; category: string; rate_per_sqm: number; source?: string }
interface Preview { ok: boolean; errors: string[]; rows: RrRow[]; count: number }

function ReadyReckoner() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const onErr = useErrorToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [showAll, setShowAll] = useState(false);
  const rows = useQuery({ queryKey: ['rr'], queryFn: () => api.get<RrRow[]>('/api/ready-reckoner') });

  const check = useMutation({
    mutationFn: (f: File) => api.upload<Preview>('/api/ready-reckoner/import', [f], { preview: 'true' }),
    onSuccess: setPreview,
    onError: (e) => { setFile(null); onErr(e); },
  });
  const commit = useMutation({
    mutationFn: () => api.upload<Preview>('/api/ready-reckoner/import', [file!], { preview: 'false' }),
    onSuccess: (r) => { toast(`${r.count} rows imported`); setFile(null); setPreview(null); qc.invalidateQueries({ queryKey: ['rr'] }); },
    onError: onErr,
  });

  const template = () => {
    const ex = (rows.data ?? []).slice(0, 2).map((r) => RR_COLS.map((c) => (r as any)[c]));
    download('ready_reckoner_template.csv', toCsv(RR_COLS, ex.length ? ex : [['2025-26', '27', 'Thane', 'Thane', 'Majiwade', 'Majiwada', '6/28', 'residential', '124400']]));
  };
  const exportRows = () => download(`ready_reckoner_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(RR_COLS, (rows.data ?? []).map((r) => RR_COLS.map((c) => (r as any)[c]))));

  const list = rows.data ?? [];
  const shown = showAll ? list : list.slice(0, 10);

  return (
    <Panel
      title={<div><h3 className="text-[14px] font-semibold">Ready reckoner rates <span className="tag ml-1">Master</span></h3><div className="sub">{list.length} rows{list.length >= 500 ? '+' : ''} · {RR_COLS.length} columns · used for guideline value</div></div>}
      right={<div className="btns">
        <button className="btn sm" onClick={template}>Template</button>
        <button className="btn sm" onClick={exportRows} disabled={!list.length}>Export</button>
        {can('set') && <button className="btn sm pri" onClick={() => input.current?.click()} disabled={check.isPending || commit.isPending}>Import CSV</button>}
      </div>}
    >
      <input ref={input} type="file" hidden accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { setFile(f); setPreview(null); check.mutate(f); } }} />
      <div className="sub mb-3">Columns: <span className="mono">{RR_COLS.join(', ')}</span>. Rate is per sq.m. as published; year like 2025-26. Replace the examples in the template with your data, save as CSV, then Import.</div>
      {check.isPending && <Loading what={`Reading ${file?.name ?? 'file'}`} />}
      {preview && file && (
        <div className="panel mb-3 grid gap-3 p-3" style={{ borderLeft: `4px solid var(--${preview.ok ? 'ok' : 'crit'})` }}>
          {preview.ok ? <b>{preview.count} rows read from {file.name} · check the preview, then import</b> : <b className="text-crit">{file.name} has problems. Fix them and choose the file again.</b>}
          {!!preview.errors.length && <ul className="m-0 pl-5 text-[13px] text-crit">{preview.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
          {preview.ok && (
            <div className="tablewrap">
              <table className="list">
                <thead><tr>{['Year', 'District', 'Taluka', 'Village', 'Zone', 'Category', 'Rate / sq.m.'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>{preview.rows.slice(0, 5).map((r, i) => <tr key={i}><td>{r.year_label}</td><td>{r.district}</td><td>{r.taluka}</td><td>{r.village}{r.village_alt && <div className="sub">{r.village_alt}</div>}</td><td>{r.zone}</td><td>{r.category}</td><td className="n mono">{r.rate_per_sqm.toLocaleString('en-IN')}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          <div className="btns">
            {preview.ok && <button className="btn pri" disabled={commit.isPending} onClick={() => commit.mutate()}>{commit.isPending ? 'Importing…' : `Import ${preview.count} rows`}</button>}
            <button className="btn" onClick={() => { setPreview(null); setFile(null); }}>Cancel</button>
          </div>
        </div>
      )}
      {rows.isLoading ? <Loading /> : (
        <div className="tablewrap">
          <table className="list">
            <thead><tr><th>Year</th><th>District / taluka</th><th>Village</th><th>Zone</th><th>Category</th><th className="n">Rate / sq.m.</th><th>Source</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}><td>{r.year_label}</td><td>{r.district}{r.taluka && <div className="sub">{r.taluka}</div>}</td><td>{r.village}{r.village_alt && <div className="sub">{r.village_alt}</div>}</td><td>{r.zone}</td><td>{r.category}</td><td className="n mono">{Number(r.rate_per_sqm).toLocaleString('en-IN')}</td><td className="sub">{r.firm_id ? 'Your import' : 'Platform'}{r.source && <div>{r.source}</div>}</td></tr>
              ))}
              {!list.length && <tr><td colSpan={7} className="muted">No rates yet. Import the official ready reckoner CSV.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {list.length > 10 && <button className="linkbtn mt-2" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show all ${list.length} rows`}</button>}
    </Panel>
  );
}

function Register() {
  const { can } = useAuth();
  const onErr = useErrorToast();
  const [fy, setFy] = useState(fyNow());
  const reg = useQuery({ queryKey: ['register', fy], queryFn: () => api.get<any[]>(`/api/register?fy=${encodeURIComponent(fy)}`) });
  const head = ['report_no', 'fy', 'serial', 'revision', 'case_id', 'bank', 'branch', 'fmv', 'signed_at', 'signed_by', 'superseded_at'];
  const exportCsv = () => {
    try {
      download(`report_register_${fy}.csv`, toCsv(head, (reg.data ?? []).map((r) => [r.report_no, r.fy, r.seq, r.rev, r.case_no, r.bank_code, r.branch_code, r.fmv, r.signed_at && new Date(r.signed_at).toISOString(), r.signed_by, r.superseded_at && new Date(r.superseded_at).toISOString()])));
    } catch (e) { onErr(e); }
  };
  const fys = Array.from({ length: 4 }, (_, i) => { const [a] = fyNow().split('-').map(Number); const y = a - i; return `${String(y).padStart(2, '0')}-${String((y + 1) % 100).padStart(2, '0')}`; });
  return (
    <Panel
      title={<div><h3 className="text-[14px] font-semibold">Report register <span className="tag ml-1">Export only</span></h3><div className="sub">{reg.data?.length ?? 0} reports signed in FY {fy}</div></div>}
      right={<div className="btns">
        <select className="inp" style={{ width: 'auto', padding: '4px 8px' }} value={fy} onChange={(e) => setFy(e.target.value)} aria-label="Financial year">{fys.map((x) => <option key={x}>{x}</option>)}</select>
        {can('exp') && <button className="btn sm" disabled={!reg.data?.length} onClick={exportCsv}>Export CSV</button>}
      </div>}
    >
      {reg.isLoading ? <Loading /> : (
        <div className="tablewrap">
          <table className="list">
            <thead><tr><th>Report no.</th><th>Case ID</th><th>Bank · branch</th><th className="n">FMV</th><th>Signed</th></tr></thead>
            <tbody>
              {(reg.data ?? []).slice(0, 20).map((r) => (
                <tr key={r.id} style={r.superseded_at ? { opacity: 0.6 } : undefined}>
                  <td className="mono">{r.report_no}{r.superseded_at && <div className="sub">superseded</div>}</td>
                  <td className="mono">{r.case_no}</td><td>{r.bank_code} · {r.branch_code}</td>
                  <td className="n mono">{r.fmv ? Number(r.fmv).toLocaleString('en-IN') : '—'}</td>
                  <td className="sub">{fmtDate(r.signed_at)}{r.signed_by && <div>{r.signed_by}</div>}</td>
                </tr>
              ))}
              {!reg.data?.length && <tr><td colSpan={5} className="muted">No reports signed in this financial year yet. Report numbers are issued only at sign-off.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function CasesExport() {
  const { can } = useAuth();
  const onErr = useErrorToast();
  const run = async () => {
    try {
      const b = await api.get<{ rows: any[] }>('/api/assignments');
      download(`cases_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(['case_id', 'borrower', 'property', 'bank', 'branch', 'stage', 'documents', 'engineer', 'report_no', 'updated_at'],
        b.rows.map((r) => [r.case_no, r.borrower_name, r.property, r.bank_code, r.branch_name, r.stage_label, `${r.docs_got}/${r.docs_total}`, r.engineer_name, r.report_no, r.updated_at])));
    } catch (e) { onErr(e); }
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
      <div><b>Cases (current)</b> <span className="tag ml-1">Export only</span><div className="sub">case_id, borrower, property, bank, branch, stage, documents</div></div>
      {can('exp') ? <button className="btn sm" onClick={run}>Export CSV</button> : <span className="sub">Needs “Export data”</span>}
    </div>
  );
}

interface ImportDef { label: string; columns: string[]; example: string[] }
interface ImportResult { ok: boolean; errors: string[]; errorCount: number; rows: Record<string, unknown>[]; count: number; added?: number; updated?: number }
const IMPORT_NOTES: Record<string, { tag: string; note: string }> = {
  branches: { tag: 'Master', note: 'Matched on bank and branch code: existing branches are updated. Payer is bank or borrower; billing is case or batch.' },
  engineers: { tag: 'Master', note: 'Matched on name: existing engineers are updated.' },
  comparables: { tag: 'Historical', note: 'Fills the comparables database for market evidence. Carpet area is converted to built-up with the firm loading. The same document no. again replaces the earlier row.' },
  past_reports: { tag: 'Historical', note: 'Past reports become comparables (own reports) so evidence finds them. Names and loan details are not needed.' },
};

function ImportPanel({ kind, def }: { kind: string; def: ImportDef }) {
  const { can } = useAuth();
  const toast = useToast();
  const onErr = useErrorToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<ImportResult | null>(null);
  const check = useMutation({ mutationFn: (f: File) => api.upload<ImportResult>(`/api/import/${kind}`, [f], { preview: 'true' }), onSuccess: setRes, onError: (e) => { setFile(null); onErr(e); } });
  const commit = useMutation({
    mutationFn: () => api.upload<ImportResult>(`/api/import/${kind}`, [file!], { preview: 'false' }),
    onSuccess: (r) => { toast(`${r.count} rows imported (${r.added ?? 0} added, ${r.updated ?? 0} updated)`); setFile(null); setRes(null); },
    onError: onErr,
  });
  const exportRows = async () => {
    try { const r = await api.get<{ columns: string[]; rows: string[][] }>(`/api/import/${kind}/rows`); download(`${kind}_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(r.columns, r.rows)); } catch (e) { onErr(e); }
  };
  const n = IMPORT_NOTES[kind];
  return (
    <div className="border-b border-line px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0"><b>{def.label}</b> <span className="tag ml-1">{n?.tag}</span><div className="sub mono break-words">{def.columns.join(', ')}</div></div>
        <div className="btns">
          <button className="btn sm" onClick={() => download(`${kind}_template.csv`, toCsv(def.columns, [def.example]))}>Template</button>
          {can('exp') && <button className="btn sm" onClick={exportRows}>Export</button>}
          {can('set') && <button className="btn sm pri" disabled={check.isPending || commit.isPending} onClick={() => input.current?.click()}>Import CSV</button>}
        </div>
      </div>
      {n && <div className="sub mt-1">{n.note}</div>}
      <input ref={input} type="file" hidden accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { setFile(f); setRes(null); check.mutate(f); } }} />
      {check.isPending && <Loading what={`Reading ${file?.name ?? 'file'}`} />}
      {res && file && (
        <div className="panel mt-3 grid gap-3 p-3" style={{ borderLeft: `4px solid var(--${res.ok ? 'ok' : 'crit'})` }}>
          {res.ok ? <b>{res.count} rows read from {file.name} · check the preview, then import</b> : <b className="text-crit">{file.name}: {res.errorCount} problem(s). Fix them and choose the file again.</b>}
          {!!res.errors.length && <ul className="m-0 pl-5 text-[13px] text-crit">{res.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
          {res.ok && !!res.rows.length && (
            <div className="tablewrap">
              <table className="list">
                <thead><tr>{Object.keys(res.rows[0]).filter((k) => !['firm_id', 'created_by', 'scope'].includes(k)).slice(0, 8).map((h) => <th key={h}>{h.replace(/_/g, ' ')}</th>)}</tr></thead>
                <tbody>{res.rows.slice(0, 5).map((r, i) => <tr key={i}>{Object.entries(r).filter(([k]) => !['firm_id', 'created_by', 'scope'].includes(k)).slice(0, 8).map(([k, v]) => <td key={k}>{v instanceof Object ? String(v).slice(0, 10) : String(v ?? '')}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
          <div className="btns">
            {res.ok && <button className="btn pri" disabled={commit.isPending} onClick={() => commit.mutate()}>{commit.isPending ? 'Importing…' : `Import ${res.count} rows`}</button>}
            <button className="btn" onClick={() => { setRes(null); setFile(null); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Imports() {
  const q = useQuery({ queryKey: ['imports'], queryFn: () => api.get<Record<string, ImportDef>>('/api/import') });
  return (
    <section className="panel">
      <CasesExport />
      {q.isLoading ? <Loading /> : Object.entries(q.data ?? {}).map(([k, d]) => <ImportPanel key={k} kind={k} def={d} />)}
    </section>
  );
}

export default function DataPage() {
  return (
    <>
      <PageHead eyebrow="Data" title="Data import & export" />
      <p className="muted -mt-3 mb-4">CSV files open in Excel. Use the template, fill it, import it.</p>
      <div className="grid gap-4">
        <ReadyReckoner />
        <Register />
        <Imports />
        <p className="sub">Importing past reports and transactions fills the firm's comparables database, so market evidence finds data from day one. Names and loan details are not needed in these files. Banks, branches and engineers can also be added one by one in Firm settings.</p>
      </div>
    </>
  );
}
