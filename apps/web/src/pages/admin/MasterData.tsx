// Master data console: canonical fields (versioned), and the versioned JSON configurations
// (property profiles, checks, wording, document types). Changes are versioned, effective-dated and
// pinned per case (MACD: add, change, deprecate; never edit in place).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { PROPERTY_TYPES } from '@vm/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Field, Loading, Modal, PageHead, Panel, fmtDate, useErrorToast, useToast } from '@/components/ui';

interface DictField {
  id: number; code: string; version: number; label: string; group: string; description: string | null; type: string; unit: string | null; enum: string[] | null;
  applies: string[]; sources: string[]; derivation: string | null; hint: string | null; aliases: string[]; pending: string | null; sort: number; status: 'active' | 'deprecated'; firmOwned: boolean;
}
interface ConfigVersion { id: number; firm_id: number | null; ckey: string; version: number; status: 'draft' | 'published' | 'retired'; effective_from: string | null; payload: any; change_note: string | null; created_at: string; published_at: string | null }
type Kind = 'profile' | 'check_set' | 'wording' | 'doc_types';

const today = () => new Date().toISOString().slice(0, 10);
const TYPES = ['text', 'longtext', 'number', 'area', 'money', 'date', 'enum', 'boolean', 'image'];
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

// ---- canonical fields -----------------------------------------------------------------------------
type FieldForm = { code: string; label: string; group: string; type: string; unit: string; applies: string; sources: string; derivation: string; hint: string; aliases: string; pending: string; status: 'active' | 'deprecated'; note: string; isNew: boolean };
const toForm = (f?: DictField): FieldForm => ({
  code: f?.code ?? '', label: f?.label ?? '', group: f?.group ?? '', type: f?.type ?? 'text', unit: f?.unit ?? '', applies: (f?.applies ?? ['*']).join(', '), sources: (f?.sources ?? ['manual']).join(', '),
  derivation: f?.derivation ?? '', hint: f?.hint ?? '', aliases: (f?.aliases ?? []).join(', '), pending: f?.pending ?? '', status: f?.status ?? 'active', note: '', isNew: !f,
});

function FieldEditor({ form, setForm, groups, onSave, saving }: { form: FieldForm; setForm: (f: FieldForm | null) => void; groups: string[]; onSave: () => void; saving: boolean }) {
  const set = (k: keyof FieldForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: k === 'code' ? e.target.value.toUpperCase().replace(/\s+/g, '_') : e.target.value });
  const codeOk = /^[A-Z][A-Z0-9_]*(\.[A-Z0-9_]+)+$/.test(form.code);
  return (
    <Modal open onClose={() => setForm(null)} title={form.isNew ? 'Add master field' : `Change ${form.code}`}
      actions={<><button className="btn" onClick={() => setForm(null)}>Cancel</button><button className="btn pri" disabled={!codeOk || !form.label.trim() || !form.group || saving || (!form.isNew && !form.note.trim())} onClick={onSave}>{form.isNew ? 'Add field' : 'Save new version'}</button></>}>
      {!form.isNew && <p className="sub m-0">Saving creates a new version. Cases already created keep the meaning they were made with; a field ID is never reused for a different meaning.</p>}
      <div className="form" style={{ padding: 0 }}>
        <Field label="Field ID" hint={!form.code || codeOk ? 'GROUP.NAME, e.g. AREA.MEZZANINE' : <span className="text-crit">Use GROUP.NAME in capitals</span>}><input className="mono" value={form.code} onChange={set('code')} disabled={!form.isNew} /></Field>
        <Field label="Label"><input value={form.label} onChange={set('label')} /></Field>
        <Field label="Group"><input list="vm-groups" value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value.toUpperCase() })} /><datalist id="vm-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist></Field>
        <Field label="Type"><select value={form.type} onChange={set('type')}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        <Field label="Unit" hint="e.g. sq.ft., Rs., years"><input value={form.unit} onChange={set('unit')} /></Field>
        <Field label="Applies to" hint={`* or ${PROPERTY_TYPES.map((p) => p.key).join(', ')}`}><input value={form.applies} onChange={set('applies')} /></Field>
        <Field label="Sources" full hint="Where the value comes from: document types (agreement, index2, oc…), site_sheet, derived, manual"><input value={form.sources} onChange={set('sources')} /></Field>
        <Field label="Derivation (expression)" full hint="For derived fields, e.g. AREA.BUA / (1 + RULE.loading_pct / 100)"><input className="mono" value={form.derivation} onChange={set('derivation')} /></Field>
        <Field label="Reading hint" full hint="What the document reader should look for"><textarea rows={2} value={form.hint} onChange={set('hint')} /></Field>
        <Field label="Aliases" full hint="Other labels banks use for this, comma separated; improves format matching"><input value={form.aliases} onChange={set('aliases')} /></Field>
        <Field label="Pending label" hint="Shown in the draft until the value exists, e.g. Awaiting O.C."><input value={form.pending} onChange={set('pending')} /></Field>
        <Field label="Status"><select value={form.status} onChange={set('status')} disabled={form.isNew}><option value="active">Active</option><option value="deprecated">Deprecated</option></select></Field>
        <Field label="Change note" full hint={form.isNew ? 'Optional' : 'Required: why is this changing?'}><input value={form.note} onChange={set('note')} /></Field>
      </div>
    </Modal>
  );
}

