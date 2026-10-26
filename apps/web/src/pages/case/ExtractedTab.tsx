// Extracted details: every report field with its value, where it came from, the original-language
// snippet, reading confidence, inline editing and conflict resolution.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Conf, Pending, useErrorToast, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { caseKey, type TabProps } from './context';

export interface ResolvedField {
  code: string; label: string; group: string; type: string; value: unknown; display: string | null;
  state: 'filled' | 'pending' | 'not_applicable'; notProvided?: boolean; pendingLabel: string | null; source: string | null; sourceDocType: string | null;
  page: number | null; partId: number | null; snippet: string | null; confidence: number | null; edited: boolean;
  candidates: unknown[]; conflict: { message: string; options: { label: string; display: string }[] } | null;
  formula?: string | null; ruleKeys?: string[];
}
export interface FieldsResp {
  sections: { title: string; fields: ResolvedField[] }[]; filled: number; total: number; fromDocuments: number; signed: boolean;
  legal?: { items: { key: string; field: string }[]; skip: string[] };
}

const RULE_SOURCES = new Set(['derived', 'wording', 'case', 'firm', 'checklist', 'valuation', 'evidence']);

export function sourceLine(f: ResolvedField, docLabel: (k: string) => string): string {
  if (f.edited || f.source === 'manual' || f.source === 'report_edit') return 'Edited by you';
  const p = f.page ? ` · p. ${f.page}` : '';
  switch (f.source) {
    case 'document': return `${f.sourceDocType ? docLabel(f.sourceDocType) : 'Documents'}${p}`;
    case 'site_sheet': return f.page ? `Site sheet p.${f.page}` : 'Site visit';
    case 'derived': return 'Derived (rule)';
    case 'wording': return 'Standard wording (rule)';
    case 'case': return 'Case details';
    case 'firm': return 'Firm settings';
    case 'checklist': return 'Document checklist';
    case 'valuation': return 'Valuation tab';
    case 'evidence': return 'Market evidence';
    default: return f.source ?? '';
  }
}

