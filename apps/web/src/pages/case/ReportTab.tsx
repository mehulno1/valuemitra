// Report & sign-off: the live draft (the bank's Word format rendered in the browser) with click-to-
// edit wording, and the sign-off gate: coordinator sends to the valuer, the valuer signs.
import { useMutation, useQuery } from '@tanstack/react-query';
import { renderAsync } from 'docx-preview';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Empty, Loading, MessageBox, Modal, Panel, Pending, fmtDate, useErrorToast, useToast } from '@/components/ui';
import { api, ApiError, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { caseKey, type TabProps } from './context';

interface RepValue { code: string; label: string; display: string | null; state: string }
interface Version { id: number; kind: string; draft_version: number; status: string; error: string | null; pdf_file_id: number | null; docx_file_id: number | null; report_no: string | null; created_at: string }
interface RepStatus {
  draft_version: number; signed_at: string | null; report_no: string | null; report_rev: number; sent_for_review_at: string | null; stage: string;
  checks: { blocked: boolean; crit: number; warn: number };
  pending: { code: string; label: string; pendingLabel: string | null }[];
  values: RepValue[]; rules: { realizable_pct: number; distress_pct: number }; versions: Version[];
}
interface FieldInfo { code: string; label: string; type: string; value: unknown; display: string | null; state: string }

const M_START = '', M_VAL = '', M_END = '', M_PEND = '';
const ANY_MARK = /[-]/;

/** Replace the private-use markers in rendered text with spans. A value may continue across text nodes (line breaks). */
function markValues(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  let cur: { code: string; pend: boolean } | null = null;
  for (const t of nodes) {
    const s = t.data;
    if (!cur && !ANY_MARK.test(s)) continue;
    if (t.parentElement?.closest('style,script')) continue;
    const frag = document.createDocumentFragment();
    let buf = '';
    const flush = () => {
      if (!buf) return;
      if (cur) {
        const sp = document.createElement('span');
        sp.className = cur.pend ? 'vm-pend' : 'vm-val';
        sp.dataset.code = cur.code;
        sp.textContent = buf;
        frag.appendChild(sp);
      } else frag.appendChild(document.createTextNode(buf));
      buf = '';
    };
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch === M_START) {
        flush();
        const rest = s.slice(i + 1);
        const j = rest.search(/[]/);
        if (j < 0) { cur = null; i = s.length; break; }
        cur = { code: rest.slice(0, j), pend: rest[j] === M_PEND };
        i += j + 2;
      } else if (ch === M_END) { flush(); cur = null; i++; }
      else if (ch === M_VAL || ch === M_PEND) i++;
      else { buf += ch; i++; }
    }
    flush();
    t.replaceWith(frag);
  }
}

function snapshot(root: HTMLElement) {
  const m = new Map<string, string>();
  root.querySelectorAll<HTMLElement>('.vm-val,.vm-pend').forEach((el) => {
    const k = el.dataset.code ?? '';
    m.set(k, (m.get(k) ?? '') + (el.classList.contains('vm-pend') ? '\u0000pend:' : '') + el.textContent);
  });
  return m;
}