function FieldsTab() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const onErr = useErrorToast();
  const fields = useQuery({ queryKey: ['fields'], queryFn: () => api.get<DictField[]>('/api/admin/fields') });
  const [group, setGroup] = useState('');
  const [q, setQ] = useState('');
  const [showDep, setShowDep] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState<FieldForm | null>(null);
  const history = useQuery({ queryKey: ['field-history', sel], queryFn: () => api.get<DictField[]>(`/api/admin/fields/${encodeURIComponent(sel!)}/history`), enabled: !!sel });
  const save = useMutation({
    mutationFn: (f: FieldForm) => api.post<{ code: string; version: number }>('/api/admin/fields', {
      code: f.code, label: f.label.trim(), group: f.group, type: f.type, unit: f.unit || null, applies: list(f.applies).length ? list(f.applies) : ['*'], sources: list(f.sources),
      derivation: f.derivation || null, hint: f.hint || null, aliases: list(f.aliases), pending: f.pending || null, status: f.status, note: f.note || null,
    }),
    onSuccess: (r) => { toast(`${r.code} saved as v${r.version}`); setForm(null); setSel(r.code); qc.invalidateQueries({ queryKey: ['fields'] }); qc.invalidateQueries({ queryKey: ['field-history', r.code] }); },
    onError: onErr,
  });
  const all = fields.data ?? [];
  const groups = useMemo(() => [...new Set(all.map((f) => f.group))].sort(), [all]);
  const s = q.trim().toLowerCase();
  const rows = all.filter((f) => (!group || f.group === group) && (showDep || f.status !== 'deprecated') && (!s || f.code.toLowerCase().includes(s) || f.label.toLowerCase().includes(s) || f.aliases.some((a) => a.toLowerCase().includes(s))));
  const cur = all.find((f) => f.code === sel);

  return (
    <div className="cols">
      <section className="panel min-w-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <select className="inp" style={{ width: 'auto' }} value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group"><option value="">All groups ({all.length})</option>{groups.map((g) => <option key={g} value={g}>{g} ({all.filter((f) => f.group === g).length})</option>)}</select>
          <input className="inp" style={{ maxWidth: 240 }} type="search" placeholder="Search ID, label or alias" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="sub flex items-center gap-1.5"><input type="checkbox" checked={showDep} onChange={(e) => setShowDep(e.target.checked)} /> Show deprecated</label>
          {can('config') && <button className="btn sm pri ml-auto" onClick={() => setForm(toForm())}>+ Add field</button>}
        </div>
        {fields.isLoading ? <Loading /> : (
          <div className="tablewrap" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
            <table className="list click">
              <thead><tr><th>Field ID</th><th>Label</th><th>Type</th><th>Sources</th><th>v</th></tr></thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.code} onClick={() => setSel(f.code)} style={f.code === sel ? { background: 'var(--stamp-soft)' } : f.status === 'deprecated' ? { opacity: 0.55 } : undefined}>
                    <td className="mono text-[12.5px]">{f.code}</td>
                    <td>{f.label}{f.status === 'deprecated' && <span className="tag ml-1">deprecated</span>}{f.firmOwned && <span className="tag ml-1">your firm</span>}</td>
                    <td className="sub">{f.type}{f.unit ? ` · ${f.unit}` : ''}</td>
                    <td className="sub">{f.derivation ? 'derived' : f.sources.slice(0, 3).join(', ')}{f.sources.length > 3 ? '…' : ''}</td>
                    <td className="mono sub">{f.version}</td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={5} className="muted">No fields match.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <aside className="grid gap-3">
        {cur ? (
          <Panel title={<div><div className="mono text-[13px] font-semibold">{cur.code}</div><div className="sub">{cur.label}</div></div>} right={can('config') && <button className="btn sm" onClick={() => setForm(toForm(cur))}>Change</button>}>
            <dl className="m-0 grid gap-2 text-[13px]">
              {([
                ['Group', cur.group], ['Type', `${cur.type}${cur.unit ? ` (${cur.unit})` : ''}`], ['Applies to', cur.applies.join(', ')], ['Sources', cur.sources.join(', ') || '—'],
                ['Derivation', cur.derivation && <code className="mono text-[12px]">{cur.derivation}</code>], ['Reading hint', cur.hint], ['Aliases', cur.aliases.join(', ')], ['Pending label', cur.pending], ['Status', cur.status],
              ] as [string, ReactNode][]).filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="eyebrow">{k}</dt><dd className="m-0 break-words">{v}</dd></div>)}
            </dl>
            <div className="mt-4 border-t border-line pt-3">
              <b className="text-[13px]">History</b>
              {history.isLoading ? <Loading /> : (
                <ol className="m-0 mt-2 grid gap-1.5 pl-0" style={{ listStyle: 'none' }}>
                  {(history.data ?? []).map((h) => (
                    <li key={h.id} className="text-[12.5px]"><span className="mono">v{h.version}</span> · {h.label}{h.status === 'deprecated' && <span className="tag ml-1">deprecated</span>}{h.firmOwned ? <span className="sub"> · your firm</span> : <span className="sub"> · platform</span>}</li>
                  ))}
                </ol>
              )}
            </div>
          </Panel>
        ) : <Panel title="Field details"><p className="sub m-0">Choose a field to see its definition and history.</p></Panel>}
        <Panel title="How fields work"><p className="sub m-0">Every fact in a report is one canonical field. Bank formats map their labels to these fields, so a value is captured once and printed everywhere. Changing a field creates a new version; deprecate instead of deleting.</p></Panel>
      </aside>
      {form && <FieldEditor form={form} setForm={setForm} groups={groups} saving={save.isPending} onSave={() => save.mutate(form)} />}
    </div>
  );
}