export default function ExtractedTab({ c, go, refresh, locked }: TabProps) {
  const { can } = useAuth();
  const toast = useToast();
  const err = useErrorToast();
  const editable = can('edit') && !locked;
  const canRules = can('set') || can('config');
  const fields = useQuery({ queryKey: caseKey(c.id, 'fields'), queryFn: () => api.get<FieldsResp>(`/api/assignments/${c.id}/fields`) });
  const docs = useQuery({ queryKey: caseKey(c.id, 'documents'), queryFn: () => api.get<{ types: { key: string; label: string }[] }>(`/api/assignments/${c.id}/documents`) });
  const docLabel = (k: string) => docs.data?.types.find((t) => t.key === k)?.label ?? k;

  if (fields.isLoading) return <div className="muted p-4"><span className="dots">Loading fields</span></div>;
  if (!fields.data) return <div className="muted p-4">Could not load the fields.</div>;
  const d = fields.data;
  // documents listed under "Legal documents" in the report: the valuer can leave any of them out
  const legalKey = new Map((d.legal?.items ?? []).map((x) => [x.field, x.key]));
  const skip = d.legal?.skip ?? [];
  const setListed = async (key: string, listed: boolean) => {
    const next = listed ? skip.filter((k) => k !== key) : [...new Set([...skip, key])];
    try {
      await api.put(`/api/assignments/${c.id}/fields/DOC.LEGAL_SKIP`, { value: next.length ? JSON.stringify(next) : null });
      toast(listed ? 'Listed under Legal documents in the report' : 'Left out of Legal documents in the report');
      refresh();
    } catch (e) { err(e); }
  };

  return (
    <div>
      {d.fromDocuments === 0 && (
        <div className="panel mb-4 grid gap-1 px-5 py-4">
          <b>Nothing extracted yet</b>
          <span className="muted text-[13px]">
            Values fill in as documents and the site visit are read. <button className="linkbtn" onClick={() => go('docs')}>Add documents</button> — or type any value below.
          </span>
        </div>
      )}
      <div className="legend">
        <span><b className="text-ink">{d.filled} of {d.total}</b> report fields filled{d.fromDocuments ? ` · ${d.fromDocuments} from documents and site sheet` : ''}</span>
        <span className="flex items-center gap-1"><span className="conf hi">90%+</span> clear reading</span>
        <span className="flex items-center gap-1"><span className="conf md">75–89%</span> check once</span>
        <span className="flex items-center gap-1"><span className="pendv">Pending</span> waiting for later input</span>
        {editable ? <span>Click any value to edit</span> : locked ? <span>Signed and locked</span> : null}
      </div>
      {d.sections.map((s) => {
        const filled = s.fields.filter((f) => f.state === 'filled').length;
        return (
          <section key={s.title} className="panel sec">
            <h2>{s.title}<span>{filled}/{s.fields.length} filled</span></h2>
            {s.fields.map((f) => {
              const key = legalKey.get(f.code);
              const listed = key ? !skip.includes(key) : true;
              return (
                <FieldRow key={f.code} f={f} caseId={c.id} editable={editable} canRules={canRules} docLabel={docLabel} refresh={refresh} goVal={() => go('val')}
                  extra={key && f.state === 'filled' ? (
                    <label className="flex items-center gap-1.5 whitespace-nowrap text-[12.5px]" title="Listed under Legal documents in the report">
                      <input type="checkbox" checked={listed} disabled={!editable} onChange={(e) => setListed(key, e.target.checked)} /> In report
                    </label>
                  ) : null} />
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

function FieldRow({ f, caseId, editable, canRules, docLabel, refresh, goVal, extra }: { f: ResolvedField; caseId: number; editable: boolean; canRules: boolean; docLabel: (k: string) => string; refresh: () => void; goVal: () => void; extra?: React.ReactNode }) {
  const toast = useToast();
  const err = useErrorToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [showSrc, setShowSrc] = useState(false);
  const [busy, setBusy] = useState(false);
  const cancelled = useRef(false);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const isVal = f.code.startsWith('VAL.');
  const canEdit = editable && !isVal;
  const current = f.state === 'filled' ? (f.display ?? (f.value === null || f.value === undefined ? '' : String(f.value))) : '';
  const long = f.type === 'longtext' || current.length > 70;

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const save = async (value: string | null, okMsg: string) => {
    setBusy(true);
    try {
      await api.put(`/api/assignments/${caseId}/fields/${encodeURIComponent(f.code)}`, { value });
      toast(okMsg);
      refresh();
    } catch (e) { err(e); } finally { setBusy(false); }
  };

  const commit = () => {
    setEditing(false);
    if (cancelled.current) { cancelled.current = false; return; }
    const v = draft.trim();
    if (!v || v === current.trim()) return;
    save(v, `${f.label} edited; draft updated.`);
  };

  const resolve = async (option: number) => {
    setBusy(true);
    try {
      await api.post(`/api/assignments/${caseId}/fields/${encodeURIComponent(f.code)}/resolve`, { option });
      toast(`${f.label}: ${f.conflict?.options[option]?.label ?? 'choice'} kept.`);
      refresh();
    } catch (e) { err(e); } finally { setBusy(false); }
  };

  const src = sourceLine(f, docLabel);
  const rule = !f.edited && f.source !== null && RULE_SOURCES.has(f.source) && f.confidence === null;
  const startEdit = () => { if (!canEdit || busy) return; setDraft(current); cancelled.current = false; setEditing(true); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { cancelled.current = true; (e.target as HTMLElement).blur(); }
    else if (e.key === 'Enter' && (!long || !e.shiftKey)) { e.preventDefault(); (e.target as HTMLElement).blur(); }
  };

  return (
    <div className="fld">
      <div className="lbl">{f.label}</div>
      <div className="min-w-0">
        {editing ? (
          long ? (
            <textarea ref={inputRef} className="inp" rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={onKey} aria-label={f.label} />
          ) : (
            <input ref={inputRef} className="inp" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={onKey} aria-label={f.label} />
          )
        ) : f.state === 'pending' ? (
          <div
            className={canEdit ? 'v' : ''}
            role={canEdit ? 'button' : undefined}
            tabIndex={canEdit ? 0 : undefined}
            onClick={startEdit}
            onKeyDown={(e) => e.key === 'Enter' && startEdit()}
            title={canEdit ? 'Click to enter a value' : undefined}
          ><Pending label={f.pendingLabel} /></div>
        ) : (
          <div
            className={canEdit ? 'v' : 'whitespace-pre-wrap'}
            role={canEdit ? 'button' : undefined}
            tabIndex={canEdit ? 0 : undefined}
            onClick={startEdit}
            onKeyDown={(e) => e.key === 'Enter' && startEdit()}
            title={canEdit ? 'Click to edit' : undefined}
          >{current || <span className="muted">{f.notProvided ? 'Not provided' : '—'}</span>}</div>
        )}
        {(src || f.snippet || isVal || (f.edited && canEdit)) && (
          <div className="src">
            {src && <span>{src}</span>}
            {f.snippet && <button className="linkbtn" onClick={() => setShowSrc((x) => !x)}>{showSrc ? 'Hide source' : 'Show source'}</button>}
            {f.edited && canEdit && <button className="linkbtn" disabled={busy} onClick={() => save(null, `${f.label} reset to the read value.`)}>Reset to read value</button>}
            {isVal && <button className="linkbtn" onClick={goVal}>Change on Valuation tab</button>}
          </div>
        )}
        {showSrc && f.snippet && <div className="snip">{f.snippet}</div>}
        {f.source === 'derived' && !f.edited && (f.formula || f.ruleKeys?.length) ? (
          <div className="src">
            {f.formula && <span>{f.formula}</span>}
            {canRules && !!f.ruleKeys?.length && <Link className="linkbtn" to="/settings/rules">Change the bank rule</Link>}
          </div>
        ) : null}
        {f.conflict && (
          <div className="flag">
            <div><b>Check: </b>{f.conflict.message}</div>
            {editable && (
              <div className="btns">
                {f.conflict.options.map((o, i) => (
                  <button key={i} className="btn sm" disabled={busy} onClick={() => resolve(i)} title={o.display}>{o.label}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {extra}
        {f.edited && <span className="edited">edited</span>}
        {f.state === 'filled' && !f.edited && (rule ? <Conf value={null} /> : f.confidence !== null ? <Conf value={f.confidence} /> : null)}
      </div>
    </div>
  );
}
