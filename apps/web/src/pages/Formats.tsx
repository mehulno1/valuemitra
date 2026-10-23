// Bank formats: the template engine. List formats and their versions, upload a bank's Word template,
// confirm how each label maps to a master field, preview against a real case, and publish.
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { PROPERTY_TYPES } from '@vm/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Conf, Empty, Field, Loading, Modal, PageHead, Panel, fmtDate, useErrorToast, useToast } from '@/components/ui';
import FormatReview, { type AiInfo, type ReviewMapping } from './FormatReview';

interface Version { id: number; version: number; status: 'draft' | 'published' | 'retired'; effective_from: string | null; published_at: string | null; created_at?: string; slots: number; mapped: number; ignored: number; confirmed?: number; change_note: string | null; ai_status?: string }
interface Tpl { id: number; code: string; name: string; bank_code: string | null; bank_name: string | null; property_types: string[]; branch_scope: string[]; firm_id: number | null; status?: string; versions: Version[] }
type Mapping = ReviewMapping;
interface VersionDetail { id: number; version: number; status: string; name: string; bank_code: string | null; bank_name?: string | null; template_id: number; effective_from: string | null; change_note: string | null; property_types: string[]; mappings: Mapping[]; ai_status: string; ai_error: string | null; ai: AiInfo | null }
interface DictField { code: string; label: string; group: string; type: string; status: string; sources?: string[] }

const ptLabel = (k: string) => PROPERTY_TYPES.find((p) => p.key === k)?.label ?? k;
const today = () => new Date().toISOString().slice(0, 10);
const METHOD: Record<string, string> = { placeholder: 'placeholder', history: 'learned', alias: 'alias', label: 'label', fuzzy: 'similar words', manual: 'you chose', new_field: 'new field', ai: 'AI' };