// ---- readable views of each configuration --------------------------------------------------------------
const Th = ({ cols }: { cols: string[] }) => <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>;

function ProfileView({ p }: { p: any }) {
  return (
    <div className="grid gap-4">
      <div className="btns text-[13px]"><span className="tag">{p.label ?? p.property_type}</span><span className="sub">Photos {p.min_photos ?? '—'}–{p.max_photos ?? '—'} · rate basis {p.rate_basis ?? '—'} · method {p.valuation_method ?? '—'}</span></div>
      <div><b className="text-[13px]">Report sections</b>
        <div className="tablewrap mt-1"><table className="list"><Th cols={['Section', 'Fields']} /><tbody>{(p.sections ?? []).map((s: any, i: number) => <tr key={i}><td className="whitespace-nowrap">{s.title}</td><td className="mono text-[12px]">{(s.fields ?? []).join(', ')}</td></tr>)}</tbody></table></div>
      </div>
      <div><b className="text-[13px]">Document checklist</b>
        <div className="tablewrap mt-1"><table className="list"><Th cols={['Code', 'Item', 'Required', 'Document types']} /><tbody>{(p.checklist ?? []).map((c: any) => <tr key={c.code}><td className="mono">{c.code}</td><td>{c.label}</td><td>{c.required ? 'Yes' : ''}</td><td className="sub">{(c.doc_types ?? []).join(', ')}</td></tr>)}</tbody></table></div>
      </div>
      {!!p.photo_prompts?.length && <div><b className="text-[13px]">Photo prompts for the engineer</b><div className="sub mt-1">{p.photo_prompts.join(' · ')}</div></div>}
      {!!p.site_sheet_fields?.length && <div><b className="text-[13px]">Site sheet fields</b><div className="mono sub mt-1 text-[12px]">{p.site_sheet_fields.join(', ')}</div></div>}
    </div>
  );
}
function ChecksView({ p }: { p: any }) {
  return (
    <div className="tablewrap"><table className="list"><Th cols={['Code', 'Check', 'Type', 'Severity', 'On']} /><tbody>
      {(p.checks ?? []).map((c: any) => (
        <tr key={c.code} style={c.enabled === false ? { opacity: 0.55 } : undefined}>
          <td className="mono text-[12.5px]">{c.code}</td>
          <td><div>{c.pass_title ?? c.title}</div>{c.fail && <div className="mono sub text-[11.5px]">fails when {c.fail}</div>}</td>
          <td className="sub">{c.type}{c.builtin ? ` · ${c.builtin}` : ''}</td>
          <td>{/^(crit|warn|info|ok)$/.test(c.severity) ? <span className={`sev ${c.severity}`}>{c.severity}</span> : <span className="mono sub text-[11.5px]">{c.severity}</span>}</td>
          <td>{c.enabled === false ? 'Off' : 'On'}</td>
        </tr>
      ))}
    </tbody></table></div>
  );
}
function WordingView({ p }: { p: any }) {
  return (
    <div className="grid gap-4">
      <div><b className="text-[13px]">Messages</b>
        <div className="mt-1 grid gap-2">{Object.entries(p.messages ?? {}).map(([k, m]: [string, any]) => (
          <details key={k} className="rounded-md border border-line p-2"><summary className="cursor-pointer"><b>{m.title ?? k}</b> <span className="mono sub">{k}</span></summary>{m.subject && <div className="sub mt-1">Subject: {m.subject}</div>}<pre className="mt-2 whitespace-pre-wrap rounded bg-sunk p-2 text-[12.5px]">{m.body}</pre></details>
        ))}</div>
      </div>
      <div><b className="text-[13px]">Report wording</b>
        <div className="tablewrap mt-1"><table className="list"><Th cols={['Field', 'Template']} /><tbody>{Object.entries(p.fields ?? {}).map(([k, t]) => <tr key={k}><td className="mono whitespace-nowrap text-[12px]">{k}</td><td className="whitespace-pre-wrap text-[12.5px]">{String(t)}</td></tr>)}</tbody></table></div>
      </div>
    </div>
  );
}
function DocTypesView({ p }: { p: any }) {
  return (
    <div className="tablewrap"><table className="list"><Th cols={['Key', 'Label', 'Reader hint', 'In report']} /><tbody>
      {(p.types ?? []).map((t: any) => <tr key={t.key}><td className="mono text-[12.5px]">{t.key}</td><td>{t.label}</td><td className="sub">{t.hint}</td><td>{t.in_report ? 'Yes' : ''}</td></tr>)}
    </tbody></table></div>
  );
}
const VIEWS: Record<Kind, (p: { p: any }) => JSX.Element> = { profile: ProfileView, check_set: ChecksView, wording: WordingView, doc_types: DocTypesView };

