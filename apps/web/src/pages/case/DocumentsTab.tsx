// Documents tab: drop zone, one block per received file with the documents found in it, label
// corrections, document pages placed in the report, earlier cases seen before; checklist + activity.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { RECEIVED_VIA } from '@vm/shared';
import { FileDrop, FileImg, MessageBox, Panel, ago, fmtDate, useErrorToast, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { caseKey, type TabProps } from './context';

export interface DocThumb { page: number; thumb: number | null; image: number | null; languages: string | null }
export interface DocPart {
  id: number; type: string; type_label: string; title: string | null; detected_type: string; corrected_type: string | null;
  pages: number[]; languages: string | null; confidence: number | null; is_kyc: boolean; excluded: boolean; moved_to: string | null;
  in_report_pages: number[]; thumbs: DocThumb[];
}
export interface DocRow {
  id: number; batch_no: number; channel: string | null; received_from: string | null; received_at: string; page_count: number | null;
  is_scanned: number | null; role: string | null; status: 'uploaded' | 'reading' | 'read' | 'failed'; error: string | null;
  original_name: string | null; mime: string | null; file_id: number; parts: DocPart[];
}
export interface DocsResp { types: { key: string; label: string }[]; documents: DocRow[] }
interface CheckItem { id: number; item_code: string; label: string; remark_label: string | null; state: 'y' | 'n' | 'na'; auto_state: string; overridden: number; is_manual: number }
interface Seen { assignmentId: number; caseNo: string; reportNo: string | null; signedAt: string | null; bank: string; branch: string; unit: string | null; building: string | null; match: string; rate: number | null }
interface Activity { id: number; action: string; summary: string; actor_name: string | null; actor_type: string; reason: string | null; created_at: string }

const BUSY = (d: DocRow) => d.status === 'uploaded' || d.status === 'reading';

/** "p. 3", "pp. 1–2, 4" */
export function pageRange(pages: number[]): string {
  if (!pages.length) return '';
  const s = [...pages].sort((a, b) => a - b);
  const runs: string[] = [];
  let start = s[0];
  let prev = s[0];
  for (const p of [...s.slice(1), NaN]) {
    if (p === prev + 1) { prev = p; continue; }
    runs.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = p; prev = p;
  }
  return `${s.length === 1 ? 'p.' : 'pp.'} ${runs.join(', ')}`;
}

const CYCLE: Record<CheckItem['state'], CheckItem['state']> = { y: 'n', n: 'na', na: 'y' };
const MARK: Record<CheckItem['state'], { s: string; cls: string; t: string }> = {
  y: { s: '✓', cls: 'bg-ok-soft text-ok', t: 'Received' },
  n: { s: '✕', cls: 'bg-crit-soft text-crit', t: 'Not provided' },
  na: { s: '–', cls: 'bg-sunk text-muted', t: 'Not applicable' },
};

export default function DocumentsTab({ c, go, refresh, locked }: TabProps) {
  const { can } = useAuth();
  const editable = can('edit') && !locked;
  const toast = useToast();
  const err = useErrorToast();
  const [via, setVia] = useState<string>(c.received_via && (RECEIVED_VIA as readonly string[]).includes(c.received_via) ? c.received_via : 'WhatsApp');
  const [from, setFrom] = useState(c.bank_contact ?? '');
  const [uploading, setUploading] = useState(false);
  const [byHand, setByHand] = useState('');
  const [msg, setMsg] = useState<{ title: string; subject?: string | null; message: string } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const docs = useQuery({
    queryKey: caseKey(c.id, 'documents'),
    queryFn: () => api.get<DocsResp>(`/api/assignments/${c.id}/documents`),
    refetchInterval: (q) => ((q.state.data as DocsResp | undefined)?.documents.some(BUSY) ? 3000 : false),
  });
  const checklist = useQuery({ queryKey: caseKey(c.id, 'checklist'), queryFn: () => api.get<CheckItem[]>(`/api/assignments/${c.id}/checklist`) });
  const seen = useQuery({ queryKey: caseKey(c.id, 'seen-before'), queryFn: () => api.get<Seen[]>(`/api/assignments/${c.id}/seen-before`) });
  const activity = useQuery({ queryKey: caseKey(c.id, 'activity'), queryFn: () => api.get<Activity[]>(`/api/assignments/${c.id}/activity`) });
  const firm = useQuery({ queryKey: ['firm'], queryFn: () => api.get<{ settings?: { doc_grid?: number } }>('/api/firm'), staleTime: 300_000 });

  // when reading finishes, refresh the whole case (checklist, fields, stage)
  const anyBusy = !!docs.data?.documents.some(BUSY);
  const wasBusy = useRef(anyBusy);
  useEffect(() => {
    if (wasBusy.current && !anyBusy) refresh();
    wasBusy.current = anyBusy;
  }, [anyBusy, refresh]);

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusyKey(key);
    try {
      await fn();
      if (ok) toast(ok);
      refresh();
      return true;
    } catch (e) { err(e); return false; } finally { setBusyKey(null); }
  };

  const upload = async (files: File[]) => {
    const bad = files.filter((f) => !/\.(pdf|jpe?g|png)$/i.test(f.name) && !/^(application\/pdf|image\/(jpeg|png))$/.test(f.type));
    if (bad.length) { toast(`Only PDF, JPEG or PNG files: ${bad.map((f) => f.name).join(', ')}`, 'err'); return; }
    setUploading(true);
    try {
      await api.upload(`/api/assignments/${c.id}/documents`, files, { channel: via, from });
      toast(`${files.length} file${files.length > 1 ? 's' : ''} received. Reading and sorting pages…`);
      refresh();
    } catch (e) { err(e); } finally { setUploading(false); }
  };

  const types = docs.data?.types ?? [];
  const documents = docs.data?.documents ?? [];
  const reportParts = documents.flatMap((d) => d.parts.filter((p) => !p.is_kyc && !p.excluded && !p.moved_to && p.thumbs.length).map((p) => ({ ...p, doc: d })));
  const selectedPages = reportParts.reduce((n, p) => n + p.in_report_pages.length, 0);
  const grid = firm.data?.settings?.doc_grid ?? 9;
  const gridText = grid === 9 ? 'Placed 9 per page in a 3×3 grid' : grid === 4 ? 'Placed 4 per page in a 2×2 grid' : 'Placed one per page';

  const togglePage = (p: DocPart, page: number) => {
    if (!editable) return;
    const next = p.in_report_pages.includes(page) ? p.in_report_pages.filter((x) => x !== page) : [...p.in_report_pages, page].sort((a, b) => a - b);
    act(`pg${p.id}-${page}`, () => api.patch(`/api/assignments/${c.id}/parts/${p.id}`, { reportPages: next }));
  };

  const items = checklist.data ?? [];
  const got = items.filter((i) => i.state === 'y').length;
  const pendingCount = items.filter((i) => i.state === 'n').length;

  return (
    <div className="cols">
      <div className="grid min-w-0 gap-4">
        {editable && (
          <FileDrop onFiles={upload} accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" disabled={uploading}>
            <h3 className="text-[15px] font-semibold">Drop documents here as they arrive</h3>
            <p className="muted mt-1 text-[13px]">Photos, scanned or native PDFs, in any order. Pages are read, sorted into documents and labelled; KYC pages are kept out of the report.</p>
            <div className="mx-auto mt-3 grid max-w-md grid-cols-1 gap-2 text-left sm:grid-cols-2">
              <div className="field">
                <label htmlFor="doc-via">Received via</label>
                <select id="doc-via" value={via} onChange={(e) => setVia(e.target.value)}>
                  {RECEIVED_VIA.map((v) => <option key={v}>{v}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="doc-from">From</label>
                <input id="doc-from" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="e.g. Mr. Joshi (bank)" />
              </div>
            </div>
            {uploading && <div className="muted mt-3"><span className="dots">Uploading</span></div>}
          </FileDrop>
        )}
        {locked && <div className="panel px-4 py-3 text-[13px] muted">The report is signed and locked. Reopen it on the Report &amp; sign-off tab to change documents.</div>}

        {docs.isLoading && <div className="muted"><span className="dots">Loading documents</span></div>}
        {!docs.isLoading && !documents.length && (
          <div className="panel px-4 py-6 text-center muted">No documents yet. Files sent by the bank on WhatsApp or email can be dropped above as they arrive.</div>
        )}

        {documents.map((d) => (
          <section key={d.id} className="panel overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
              <div className="min-w-0">
                <b className="break-words">{d.original_name ?? `Document ${d.id}`}</b>
                <div className="sub">
                  {[
                    d.page_count ? `${d.page_count} ${d.mime?.startsWith('image/') ? (d.page_count > 1 ? 'photos' : 'photo') : d.page_count > 1 ? 'pages' : 'page'}` : null,
                    d.is_scanned === 1 ? 'scanned' : d.is_scanned === 0 ? 'native PDF' : null,
                    d.role === 'site_sheet' ? 'site inspection sheet' : null,
                    [d.channel, d.received_from ? `from ${d.received_from}` : null].filter(Boolean).join(' '),
                    fmtDate(d.received_at, true),
                  ].filter(Boolean).join(' · ')}
                </div>
              </div>
              {d.status === 'read' && <span className="tag">{d.parts.length} document{d.parts.length === 1 ? '' : 's'} found</span>}
              {d.status === 'failed' && <span className="sev crit">Could not read</span>}
            </div>
            {BUSY(d) && (
              <div className="flex items-center gap-3 px-4 py-4 text-[13px]">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-line border-t-stamp" aria-hidden />
                <span>Reading and sorting pages…</span>
              </div>
            )}
            {d.status === 'failed' && (
              <div className="px-4 py-3 text-[13px]">
                <div className="rounded-md bg-crit-soft px-3 py-2 text-crit">{d.error || 'The pages could not be read.'}</div>
                <p className="muted mt-2 text-[12.5px]">The file is kept with the case. Read it again, enter the details on Extracted details, or upload a clearer copy.</p>
                {!locked && (
                  <button className="btn sm mt-2" onClick={() => api.post(`/api/assignments/${c.id}/documents/${d.id}/retry`).then(() => refresh()).catch(err)}>Read again</button>
                )}
              </div>
            )}
            {d.parts.length > 0 && (
              <div className="tablewrap">
                <table className="list">
                  <thead><tr><th>Detected document</th><th>Pages · language</th><th>Conf.</th><th className="w-[1%]"></th></tr></thead>
                  <tbody>
                    {d.parts.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <div className="font-semibold">{p.title || p.type_label}</div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {p.title && p.title !== p.type_label && <span className="sub">{p.type_label}</span>}
                            {p.corrected_type && <span className="edited">corrected</span>}
                          </div>
                        </td>
                        <td className="text-[13px]">
                          {pageRange(p.pages)}
                          {p.is_kyc ? ' · kept out of the report' : p.moved_to === 'site_photos' ? ' · moved to Site visit photos' : p.languages ? ` · ${p.languages}` : ''}
                          {p.moved_to === 'site_photos' && <> <button className="linkbtn" onClick={() => go('site')}>Open</button></>}
                        </td>
                        <td>{p.is_kyc ? <span className="conf x">excluded</span> : <ConfPct v={p.confidence} />}</td>
                        <td>
                          {editable && (
                            <select
                              className="inp !w-auto !py-1 text-[12.5px]"
                              aria-label={`Correct label for ${p.title || p.type_label}`}
                              value=""
                              disabled={busyKey === `lbl${p.id}`}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (!v) return;
                                const type = v === '__reset' ? null : v;
                                act(`lbl${p.id}`, () => api.patch(`/api/assignments/${c.id}/parts/${p.id}`, { type }), type ? `Label corrected to ${types.find((t) => t.key === type)?.label ?? type}.` : 'Label reset to the read label.');
                              }}
                            >
                              <option value="">Correct label…</option>
                              {p.corrected_type && <option value="__reset">Reset to read label</option>}
                              {types.filter((t) => t.key !== p.type).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                            </select>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}

        {reportParts.length > 0 && (
          <Panel title="Document pages in the report" right={<span className="tag">{selectedPages} selected</span>} pad={false}>
            <p className="sub px-4 pt-3">{gridText}. Click a page to add it to or take it out of the report. KYC pages are never placed.</p>
            <div className="photos">
              {reportParts.flatMap((p) => p.thumbs.map((t) => {
                const on = p.in_report_pages.includes(t.page);
                return (
                  <button
                    key={`${p.id}-${t.page}`}
                    type="button"
                    className={`ph ${on ? 'sel' : ''}`}
                    onClick={() => togglePage(p, t.page)}
                    disabled={!editable || busyKey === `pg${p.id}-${t.page}`}
                    aria-pressed={on}
                    title={on ? 'In the report — click to leave out' : 'Click to place in the report'}
                  >
                    <FileImg id={t.thumb ?? t.image} alt={`${p.type_label} page ${t.page}`} />
                    <span className="ck">{on ? '✓' : ''}</span>
                    <div className="cap">{p.title || p.type_label}<small>p. {t.page}</small></div>
                  </button>
                );
              }))}
            </div>
          </Panel>
        )}

        {documents.some((d) => d.status === 'read') && (
          <Panel title="Seen before" right={seen.data?.length ? <span className="chip c-site">{seen.data.length} match{seen.data.length > 1 ? 'es' : ''}</span> : undefined}>
            {!seen.data?.length ? (
              <div className="muted text-[13px]">No earlier case of the firm with this survey no., building or society.</div>
            ) : (<>
              <p className="sub mb-2">Earlier cases of the firm with the same survey no., building or society:</p>
              <ul className="grid gap-2">
                {seen.data.map((s) => (
                  <li key={s.assignmentId} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2 text-[13px] last:border-0">
                    <div className="min-w-0">
                      <b>{[s.unit && `Flat ${s.unit}`, s.building && `Bldg ${s.building}`].filter(Boolean).join(' ') || 'Earlier case'}</b>{' '}
                      <span className="mono">{s.reportNo ?? s.caseNo}</span>
                      {s.signedAt && <> · {fmtDate(s.signedAt)}</>} · {s.bank} {s.branch}
                      {s.rate ? <> · <span className="mono">Rs. {Number(s.rate).toLocaleString('en-IN')}/sq.ft.</span></> : null}
                    </div>
                    <span className="tag">{s.match}</span>
                  </li>
                ))}
              </ul>
            </>)}
            <p className="sub mt-2">Used as internal guidance for the rate. Earlier opinions are not cited as evidence in the report.</p>
          </Panel>
        )}
      </div>

      <div className="grid min-w-0 gap-4">
        <Panel title="Document checklist" right={<span className="tag">{got}/{items.filter((i) => i.state !== 'na').length} received</span>} pad={false}>
          {checklist.isLoading && <div className="muted p-4"><span className="dots">Loading</span></div>}
          <ul>
            {items.map((i) => {
              const m = MARK[i.state];
              return (
                <li key={i.id} className="flex items-center gap-3 border-b border-line px-4 py-2 text-[13px] last:border-0">
                  <button
                    type="button"
                    className={`grid h-6 w-6 flex-none place-items-center rounded font-bold ${m.cls}`}
                    title={`${m.t}${editable ? ' — click to change' : ''}`}
                    aria-label={`${i.label}: ${m.t}`}
                    disabled={!editable || busyKey === `ck${i.id}`}
                    onClick={() => act(`ck${i.id}`, () => api.patch(`/api/assignments/${c.id}/checklist/${i.id}`, { state: CYCLE[i.state] }))}
                  >{m.s}</button>
                  <span className={`min-w-0 flex-1 ${i.state === 'na' ? 'muted' : ''}`}>{i.label}</span>
                  {!!i.overridden && <span className="edited">edited</span>}
                  {!!i.is_manual && <span className="tag">by hand</span>}
                </li>
              );
            })}
          </ul>
          {editable && (
            <div className="grid gap-3 border-t border-line p-4">
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!byHand.trim()) { toast('Type the document name first', 'err'); return; }
                  act('hand', () => api.post(`/api/assignments/${c.id}/checklist`, { label: byHand.trim() }), `${byHand.trim()} added to the checklist.`).then((ok) => ok && setByHand(''));
                }}
              >
                <input className="inp" value={byHand} onChange={(e) => setByHand(e.target.value)} placeholder="Add a document received by hand" aria-label="Document received by hand" />
                <button className="btn sm" disabled={busyKey === 'hand'}>Add</button>
              </form>
              <button
                type="button"
                className="btn"
                disabled={!pendingCount || busyKey === 'remind'}
                onClick={() => act('remind', async () => setMsg(await api.post(`/api/assignments/${c.id}/messages/doc_reminder`)))}
              >Draft reminder for pending documents</button>
            </div>
          )}
        </Panel>
        {msg && <MessageBox title={msg.title} subject={msg.subject} text={msg.message} onClose={() => setMsg(null)} />}

        <Panel title="Activity" pad={false}>
          {!activity.data?.length ? (
            <div className="muted p-4 text-[13px]">{activity.isLoading ? 'Loading…' : 'Nothing yet.'}</div>
          ) : (
            <ul>
              {activity.data.slice(0, 15).map((a) => (
                <li key={a.id} className="border-b border-line px-4 py-2.5 text-[13px] last:border-0">
                  <div>{a.summary}</div>
                  <div className="sub">{ago(a.created_at)} · {a.actor_name ?? (a.actor_type === 'system' ? 'System' : a.actor_type)}</div>
                </li>
              ))}
            </ul>
          )}
          {(activity.data?.length ?? 0) > 15 && <div className="border-t border-line px-4 py-2"><button className="linkbtn" onClick={() => go('hist')}>Full history</button></div>}
        </Panel>
      </div>
    </div>
  );
}

function ConfPct({ v }: { v: number | null }) {
  if (v === null || v === undefined) return <span className="conf x">—</span>;
  const cls = v >= 90 ? 'hi' : v >= 75 ? 'md' : 'lo';
  return <span className={`conf ${cls}`}>{Math.round(v)}{cls === 'lo' ? ' (low)' : ''}</span>;
}