// ---------------------------------------------------------------------------------------------------
function UploadForm({ revise, onDone, onCancel }: { revise?: Tpl | null; onDone: (r: { versionId: number; found: number; matched: number; ai?: boolean }) => void; onCancel?: () => void }) {
  const onErr = useErrorToast();
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api.get<{ banks: { id: number; code: string; name: string }[]; branches: { bank_code: string; code: string; name: string }[] }>('/api/meta') });
  const [bankCode, setBankCode] = useState(revise?.bank_code ?? '');
  const [name, setName] = useState(revise?.name ?? '');
  const [types, setTypes] = useState<string[]>(revise?.property_types ?? ['flat']);
  const [scopeAll, setScopeAll] = useState(!revise || revise.branch_scope.includes('*'));
  const [scope, setScope] = useState<string[]>(revise && !revise.branch_scope.includes('*') ? revise.branch_scope : []);
  const [eff, setEff] = useState(today());
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const branches = (meta.data?.branches ?? []).filter((b) => b.bank_code === bankCode);

  const up = useMutation({
    mutationFn: () => api.upload<{ templateId: number; versionId: number; version: number; found: number; matched: number; ai?: boolean }>('/api/templates/upload', [file!], {
      ...(revise ? { templateId: String(revise.id) } : { bankCode, name, propertyTypes: types.join(','), branchScope: scopeAll ? '*' : scope.join(',') }),
      effectiveFrom: eff, note,
    }),
    onSuccess: onDone,
    onError: onErr,
  });
  const ok = file && (revise || (bankCode && types.length && (scopeAll || scope.length)));

  return (
    <div className="form" style={{ padding: 0 }}>
      {!revise ? (
        <>
          <Field label="Bank">
            <select value={bankCode} onChange={(e) => { setBankCode(e.target.value); setScope([]); }}>
              <option value="">Choose bank</option>
              {meta.data?.banks.map((b) => <option key={b.id} value={b.code}>{b.code} · {b.name}</option>)}
            </select>
          </Field>
          <Field label="Format name" hint="As the bank calls it, e.g. Flat valuation format"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Taken from the file name if blank" /></Field>
          <Field label="Property types" full>
            <div className="btns">
              {PROPERTY_TYPES.map((p) => (
                <label key={p.key} className="flex items-center gap-1.5 text-[13.5px]">
                  <input type="checkbox" checked={types.includes(p.key)} onChange={(e) => setTypes(e.target.checked ? [...types, p.key] : types.filter((t) => t !== p.key))} /> {p.label}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Branches" full hint="Use a branch-specific format only when a branch insists on its own layout.">
            <div className="grid gap-1.5">
              <label className="flex items-center gap-1.5 text-[13.5px]"><input type="checkbox" checked={scopeAll} onChange={(e) => setScopeAll(e.target.checked)} /> All branches of this bank</label>
              {!scopeAll && (
                <div className="btns">
                  {!branches.length && <span className="sub">Choose a bank with branches.</span>}
                  {branches.map((b) => (
                    <label key={b.code} className="flex items-center gap-1.5 text-[13.5px]"><input type="checkbox" checked={scope.includes(b.code)} onChange={(e) => setScope(e.target.checked ? [...scope, b.code] : scope.filter((s) => s !== b.code))} /> {b.code} · {b.name}</label>
                  ))}
                </div>
              )}
            </div>
          </Field>
        </>
      ) : (
        <div className="full sub">New version of <b className="text-ink">{revise.bank_code} · {revise.name}</b>. Mappings confirmed in the current version are carried over by label.{revise.firm_id === null && ' This is a platform format: your firm gets its own copy; other firms are not affected.'}</div>
      )}
      <Field label="Effective from" hint="New cases created on or after this date use the new version"><input type="date" value={eff} onChange={(e) => setEff(e.target.value)} /></Field>
      <Field label="Change note"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={revise ? 'What did the bank change?' : 'Optional'} /></Field>
      <div className="full">
        <div className="drop">
          {file ? <div><b>{file.name}</b> <span className="sub">· {(file.size / 1024).toFixed(0)} KB</span></div> : <div className="muted">The bank's Word file (.docx): a blank template, or a past report in this format from your firm or another valuer (with consent). A past report also teaches the wording; its case details and the earlier valuer's name, registration and firm are cleared. Old .doc files: save as .docx first.</div>}
          <div className="btns mt-3 justify-center">
            <button type="button" className="btn" onClick={() => input.current?.click()}>{file ? 'Choose another file' : 'Upload Word template'}</button>
          </div>
          <input ref={input} type="file" hidden accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
        </div>
      </div>
      <div className="full btns">
        <button className="btn pri" disabled={!ok || up.isPending} onClick={() => up.mutate()}>{up.isPending ? 'Uploading…' : 'Read the format'}</button>
        {onCancel && <button className="btn" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------
function StatusCell({ t }: { t: Tpl }) {
  const pub = t.versions.find((v) => v.status === 'published');
  const draft = t.versions.find((v) => v.status === 'draft');
  return (
    <div className="grid gap-1">
      {pub ? <span><span className="sev ok">Active</span> <span className="sub">v{pub.version}{pub.effective_from && ` · from ${fmtDate(pub.effective_from)}`}</span></span> : !draft && <span className="sev info">Not published</span>}
      {draft && <Link to={`/formats/v/${draft.id}`} onClick={(e) => e.stopPropagation()}><span className="sev warn">{draft.ai_status === 'reading' ? 'Draft · AI reading' : `Draft ${draft.slots ? Math.round(((draft.confirmed ?? draft.mapped + draft.ignored) / draft.slots) * 100) : 0}% reviewed`}</span> <span className="sub">v{draft.version}</span></Link>}
    </div>
  );
}

function FormatList() {
  const { can } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const list = useQuery({ queryKey: ['templates'], queryFn: () => api.get<Tpl[]>('/api/templates') });
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [revise, setRevise] = useState<Tpl | null>(null);
  const qc = useQueryClient();
  const done = (r: { versionId: number; found: number; matched: number; ai?: boolean }) => {
    qc.invalidateQueries({ queryKey: ['templates'] });
    toast(r.ai ? 'Uploaded. The AI is reading the format; this takes about 1 to 2 minutes.' : `${r.found} fields found. ${r.matched} matched automatically; ${r.found - r.matched} need you.`);
    nav(`/formats/v/${r.versionId}`);
  };

  return (
    <>
      <PageHead eyebrow="Templates" title="Bank formats" actions={can('config') && !adding && <button className="btn pri" onClick={() => setAdding(true)}>+ Add a bank format</button>} />
      <p className="muted -mt-3 mb-4">Each format maps to the same master data, so a fact is captured once and printed in every bank's layout.{!can('config') && ' Adding or revising a format needs the “Master data & templates” permission (Firm settings → Users).'}</p>

      {adding && (
        <Panel title="Add a bank format" className="mb-4">
          <p className="sub mb-4 mt-0">Upload the bank's Word file. The AI maps each question to a master field by meaning, creates the fields that are missing and clears any earlier case's details; you review the few doubts. The exact layout of the bank's form is kept.</p>
          <UploadForm onDone={done} onCancel={() => setAdding(false)} />
        </Panel>
      )}

      <section className="panel">
        {list.isLoading ? <Loading /> : (
          <div className="tablewrap">
            <table className="list click">
              <thead><tr><th>Bank</th><th>Format</th><th>Property types</th><th>Fields mapped</th><th>Status</th></tr></thead>
              <tbody>
                {(list.data ?? []).map((t) => {
                  const cur = t.versions.find((v) => v.status === 'draft') ?? t.versions.find((v) => v.status === 'published') ?? t.versions[0];
                  return [
                    <tr key={t.id} onClick={() => setOpen(open === t.id ? null : t.id)} aria-expanded={open === t.id}>
                      <td><b>{t.bank_code ?? '—'}</b><div className="sub">{t.bank_name}</div></td>
                      <td>{t.name}<div className="sub">{t.branch_scope.includes('*') ? 'All branches' : t.branch_scope.join(', ')}{t.firm_id === null ? ' · platform format' : ' · your firm'}</div></td>
                      <td>{t.property_types.map(ptLabel).join(', ')}</td>
                      <td className="mono">{cur ? (cur.ai_status === 'reading' ? <span className="sub">AI reading…</span> : `${cur.confirmed ?? cur.mapped + cur.ignored}/${cur.slots}`) : '—'}{cur && !!cur.ignored && <div className="sub">{cur.ignored} fixed text</div>}</td>
                      <td><StatusCell t={t} /></td>
                    </tr>,
                    open === t.id && (
                      <tr key={`${t.id}-h`}><td colSpan={5} style={{ background: 'var(--sunk)', cursor: 'default' }} onClick={(e) => e.stopPropagation()}>
                        <div className="grid gap-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <b>Version history</b>
                            {can('config') && !t.versions.some((v) => v.status === 'draft') && <button className="btn sm" onClick={() => setRevise(t)}>Upload a revised version</button>}
                          </div>
                          <table className="list" style={{ background: 'var(--surface)', borderRadius: 6 }}>
                            <thead><tr><th>Version</th><th>Status</th><th>Effective from</th><th>Mapped</th><th>Note</th><th /></tr></thead>
                            <tbody>
                              {t.versions.map((v) => (
                                <tr key={v.id}>
                                  <td className="mono">v{v.version}</td>
                                  <td><span className={`sev ${v.status === 'published' ? 'ok' : v.status === 'draft' ? 'warn' : 'info'}`}>{v.status === 'published' ? 'Active' : v.status === 'draft' ? 'Draft' : 'Retired'}</span></td>
                                  <td>{fmtDate(v.effective_from) || '—'}{v.published_at && <div className="sub">published {fmtDate(v.published_at)}</div>}</td>
                                  <td className="mono">{v.confirmed ?? v.mapped + v.ignored}/{v.slots}</td>
                                  <td className="sub">{v.change_note}</td>
                                  <td><Link className="btn sm" to={`/formats/v/${v.id}`}>{v.status === 'draft' && can('config') ? 'Map fields' : 'View mapping'}</Link></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div className="sub">Published versions never change. Each case uses the version that was live when it was created, so a revision never alters past reports.</div>
                        </div>
                      </td></tr>
                    ),
                  ];
                })}
                {!list.data?.length && <tr><td colSpan={5} className="muted">No bank formats yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal open={!!revise} onClose={() => setRevise(null)} title="Upload a revised version">
        {revise && <UploadForm revise={revise} onDone={(r) => { setRevise(null); done(r); }} onCancel={() => setRevise(null)} />}
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------
function FieldPicker({ fields, value, suggestions, onPick, disabled }: { fields: DictField[]; value: string | null; suggestions: { code: string; confidence: number }[]; onPick: (code: string) => void; disabled?: boolean }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const byCode = useMemo(() => new Map(fields.map((f) => [f.code, f])), [fields]);
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return fields.filter((f) => f.status !== 'deprecated' && (f.label.toLowerCase().includes(s) || f.code.toLowerCase().includes(s))).slice(0, 12);
  }, [q, fields]);
  const cur = value ? byCode.get(value) : null;
  return (
    <div className="relative grid gap-1.5" style={{ minWidth: 220 }}>
      {cur ? <div><b className="font-semibold">{cur.label}</b> <span className="sub mono">{cur.code}</span></div> : value ? <span className="mono">{value}</span> : <span className="pendv">Choose a field</span>}
      {!disabled && (
        <>
          <input className="inp" style={{ padding: '5px 8px', fontSize: 13 }} placeholder="Search master fields…" value={q} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} />
          {open && hits.length > 0 && (
            <div className="panel absolute left-0 right-0 z-10 max-h-64 overflow-auto shadow-lg" style={{ top: '100%' }}>
              {hits.map((f) => (
                <button key={f.code} type="button" className="block w-full border-0 bg-transparent px-3 py-1.5 text-left hover:bg-sunk" onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(f.code); setQ(''); setOpen(false); }}>
                  {f.label} <span className="sub mono">{f.code}</span>
                </button>
              ))}
            </div>
          )}
          {!!suggestions.length && (
            <div className="flex flex-wrap gap-1">
              {suggestions.filter((s) => s.code !== value).slice(0, 3).map((s) => (
                <button key={s.code} type="button" className="tag" style={{ cursor: 'pointer', border: 0 }} title={s.code} onClick={() => onPick(s.code)}>{byCode.get(s.code)?.label ?? s.code} · {Math.round(s.confidence)}%</button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function NewFieldModal({ open, label, fields, onClose, onSave }: { open: boolean; label: string; fields: DictField[]; onClose: () => void; onSave: (f: { code: string; label: string; group: string; type: string }) => void }) {
  const groups = useMemo(() => [...new Set(fields.map((f) => f.group))].sort(), [fields]);
  const [f, setF] = useState({ code: '', label, group: groups[0] ?? 'PROP', type: 'text' });
  const [lastLabel, setLastLabel] = useState(label);
  if (label !== lastLabel) { setLastLabel(label); setF((x) => ({ ...x, label, code: '' })); }
  const valid = /^[A-Z][A-Z0-9_]*(\.[A-Z0-9_]+)+$/.test(f.code) && f.label.trim();
  const exists = fields.some((x) => x.code === f.code);
  return (
    <Modal open={open} onClose={onClose} title="Add new master field"
      actions={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn pri" disabled={!valid || exists} onClick={() => onSave(f)}>Add field and map</button></>}>
      <p className="sub m-0">Only when the bank asks for something no master field covers. The new field is available to every format, and the bank's label is kept as an alias.</p>
      <div className="form" style={{ padding: 0 }}>
        <Field label="Group"><select value={f.group} onChange={(e) => setF({ ...f, group: e.target.value, code: f.code || `${e.target.value}.` })}>{groups.map((g) => <option key={g}>{g}</option>)}</select></Field>
        <Field label="Field ID" hint={exists ? <span className="text-crit">This ID already exists; map to it instead.</span> : 'GROUP.NAME in capitals, e.g. PROP.BANK_OFFICER'}><input className="mono" value={f.code} placeholder={`${f.group}.NAME`} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/\s+/g, '_') })} /></Field>
        <Field label="Label"><input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
        <Field label="Type"><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{['text', 'longtext', 'number', 'area', 'money', 'date', 'enum', 'boolean'].map((t) => <option key={t}>{t}</option>)}</select></Field>
      </div>
    </Modal>
  );
}

function PreviewBox({ versionId }: { versionId: number }) {
  const onErr = useErrorToast();
  const cases = useQuery({ queryKey: ['board', '', ''], queryFn: () => api.get<{ rows: { id: number; case_no: string; borrower_name: string | null }[] }>('/api/assignments?stage=&q=') });
  const [aid, setAid] = useState<number>(0);
  const [link, setLink] = useState<{ href: string; name: string } | null>(null);
  const run = useMutation({
    mutationFn: async () => {
      const buf = await api.binary(`/api/templates/versions/${versionId}/preview?assignmentId=${aid}`);
      const c = cases.data?.rows.find((r) => r.id === aid);
      if (link) URL.revokeObjectURL(link.href);
      const href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      setLink({ href, name: `Preview v${versionId} ${c?.case_no ?? aid}.docx` });
    },
    onError: onErr,
  });
  const rows = cases.data?.rows ?? [];
  return (
    <div className="grid gap-2">
      <div className="sub">Fill this version with one of your cases to check the layout before publishing.</div>
      <select className="inp" value={aid} onChange={(e) => { setAid(Number(e.target.value)); setLink(null); }}>
        <option value={0}>{rows.length ? 'Choose a case' : 'No cases yet'}</option>
        {rows.map((r) => <option key={r.id} value={r.id}>{r.case_no}{r.borrower_name ? ` · ${r.borrower_name}` : ''}</option>)}
      </select>
      <div className="btns">
        <button className="btn sm" disabled={!aid || run.isPending} onClick={() => run.mutate()}>{run.isPending ? 'Preparing…' : 'Prepare preview'}</button>
        {link && <a className="btn sm pri" href={link.href} download={link.name}>Download .docx</a>}
      </div>
    </div>
  );
}

function MappingScreen() {
  const { id } = useParams();
  const vid = Number(id);
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const onErr = useErrorToast();
  const v = useQuery({ queryKey: ['tplv', vid], queryFn: () => api.get<VersionDetail>(`/api/templates/versions/${vid}`), refetchInterval: (q) => (q.state.data?.ai_status === 'reading' ? 4000 : false) });
  const [advanced, setAdvanced] = useState(false);
  const rerun = useMutation({ mutationFn: () => api.post(`/api/templates/versions/${vid}/ai`), onSuccess: () => qc.invalidateQueries({ queryKey: ['tplv', vid] }), onError: onErr });
  const fields = useQuery({ queryKey: ['fields'], queryFn: () => api.get<DictField[]>('/api/admin/fields'), staleTime: 60_000 });
  const [filter, setFilter] = useState<'need' | 'all'>('need');
  const [q, setQ] = useState('');
  const [eff, setEff] = useState(today());
  const [newFor, setNewFor] = useState<Mapping | null>(null);

  const patch = useMutation({
    mutationFn: ({ mid, body }: { mid: number; body: Record<string, unknown> }) => api.patch<VersionDetail>(`/api/templates/versions/${vid}/mappings/${mid}`, body),
    onSuccess: (d) => { qc.setQueryData(['tplv', vid], d); qc.invalidateQueries({ queryKey: ['templates'] }); },
    onError: onErr,
  });
  const publish = useMutation({
    mutationFn: () => api.post(`/api/templates/versions/${vid}/publish`, { effectiveFrom: eff }),
    onSuccess: () => { toast(`Published. New ${v.data?.bank_code ?? ''} cases from ${fmtDate(eff)} use it automatically.`); qc.invalidateQueries({ queryKey: ['templates'] }); qc.invalidateQueries({ queryKey: ['tplv', vid] }); nav('/formats'); },
    onError: onErr,
  });
  const discard = useMutation({
    mutationFn: () => api.del(`/api/templates/versions/${vid}`),
    onSuccess: () => { toast('Draft discarded'); qc.invalidateQueries({ queryKey: ['templates'] }); nav('/formats'); },
    onError: onErr,
  });

  if (v.isLoading || fields.isLoading) return <Loading />;
  if (v.isError) return <Empty title="Format version not found">{(v.error as Error).message} <Link to="/formats">Back to bank formats</Link></Empty>;
  const d = v.data!;
  const draft = d.status === 'draft';
  const edit = draft && can('config');
  const open = d.mappings.filter((m) => !m.confirmed);
  const s = q.trim().toLowerCase();
  const rows = d.mappings.filter((m) => (filter === 'all' || !m.confirmed) && (!s || m.label.toLowerCase().includes(s) || (m.field_label ?? '').toLowerCase().includes(s) || (m.field_code ?? '').toLowerCase().includes(s)));
  const pct = d.mappings.length ? Math.round(((d.mappings.length - open.length) / d.mappings.length) * 100) : 0;
  const reading = d.ai_status === 'reading';
  const review = !!d.ai && d.ai_status === 'done' && !advanced;
  const picker = (p: { value: string | null; suggestions: { code: string; confidence: number }[]; onPick: (code: string) => void; disabled?: boolean }) => <FieldPicker fields={fields.data ?? []} {...p} />;

  return (
    <>
      <PageHead
        eyebrow={<Link to="/formats" className="text-inherit no-underline">Bank formats</Link>}
        title={<>{d.bank_code} · {d.name} <span className="mono text-[18px] font-medium">v{d.version}</span></>}
        actions={<div className="flex flex-wrap items-center gap-2">
          {d.ai && d.ai_status === 'done' && <button className="btn sm" onClick={() => setAdvanced((x) => !x)}>{advanced ? 'Back to review' : 'Advanced: full mapping table'}</button>}
          <span className={`sev ${draft ? 'warn' : d.status === 'published' ? 'ok' : 'info'}`}>{reading ? 'AI reading' : draft ? `Draft · ${pct}% reviewed` : d.status === 'published' ? 'Active' : 'Retired'}</span>
        </div>}
      />
      {reading && (
        <Panel className="mb-4" title="The AI is reading the format">
          <ol className="m-0 grid gap-1.5 pl-5 text-[13.5px]">
            <li>Opens the Word file and finds the questions, grids and text sections</li>
            <li>Separates the bank's own text from an earlier case's details and the earlier valuer's identity</li>
            <li>Matches each question to a master field by meaning, and proposes the fields that are missing</li>
            <li>Marks what needs you</li>
          </ol>
          <p className="sub mb-0 mt-3"><span className="dots">About 1 to 2 minutes</span>. You can leave this page; the review is here when you come back.</p>
        </Panel>
      )}
      {d.ai_status === 'none' && draft && edit && (
        <Panel className="mb-4" title="Read this format with the AI">
          <p className="sub mt-0">This draft was matched by words only. The AI maps each question by meaning, proposes the fields that are missing and clears an earlier case's details and the earlier valuer's identity. Your choices on this draft are replaced.</p>
          <button className="btn pri" disabled={rerun.isPending} onClick={() => rerun.mutate()}>Read with the AI</button>
        </Panel>
      )}
      {d.ai_status === 'failed' && draft && (
        <Panel className="mb-4" title="The AI could not read this format">
          <p className="sub mt-0">{d.ai_error ?? 'Unknown error'}. The labels below were matched by words instead; you can map them by hand, or try the AI again.</p>
          {edit && <button className="btn" disabled={rerun.isPending} onClick={() => rerun.mutate()}>Read with the AI again</button>}
        </Panel>
      )}
      {review && d.ai && (
        <div className="grid gap-4">
          <FormatReview vid={vid} ai={d.ai} mappings={d.mappings} fields={fields.data ?? []} edit={edit} onChange={(nd) => qc.setQueryData(['tplv', vid], nd)} Picker={picker} />
          <div className="split">
            {can('config') && <Panel title="Preview with a case"><PreviewBox versionId={vid} /></Panel>}
            {draft && (
              <Panel title="Publish">
                <div className="grid gap-3">
                  {open.length ? <div className="sub"><b className="text-warn">{open.length} item(s) not accepted yet.</b></div> : <div className="sub text-ok">Everything accepted. New fields are created and site questions added to the engineer's sheet when you publish.</div>}
                  <Field label="Effective from" hint="New cases created on or after this date use this version"><input type="date" value={eff} onChange={(e) => setEff(e.target.value)} disabled={!edit} /></Field>
                  {edit && (
                    <div className="btns">
                      <button className="btn pri" disabled={!!open.length || publish.isPending} onClick={() => publish.mutate()}>{publish.isPending ? 'Publishing…' : 'Publish format'}</button>
                      <button className="btn danger" disabled={discard.isPending} onClick={() => window.confirm('Discard this draft and its mappings?') && discard.mutate()}>Discard draft</button>
                      <button className="btn ghost" disabled={rerun.isPending} onClick={() => window.confirm('Read the format with the AI again? Your choices on this draft are replaced.') && rerun.mutate()}>Read again</button>
                    </div>
                  )}
                </div>
              </Panel>
            )}
          </div>
        </div>
      )}
      {!review && !reading && <div className="cols">
        <section className="panel min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div className="tabs" style={{ margin: 0, border: 0 }}>
              <button className={filter === 'need' ? 'on' : ''} onClick={() => setFilter('need')}>Needs you {open.length > 0 && <span className="badge">{open.length}</span>}</button>
              <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All {d.mappings.length}</button>
            </div>
            <input className="inp" style={{ maxWidth: 240 }} type="search" placeholder="Filter labels or fields" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="tablewrap">
            <table className="list">
              <thead><tr><th>Label in bank template</th><th>Master field</th><th>Match</th>{edit && <th />}</tr></thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} style={!m.confirmed ? { background: 'var(--warn-soft)' } : undefined}>
                    <td style={{ maxWidth: 320 }}>
                      <b className="font-semibold">{m.label}</b>
                      {m.template && m.template !== `{{${m.field_code}}}` && <div className="sub mono">{m.template}</div>}
                      {m.context && m.context !== m.label && <div className="sub">{m.context}</div>}
                      {m.sample && <div className="snip" style={{ fontSize: 12.5 }}>{m.sample}</div>}
                      {m.kind && m.kind !== 'label' && <span className="tag mt-1 inline-block">{m.kind}</span>}
                    </td>
                    <td>
                      {m.ignored ? <span className="tag">Fixed text</span> : (
                        <FieldPicker fields={fields.data ?? []} value={m.field_code} suggestions={m.suggestions} disabled={!edit || patch.isPending} onPick={(code) => patch.mutate({ mid: m.id, body: { fieldCode: code } })} />
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      {m.confirmed ? <span className="sev ok">Confirmed</span> : m.field_code ? <Conf value={m.confidence} /> : <span className="sev crit">Needs you</span>}
                      {m.method && <div className="sub">{METHOD[m.method] ?? m.method}</div>}
                    </td>
                    {edit && (
                      <td>
                        <div className="grid gap-1 justify-items-start">
                          {!m.confirmed && m.field_code && !m.ignored && <button className="btn sm pri" disabled={patch.isPending} onClick={() => patch.mutate({ mid: m.id, body: { fieldCode: m.field_code } })}>Confirm</button>}
                          {!m.ignored ? <button className="linkbtn" disabled={patch.isPending} onClick={() => patch.mutate({ mid: m.id, body: { ignore: true } })}>Keep as fixed text</button>
                            : <span className="sub">Choose a field to map it</span>}
                          <button className="linkbtn" onClick={() => setNewFor(m)}>Add new master field</button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={4} className="muted">{filter === 'need' ? 'Nothing needs you. Every label is confirmed.' : 'No labels match.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="grid gap-3">
          {draft && (
            <Panel title="Publish">
              <div className="grid gap-3">
                {open.length ? <div className="sub"><b className="text-warn">{open.length} left to map.</b> Confirm each, keep it as fixed text, or add a new master field.</div> : <div className="sub text-ok">All {d.mappings.length} labels confirmed.</div>}
                <Field label="Effective from" hint="New cases created on or after this date use this version"><input type="date" value={eff} onChange={(e) => setEff(e.target.value)} disabled={!edit} /></Field>
                {edit && (
                  <div className="btns">
                    <button className="btn pri" disabled={!!open.length || publish.isPending} onClick={() => publish.mutate()}>{publish.isPending ? 'Publishing…' : 'Publish format'}</button>
                    <button className="btn danger" disabled={discard.isPending} onClick={() => window.confirm('Discard this draft and its mappings?') && discard.mutate()}>Discard draft</button>
                  </div>
                )}
                {!can('config') && <div className="sub">Needs the “Master data & templates” permission to edit.</div>}
              </div>
            </Panel>
          )}
          {can('config') && <Panel title="Preview with a case"><PreviewBox versionId={vid} /></Panel>}
          <Panel title="How versions work">
            <ul className="sub m-0 grid gap-1.5 pl-4">
              <li>A published version never changes. To change a format, upload a revised version; it starts from this mapping.</li>
              <li>Each case keeps the version that was live when it was created, so old reports reprint exactly.</li>
              <li>Publishing with a future date keeps the current version live until then.</li>
              {d.change_note && <li>Note on this version: {d.change_note}</li>}
            </ul>
          </Panel>
        </aside>
      </div>}

      <NewFieldModal
        open={!!newFor}
        label={newFor?.label ?? ''}
        fields={fields.data ?? []}
        onClose={() => setNewFor(null)}
        onSave={(f) => {
          const mid = newFor!.id;
          setNewFor(null);
          patch.mutate({ mid, body: { newField: { ...f, applies: ['*'], sources: ['manual'], aliases: [] } } }, { onSuccess: () => qc.invalidateQueries({ queryKey: ['fields'] }) });
        }}
      />
    </>
  );
}

export default function Formats() {
  return (
    <Routes>
      <Route index element={<FormatList />} />
      <Route path="v/:id" element={<MappingScreen />} />
      <Route path="*" element={<FormatList />} />
    </Routes>
  );
}