// ---- generic versioned-config editor --------------------------------------------------------------------
function ConfigTab({ kind, defaultKey, title }: { kind: Kind; defaultKey: string; title: string }) {
  const { can, user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const onErr = useErrorToast();
  const all = useQuery({ queryKey: ['config', kind], queryFn: () => api.get<ConfigVersion[]>(`/api/admin/config/${kind}`) });
  const keys = useMemo(() => [...new Set((all.data ?? []).map((v) => v.ckey))], [all.data]);
  const [key, setKey] = useState(defaultKey);
  const versions = (all.data ?? []).filter((v) => v.ckey === key);
  const t = today();
  const live = (fid: number | null) => versions.filter((v) => v.firm_id === fid && v.status === 'published' && (!v.effective_from || v.effective_from.slice(0, 10) <= t)).sort((a, b) => b.version - a.version)[0];
  const active = live(user!.firm_id) ?? live(null);
  const draft = versions.find((v) => v.status === 'draft' && v.firm_id === user!.firm_id);
  const [viewId, setViewId] = useState<number | null>(null);
  const shown = versions.find((v) => v.id === viewId) ?? active ?? versions[0];
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [eff, setEff] = useState(t);
  const parsed = useMemo(() => { try { return { ok: true as const, v: JSON.parse(text) }; } catch (e) { return { ok: false as const, err: (e as Error).message }; } }, [text]);
  useEffect(() => { setEditing(false); setViewId(null); }, [key]);

  const inval = () => qc.invalidateQueries({ queryKey: ['config', kind] });
  const save = useMutation({
    mutationFn: () => api.put<ConfigVersion>(`/api/admin/config/${kind}/${encodeURIComponent(key)}`, { payload: parsed.ok ? parsed.v : null, note: note || null }),
    onSuccess: () => { toast('Draft saved'); setEditing(false); inval(); },
    onError: onErr,
  });
  const publish = useMutation({
    mutationFn: (id: number) => api.post(`/api/admin/config/version/${id}/publish`, { effectiveFrom: eff }),
    onSuccess: () => { toast('Published. New cases use it from the effective date.'); setViewId(null); inval(); },
    onError: onErr,
  });
  const discard = useMutation({
    mutationFn: (id: number) => api.del(`/api/admin/config/version/${id}`),
    onSuccess: () => { toast('Draft discarded'); setViewId(null); inval(); },
    onError: onErr,
  });

  if (all.isLoading) return <Loading />;
  const View = VIEWS[kind];
  const startEdit = () => { const base = draft ?? active; setText(JSON.stringify(base?.payload ?? {}, null, 2)); setNote(draft?.change_note ?? ''); setEditing(true); };
  const ptLabel = (k: string) => PROPERTY_TYPES.find((p) => p.key === k)?.label ?? k;

  return (
    <div className="cols">
      <section className="panel min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14px] font-semibold">{title}</h3>
            {keys.length > 1 && <select className="inp" style={{ width: 'auto', padding: '4px 8px' }} value={key} onChange={(e) => setKey(e.target.value)}>{keys.map((k) => <option key={k} value={k}>{kind === 'profile' ? ptLabel(k) : k}</option>)}</select>}
            {shown && <span className={`sev ${shown.status === 'draft' ? 'warn' : shown.id === active?.id ? 'ok' : 'info'}`}>v{shown.version} · {shown.status === 'draft' ? 'draft' : shown.id === active?.id ? 'active' : shown.status}</span>}
          </div>
          {can('config') && !editing && <button className="btn sm" onClick={startEdit}>{draft ? 'Edit draft (JSON)' : 'New draft (JSON)'}</button>}
        </div>
        <div className="p-4">
          {editing ? (
            <div className="grid gap-3">
              <div className="sub">Editing {draft ? `draft v${draft.version}` : `a new draft from v${active?.version ?? '—'}`}. Nothing changes for any case until you publish.</div>
              <textarea className="inp mono" style={{ minHeight: 420, fontSize: 12.5, lineHeight: 1.45 }} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} aria-label="Configuration JSON" />
              {parsed.ok ? <div className="sub text-ok">Valid JSON</div> : <div className="sub text-crit">JSON error: {parsed.err}</div>}
              <Field label="Change note"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed and why" /></Field>
              <div className="btns">
                <button className="btn pri" disabled={!parsed.ok || save.isPending} onClick={() => save.mutate()}>Save draft</button>
                <button className="btn" onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </div>
          ) : shown ? <View p={shown.payload} /> : <div className="muted">No versions for “{key}” yet.</div>}
        </div>
      </section>
      <aside className="grid gap-3">
        {draft && can('config') && (
          <Panel title={`Draft v${draft.version}`}>
            <div className="grid gap-3">
              <div className="sub">{draft.change_note || 'No note'}</div>
              <Field label="Effective from"><input type="date" value={eff} onChange={(e) => setEff(e.target.value)} /></Field>
              <div className="btns">
                <button className="btn pri" disabled={publish.isPending || editing} onClick={() => publish.mutate(draft.id)}>Publish</button>
                <button className="btn danger" disabled={discard.isPending} onClick={() => window.confirm('Discard this draft?') && discard.mutate(draft.id)}>Discard</button>
              </div>
            </div>
          </Panel>
        )}
        <Panel title="Versions">
          <div className="grid gap-1">
            {versions.map((v) => (
              <button key={v.id} className={`flex items-start justify-between gap-2 rounded-md border-0 p-2 text-left text-[13px] ${v.id === shown?.id ? 'bg-sunk' : 'bg-transparent'}`} style={{ cursor: 'pointer' }} onClick={() => { setViewId(v.id); setEditing(false); }}>
                <span><b>v{v.version}</b> {v.firm_id === null ? <span className="tag">platform</span> : <span className="tag">your firm</span>}<span className="sub block">{v.change_note}</span></span>
                <span className="text-right"><span className={`sev ${v.status === 'draft' ? 'warn' : v.id === active?.id ? 'ok' : 'info'}`}>{v.status === 'published' ? (v.id === active?.id ? 'active' : 'scheduled') : v.status}</span><span className="sub block">{fmtDate(v.effective_from)}</span></span>
              </button>
            ))}
          </div>
        </Panel>
      </aside>
    </div>
  );
}