export default function ReportTab({ c, go, refresh, locked }: TabProps) {
  const { user, can } = useAuth();
  const toast = useToast();
  const err = useErrorToast();
  const q = useQuery({ queryKey: caseKey(c.id, 'report', c.draft_version), queryFn: () => api.get<RepStatus>(`/api/assignments/${c.id}/report`) });
  const fq = useQuery({ queryKey: caseKey(c.id, 'report-fields'), queryFn: () => api.get<{ sections: { title: string; fields: FieldInfo[] }[] }>(`/api/assignments/${c.id}/fields`) });

  const host = useRef<HTMLDivElement>(null);
  const desk = useRef<HTMLDivElement>(null);
  const prev = useRef<Map<string, string> | null>(null);
  const [nonce, setNonce] = useState(0);
  const [rendering, setRendering] = useState(true);
  const [renderErr, setRenderErr] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [confirmSign, setConfirmSign] = useState(false);
  const [edit, setEdit] = useState<{ code: string; label: string; value: string; multi: boolean; valTab: boolean } | null>(null);
  const [share, setShare] = useState<{ fileId: number; name: string; message: string } | null>(null);
  const [signErr, setSignErr] = useState<{ message: string; items: { title: string; detail?: string | null; target_tab?: string | null }[] } | null>(null);
  const [reopen, setReopen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');

  const signed = !!c.signed_at;
  const ready = !!q.data;
  const canEdit = can('edit') && !locked;
  const rerender = useCallback(() => setNonce((x) => x + 1), []);

  // fit A4 pages to narrow screens
  const fit = useCallback(() => {
    const h = host.current, d = desk.current;
    if (!h || !d) return;
    const page = h.querySelector<HTMLElement>('section.docx');
    if (!page) return;
    const avail = d.clientWidth - 32;
    const w = page.offsetWidth;
    (h.style as any).zoom = w > avail && avail > 0 ? String(Math.max(0.35, avail / w)) : '';
  }, []);
  useEffect(() => {
    const d = desk.current;
    if (!d || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(d);
    return () => ro.disconnect();
  }, [fit, ready]);

  // render the live draft whenever the draft version, signature or an edit changes it
  useEffect(() => {
    let live = true;
    if (!ready) return;
    (async () => {
      setRendering(true);
      setRenderErr(null);
      try {
        const buf = await api.binary(`/api/assignments/${c.id}/report/preview.docx`);
        if (!live || !host.current) return;
        const tmp = document.createElement('div');
        await renderAsync(buf, tmp, undefined, { inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: false, experimental: true });
        if (!live || !host.current) return;
        markValues(tmp);
        const now = snapshot(tmp);
        if (prev.current) {
          const before = prev.current;
          tmp.querySelectorAll<HTMLElement>('.vm-val').forEach((el) => {
            const k = el.dataset.code ?? '';
            if (before.get(k) !== now.get(k)) el.classList.add('vm-chg');
          });
        }
        prev.current = now;
        setPending(new Set(Array.from(tmp.querySelectorAll<HTMLElement>('.vm-pend')).map((e) => e.dataset.code)).size);
        host.current.replaceChildren(...Array.from(tmp.childNodes));
        requestAnimationFrame(fit);
      } catch (e) {
        if (live) setRenderErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (live) setRendering(false);
      }
    })();
    return () => { live = false; };
  }, [c.id, c.draft_version, c.signed_at, c.report_no, nonce, fit, ready]);

  const fieldMap = new Map<string, FieldInfo>();
  for (const s of fq.data?.sections ?? []) for (const f of s.fields) fieldMap.set(f.code, f);
  const repVals = new Map((q.data?.values ?? []).map((v) => [v.code, v]));

  const onDeskClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.vm-val');
    if (!el || !el.dataset.code) return;
    if (signed) return toast('The report is signed and locked. Reopen it to make changes.');
    if (!canEdit) return;
    const code = el.dataset.code;
    const f = fieldMap.get(code);
    const label = f?.label ?? repVals.get(code)?.label ?? code;
    if (code.startsWith('VAL.')) return setEdit({ code, label, value: '', multi: false, valTab: true });
    const shown = Array.from(host.current?.querySelectorAll<HTMLElement>(`.vm-val[data-code="${CSS.escape(code)}"]`) ?? []).map((x) => x.textContent ?? '').join('\n');
    const raw = f && (typeof f.value === 'number' || (typeof f.value === 'string' && !['text', 'longtext', 'enum'].includes(f.type))) ? String(f.value) : f?.display ?? shown;
    setEdit({ code, label, value: raw, multi: f?.type === 'longtext' || raw.length > 80 || raw.includes('\n'), valTab: false });
  };

  const save = useMutation({
    mutationFn: (b: { code: string; value: string }) => api.put(`/api/assignments/${c.id}/fields/${encodeURIComponent(b.code)}`, { value: b.value, kind: 'report_edit' }),
    onSuccess: (_r, b) => { toast(`${fieldMap.get(b.code)?.label ?? 'Value'} corrected in the report`); setEdit(null); refresh(); rerender(); },
    onError: err,
  });
  const shareDraft = useMutation({
    mutationFn: () => api.post<{ fileId: number; name: string; message: string }>(`/api/assignments/${c.id}/report/share-draft`),
    onSuccess: (r) => { setShare(r); toast('Draft PDF ready (watermarked)'); refresh(); },
    onError: err,
  });
  const sendToValuer = useMutation({
    mutationFn: () => api.post(`/api/assignments/${c.id}/report/send-to-valuer`),
    onSuccess: () => { toast('Sent to valuer for review'); refresh(); },
    onError: (e) => { if (e instanceof ApiError && Array.isArray(e.details)) setSignErr({ message: e.message, items: e.details as any[] }); else err(e); },
  });
  const sign = useMutation({
    mutationFn: () => api.post<{ reportNo: string }>(`/api/assignments/${c.id}/report/sign`),
    onSuccess: (r) => { setSignErr(null); setShare(null); setEdit(null); setConfirmSign(false); toast(`Approved and signed. Report no. ${r.reportNo} issued.`); refresh(); },
    onError: (e) => { setConfirmSign(false); if (e instanceof ApiError && Array.isArray(e.details)) setSignErr({ message: e.message, items: e.details as any[] }); else err(e); },
  });
  const doReopen = useMutation({
    mutationFn: (reason: string) => api.post(`/api/assignments/${c.id}/report/reopen`, { reason }),
    onSuccess: () => { toast('Report reopened for changes'); setReopen(false); setReopenReason(''); prev.current = null; refresh(); },
    onError: err,
  });

  if (q.isLoading) return <Loading />;
  if (!q.data) return <Empty title="Report status could not be loaded" />;
  const r = q.data;
  const v = (code: string) => repVals.get(code);
  const fmvV = v('VAL.FMV');
  const blocked = r.checks.blocked;
  const isValuer = user?.role === 'valuer';
  const nextNo = r.report_no ? r.report_no.replace(/\/R\d+$/, '') : null;
  const finals = r.versions.filter((x) => x.kind === 'final');
  const drafts = r.versions.filter((x) => x.kind === 'draft');
  const valueRows: [string, RepValue | undefined, string?][] = [
    ['Fair market value', fmvV, v('VAL.BASIS_AREA')?.display && v('VAL.RATE')?.display ? `${v('VAL.BASIS_AREA')!.display} × ${v('VAL.RATE')!.display}` : undefined],
    [`Realizable · ${r.rules.realizable_pct}%`, v('VAL.REALIZABLE')],
    [`Distress · ${r.rules.distress_pct}%`, v('VAL.DISTRESS')],
    ['Guideline', v('VAL.GUIDELINE')],
  ];
  // the sign gate uses the server's count of pending report fields, recounted on every change (not the rendered preview)
  const pend = r.pending ?? [];
  const pendNames = pend.slice(0, 5).map((p) => p.label).join(', ') + (pend.length > 5 ? ` and ${pend.length - 5} more` : '');
  const reasons = [r.checks.crit ? `${r.checks.crit} check(s) to resolve` : null, pend.length ? `${pend.length} field(s) pending: ${pendNames}` : null].filter(Boolean).join(' · ');

  return (
    <div className="grid gap-4">
      <Panel title={signed ? 'Final values' : 'Values for review'} right={signed ? <span className="chip c-signed">Signed</span> : r.sent_for_review_at ? <span className="chip c-review">With valuer since {fmtDate(r.sent_for_review_at, true)}</span> : null}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              {valueRows.map(([label, val, sub]) => (
                <div className="kv" key={label}>
                  <div className="k">{label}</div>
                  {val?.state === 'filled' && val.display ? <div className="v">{val.display}</div> : <div className="v muted">—</div>}
                  {sub && <div className="s">{sub}</div>}
                </div>
              ))}
            </div>
            {v('VAL.RATE_REASON')?.state === 'filled' && v('VAL.RATE_REASON')?.display && <p className="sub m-0">Rate reason: {v('VAL.RATE_REASON')!.display}</p>}
            {!signed && <p className="sub m-0">Click any filled value in the report below to correct its wording in place. Values themselves change on their own tabs.</p>}
          </div>

          <div className="grid content-start gap-3 rounded-[var(--r)] bg-sunk p-4">
            {signed ? (
              <>
                <div>
                  <b className="block text-[15px]">Signed and issued · <span className="mono">{r.report_no}</span></b>
                  <div className="sub">Signature and round seal placed on every signing page. The report is locked; reopening issues a revised number.</div>
                </div>
                <div className="btns">
                  <button className="btn pri" onClick={() => go('out')}>Go to output</button>
                  {can('sign') && isValuer && <button className="btn" onClick={() => setReopen(true)}>Reopen for changes</button>}
                </div>
              </>
            ) : isValuer ? (
              <>
                <div>
                  <b className="block text-[15px]">{blocked || pend.length ? 'Cannot sign yet' : 'Ready to sign'}</b>
                  <div className="sub">
                    {blocked || pend.length ? reasons || 'Open items on Checks.' : `${r.checks.warn ? `${r.checks.warn} item(s) flagged to look at on Checks. ` : ''}A report number${r.report_rev ? ` with /R${r.report_rev}` : ''} is issued when you sign.`}
                  </div>
                </div>
                <div className="btns">
                  <button className="btn pri" disabled={blocked || pend.length > 0 || sign.isPending || !can('sign')} onClick={() => setConfirmSign(true)}>{sign.isPending ? <span className="dots">Signing</span> : 'Approve and sign'}</button>
                  {can('edit') && <button className="btn" disabled={shareDraft.isPending} onClick={() => shareDraft.mutate()}>{shareDraft.isPending ? <span className="dots">Preparing draft</span> : 'Share draft with bank'}</button>}
                  {r.checks.crit > 0 && <button className="btn ghost" onClick={() => go('chk')}>Open checks</button>}
                </div>
              </>
            ) : (
              <>
                <div>
                  <b className="block text-[15px]">{blocked ? 'Not ready yet' : 'Ready for valuer review'}</b>
                  <div className="sub">{blocked ? reasons || 'Open items on Checks.' : 'All inputs in, no open checks.'}</div>
                </div>
                <div className="btns">
                  {can('edit') && <button className="btn pri" disabled={blocked || sendToValuer.isPending} onClick={() => sendToValuer.mutate()}>{r.sent_for_review_at ? 'Send to valuer again' : 'Send to valuer'}</button>}
                  {can('edit') && <button className="btn" disabled={shareDraft.isPending} onClick={() => shareDraft.mutate()}>{shareDraft.isPending ? <span className="dots">Preparing draft</span> : 'Share draft with bank'}</button>}
                  {r.checks.crit > 0 && <button className="btn ghost" onClick={() => go('chk')}>Open checks</button>}
                </div>
                <p className="sub m-0">Sign-off is done by the valuer, from their own login.</p>
              </>
            )}
          </div>
        </div>
      </Panel>

      {signErr && (
        <div className="panel msgbox" style={{ borderColor: 'var(--crit)' }}>
          <div className="flex items-center justify-between gap-2"><b className="text-crit">{signErr.message}</b><button className="btn ghost sm" onClick={() => setSignErr(null)}>Close</button></div>
          <ul className="m-0 grid gap-1 pl-5 text-[13px]">
            {signErr.items.map((it, i) => <li key={i}><b>{it.title}</b>{it.detail ? <span className="muted"> · {it.detail}</span> : null}</li>)}
          </ul>
          <div className="btns"><button className="btn sm" onClick={() => go('chk')}>Open checks</button></div>
        </div>
      )}

      {share && (
        <div className="grid gap-2">
          <MessageBox title="Draft shared with bank (watermarked DRAFT)" subject={null} text={share.message || 'Draft report attached.'} onClose={() => setShare(null)} />
          <div className="btns">
            <button className="btn sm" onClick={() => downloadFile(share.fileId, share.name).catch(err)}>Download {share.name}</button>
            <span className="sub">Any value change after this is recorded in History with the reason.</span>
          </div>
        </div>
      )}

      {edit && (
        <div className="panel sticky top-2 z-10 grid gap-2 px-4 py-3" style={{ boxShadow: '0 6px 18px rgba(0,0,0,.12)' }}>
          <div className="flex flex-wrap items-center justify-between gap-2"><b>{edit.label}</b><span className="sub mono">{edit.code}</span></div>
          {edit.valTab ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="muted">Values change on the Valuation tab.</span>
              <div className="btns"><button className="btn sm ghost" onClick={() => setEdit(null)}>Close</button><button className="btn sm pri" onClick={() => go('val')}>Open Valuation</button></div>
            </div>
          ) : (
            <>
              {edit.multi ? (
                <textarea className="inp" rows={4} autoFocus value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save.mutate({ code: edit.code, value: edit.value }); } if (e.key === 'Escape') setEdit(null); }} />
              ) : (
                <input className="inp" autoFocus value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') save.mutate({ code: edit.code, value: edit.value }); if (e.key === 'Escape') setEdit(null); }} />
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="sub">{edit.multi ? 'Enter saves · Shift+Enter for a new line' : 'Enter saves'} · recorded in History</span>
                <div className="btns"><button className="btn sm ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn sm pri" disabled={save.isPending} onClick={() => save.mutate({ code: edit.code, value: edit.value })}>Save</button></div>
              </div>
            </>
          )}
        </div>
      )}

      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="text-[13px]">
            {signed ? <b>Final · signed · locked · <span className="mono">{r.report_no}</span></b>
              : <><b>Draft v{r.draft_version}</b> · updated automatically · {rendering ? <span className="dots">Rendering</span> : `${pending} field(s) pending`}</>}
          </div>
          <div className="btns">
            <span className="legend m-0"><Pending label="Pending" /> <span className="vm-chg rounded px-1" style={{ animation: 'none', background: '#C9C3FF', color: '#1C1B2E' }}>just changed</span></span>
            <button className="btn sm ghost" disabled={rendering} onClick={rerender}>Refresh</button>
            {signed
              ? finals[0]?.pdf_file_id && <button className="btn sm" onClick={() => downloadFile(finals[0].pdf_file_id!, `${r.report_no?.replace(/\//g, '-')}.pdf`).catch(err)}>Download final PDF</button>
              : <button className="btn sm" onClick={() => api.binary(`/api/assignments/${c.id}/report/draft.pdf`).then((buf) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' })); a.download = `${c.case_no}_DRAFT_v${r.draft_version}.pdf`; a.click(); }).catch(err)}>Download draft PDF</button>}
          </div>
        </div>
        {r.draft_version === 0 && !signed && <p className="sub m-0 px-4 pt-3">The draft fills in as documents are read; everything not yet known shows as pending.</p>}
        {renderErr && <p className="m-0 px-4 pt-3 text-crit">The draft could not be rendered: {renderErr}</p>}
        <div className="p-3">
          <div ref={desk} className={`desk ${signed ? '' : 'wm-draft'}`} onClick={onDeskClick} style={{ minHeight: 240, cursor: canEdit && !signed ? undefined : 'default' }}>
            {rendering && !host.current?.childNodes.length && <div className="muted"><span className="dots">Rendering the draft</span></div>}
            <div ref={host} />
          </div>
        </div>
      </section>

      {(drafts.length > 0 || finals.length > 0) && (
        <Panel title="Issued versions" pad={false}>
          <div className="tablewrap">
            <table className="list">
              <thead><tr><th>When</th><th>Version</th><th>Status</th><th /></tr></thead>
              <tbody>
                {r.versions.map((x) => (
                  <tr key={x.id}>
                    <td className="whitespace-nowrap">{fmtDate(x.created_at, true)}</td>
                    <td>{x.kind === 'final' ? <>Final <span className="mono">{x.report_no}</span></> : `Draft v${x.draft_version} shared`}</td>
                    <td>{x.status === 'ready' ? 'Ready' : x.status === 'failed' ? <span className="text-crit" title={x.error ?? ''}>Failed</span> : <span className="dots">{x.status === 'queued' ? 'Queued' : 'Rendering'}</span>}</td>
                    <td className="text-right">
                      <div className="btns justify-end">
                        {x.pdf_file_id && <button className="btn sm ghost" onClick={() => downloadFile(x.pdf_file_id!, `${x.kind === 'final' ? x.report_no?.replace(/\//g, '-') : `draft-v${x.draft_version}`}.pdf`).catch(err)}>PDF</button>}
                        {x.docx_file_id && <button className="btn sm ghost" onClick={() => downloadFile(x.docx_file_id!, `${x.report_no?.replace(/\//g, '-') ?? 'report'}.docx`).catch(err)}>Word</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Modal
        open={confirmSign}
        onClose={() => setConfirmSign(false)}
        title="Approve and sign this report?"
        actions={<>
          <button className="btn ghost" onClick={() => setConfirmSign(false)}>Cancel</button>
          <button className="btn pri" disabled={sign.isPending} onClick={() => sign.mutate()}>{sign.isPending ? <span className="dots">Signing</span> : 'Sign and issue'}</button>
        </>}
      >
        <div className="grid gap-2 text-[14px]">
          <p className="m-0">A report number{r.report_rev ? ` with /R${r.report_rev}` : ''} is issued to <b>{c.bank_name}</b>, your signature and seal are placed, and the report is locked.</p>
          {fmvV?.display && <p className="m-0">Fair market value: <b>{fmvV.display}</b></p>}
          {r.checks.warn > 0 && <p className="m-0 text-warn">{r.checks.warn} item(s) are still flagged to look at on Checks.</p>}
          <p className="sub m-0">Changes after signing need a reopen, which issues a revised number.</p>
        </div>
      </Modal>

      <Modal
        open={reopen}
        onClose={() => setReopen(false)}
        title="Reopen the signed report"
        actions={<>
          <button className="btn ghost" onClick={() => setReopen(false)}>Cancel</button>
          <button className="btn pri" disabled={!reopenReason.trim() || doReopen.isPending} onClick={() => doReopen.mutate(reopenReason.trim())}>Reopen for changes</button>
        </>}
      >
        <p className="m-0">Report <span className="mono">{r.report_no}</span> stays in the register as superseded. Signing again issues <b className="mono">{nextNo}/R{r.report_rev + 1}</b>.</p>
        <div className="field">
          <label>Reason (kept in the audit trail)</label>
          <textarea rows={3} autoFocus value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} placeholder="e.g. Bank asked to correct the boundaries" />
        </div>
      </Modal>
    </div>
  );
}