// ---- feedback inbox -------------------------------------------------------------------------------------
function FeedbackTab() {
  const { can } = useAuth();
  const fb = useQuery({ queryKey: ['feedback'], queryFn: () => api.get<any[]>('/api/feedback'), enabled: can('config') });
  if (!can('config')) return <Panel title="Feedback"><p className="sub m-0">Needs the “Master data & templates” permission.</p></Panel>;
  return (
    <Panel title="Feedback inbox" pad={false}>
      {fb.isLoading ? <Loading /> : (
        <div className="tablewrap"><table className="list"><Th cols={['Date', 'From', 'Kind', 'Screen', 'Comment']} /><tbody>
          {(fb.data ?? []).map((f) => (
            <tr key={f.id}><td className="sub whitespace-nowrap">{fmtDate(f.created_at, true)}</td><td>{f.name}</td><td><span className={`sev ${f.kind === 'bug' ? 'crit' : f.kind === 'wording' ? 'warn' : 'info'}`}>{f.kind}</span></td><td className="sub">{f.screen}{f.target && <div className="mono">{f.target}</div>}</td><td className="whitespace-pre-wrap">{f.body}</td></tr>
          ))}
          {!fb.data?.length && <tr><td colSpan={5} className="muted">No feedback yet.</td></tr>}
        </tbody></table></div>
      )}
    </Panel>
  );
}

// ---- page -----------------------------------------------------------------------------------------------
const TABS: { path: string; label: string; el: ReactNode }[] = [
  { path: 'fields', label: 'Canonical fields', el: <FieldsTab /> },
  { path: 'profiles', label: 'Property profiles', el: <ConfigTab kind="profile" defaultKey="flat" title="Property profile" /> },
  { path: 'checks', label: 'Checks', el: <ConfigTab kind="check_set" defaultKey="default" title="Check set" /> },
  { path: 'wording', label: 'Wording', el: <ConfigTab kind="wording" defaultKey="default" title="Wording" /> },
  { path: 'doc-types', label: 'Document types', el: <ConfigTab kind="doc_types" defaultKey="default" title="Document types" /> },
  { path: 'feedback', label: 'Feedback', el: <FeedbackTab /> },
];

export default function MasterData() {
  const { can } = useAuth();
  return (
    <>
      <PageHead eyebrow="Admin" title="Master data" />
      <p className="muted -mt-3 mb-4">
        Every change here is versioned and effective-dated. Published versions never change; edit by saving a draft and publishing it. Each case pins the versions live when it was created, so past reports never shift.
        {!can('config') && ' You can view; editing needs the “Master data & templates” permission.'}
      </p>
      <nav className="tabs" aria-label="Master data sections">
        {TABS.map((t) => <NavLink key={t.path} to={`/master/${t.path}`} className={({ isActive }) => (isActive ? 'on' : '')}>{t.label}</NavLink>)}
      </nav>
      <Routes>
        <Route index element={<Navigate to="fields" replace />} />
        {TABS.map((t) => <Route key={t.path} path={t.path} element={t.el} />)}
        <Route path="*" element={<Navigate to="/master/fields" replace />} />
      </Routes>
    </>
  );
}
