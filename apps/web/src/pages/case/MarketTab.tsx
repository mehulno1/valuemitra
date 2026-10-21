// Market evidence: ready reckoner, captured IGR / listing pages, ranked comparables with valuer
// overrides, the dot plot and the evidence-backed proposal.
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { inr, SQFT_PER_SQM } from '@vm/shared';
import { Empty, FileDrop, Loading, Modal, Panel, Pending, fmtDate, useErrorToast, useToast } from '@/components/ui';
import { api, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { caseKey, type TabProps } from './context';

interface Adj { code: string; label: string; pct: number }
interface Comp {
  id: number; is_subject: number | boolean; source_type: string; source_ref: string | null; building: string | null; society: string | null; locality: string | null;
  txn_date: string | null; is_asking_price: number | boolean; area_value: number | string; area_basis: string; area_bua_sqft: number | string; price: number | string;
  rate_per_sqft: number | string; adjustments: Adj[]; adjusted_rate: number | string; weight: number | string; weight_label: string; included: number | boolean;
  exclusion_reason: string | null; age_months: number | string | null; note: string | null; notes: string | null; manual_override: number | boolean; file_id: number | null; bhk: string | null;
}
interface Capture { id: number; file_id: number; source_kind: string; source_name: string | null; url: string | null; status: string; error: string | null; in_report: number | boolean }
interface Evidence {
  readyReckoner: { ratePerSqm: unknown; ratePerSqft: unknown; year: unknown; source: string | null } | null;
  guideline: unknown; consideration: unknown; area: unknown; registrationDate: unknown;
  proposal: { rate: unknown; lo: unknown; hi: unknown } | null;
  comparables: Comp[]; captures: Capture[];
  rules: { window: number; radius: number; listingDiscount: number };
}

const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const rs = (v: unknown) => (n(v) === null ? '—' : `Rs. ${inr(n(v))}`);
const SOURCE: Record<string, string> = { index2: 'Index II', igr_search: 'IGR search', listing: 'Listing', own_report: 'Earlier report', manual: 'Manual', valuer_entry: 'Valuer entry' };
const KIND: Record<string, string> = { igr: 'IGR search', listing: 'Listing page', other: 'Other evidence' };

export default function MarketTab({ c, go, refresh, locked }: TabProps) {
  const { can } = useAuth();
  const toast = useToast();
  const err = useErrorToast();
  const q = useQuery({
    queryKey: caseKey(c.id, 'evidence'),
    queryFn: () => api.get<Evidence>(`/api/assignments/${c.id}/evidence`),
    refetchInterval: (qq) => ((qq.state.data?.captures ?? []).some((x) => x.status === 'uploaded' || x.status === 'reading') ? 3000 : false),
  });
  const vq = useQuery({ queryKey: caseKey(c.id, 'valuation'), queryFn: () => api.get<any>(`/api/assignments/${c.id}/valuation`) });

  const [kind, setKind] = useState<'igr' | 'listing' | 'other'>('listing');
  const [source, setSource] = useState('99acres');
  const [url, setUrl] = useState('');
  const [edit, setEdit] = useState<{ comp: Comp; included: boolean; weight: string; reason: string } | null>(null);

  const upload = useMutation({
    mutationFn: (files: File[]) => api.upload(`/api/assignments/${c.id}/evidence`, files, { kind, source: kind === 'igr' ? source || 'IGR Maharashtra' : source, url }),
    onSuccess: (r: any) => { toast(`Captured ${r.ids?.length ?? 0} page(s). Reading entries.`); setUrl(''); refresh(); },
    onError: err,
  });
  const refreshEv = useMutation({
    mutationFn: () => api.post(`/api/assignments/${c.id}/evidence/refresh`),
    onSuccess: (r: any) => { toast(r.proposal ? `Evidence refreshed. Evidence-backed rate Rs. ${inr(r.proposal.rate)} per sq.ft.` : 'Evidence refreshed'); refresh(); },
    onError: err,
  });
  const override = useMutation({
    mutationFn: (b: { cid: number; included?: boolean; weight?: number; reason: string }) => api.patch(`/api/assignments/${c.id}/evidence/${b.cid}`, { included: b.included, weight: b.weight, reason: b.reason }),
    onSuccess: () => { toast('Comparable updated. Proposal recomputed.'); setEdit(null); refresh(); },
    onError: err,
  });
  const inReport = useMutation({
    mutationFn: (b: { cid: number; inReport: boolean }) => api.patch(`/api/assignments/${c.id}/captures/${b.cid}`, { inReport: b.inReport }),
    onSuccess: () => refresh(),
    onError: err,
  });

  if (q.isLoading) return <Loading />;
  if (!q.data) return <Empty title="Market evidence could not be loaded" />;
  const ev = q.data;
  const area = n(ev.area);
  const gv = n(ev.guideline);
  const agr = n(ev.consideration);
  const comps = ev.comparables;
  const captures = ev.captures;
  const prop = ev.proposal ? { rate: n(ev.proposal.rate)!, lo: n(ev.proposal.lo) ?? n(ev.proposal.rate)!, hi: n(ev.proposal.hi) ?? n(ev.proposal.rate)! } : null;
  const adopted = n(vq.data?.current?.adopted_rate);
  const canEdit = can('edit') && !locked;
  const canVal = can('val') && !locked;

  // anchors: the two heaviest included comparables; listings average (as in the engine's proposal)
  const inc = comps.filter((x) => !!Number(x.included) && Number(x.weight) > 0);
  const anchors = [...inc].sort((a, b) => Number(b.weight) - Number(a.weight)).slice(0, 2);
  const listings = inc.filter((x) => x.source_type === 'listing');
  const listAvg = listings.length ? Math.round(listings.reduce((t, x) => t + Number(x.adjusted_rate), 0) / listings.length) : null;
  const describe = (x: Comp) => (x.is_subject ? `this property's own registration (Rs. ${inr(n(x.adjusted_rate))})` : `${SOURCE[x.source_type] ?? x.source_type}${x.source_ref ? ` ${x.source_ref}` : ''} (Rs. ${inr(n(x.adjusted_rate))}${x.adjustments.length ? ' after adjustment' : ''})`);

  return (
    <div className="grid gap-4">
      {/* ready reckoner */}
      <Panel title="Ready reckoner and registration" right={canEdit && <button className="btn sm" disabled={refreshEv.isPending} onClick={() => refreshEv.mutate()}>{refreshEv.isPending ? <span className="dots">Refreshing</span> : 'Refresh evidence'}</button>}>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="kv">
            <div className="k">Ready reckoner{ev.readyReckoner?.year ? ` ${String(ev.readyReckoner.year)}` : ''}</div>
            {ev.readyReckoner ? (
              <>
                <div className="v">Rs. {inr(n(ev.readyReckoner.ratePerSqm))} / sq.m.</div>
                <div className="s">Rs. {inr(n(ev.readyReckoner.ratePerSqft) ?? Math.round((n(ev.readyReckoner.ratePerSqm) ?? 0) / SQFT_PER_SQM))} per sq.ft. · {ev.readyReckoner.source ?? 'looked up automatically'}</div>
              </>
            ) : <div className="mt-1"><Pending label="Needs the property village" /></div>}
          </div>
          <div className="kv">
            <div className="k">Guideline value</div>
            {gv !== null ? (
              <>
                <div className="v">{rs(gv)}</div>
                <div className="s">As per Index II{area ? ` · Rs. ${inr(gv / area)} per sq.ft. BUA` : ''}</div>
              </>
            ) : <div className="mt-1"><Pending label="Awaiting Index II" /></div>}
          </div>
          <div className="kv">
            <div className="k">This property's registration</div>
            {agr !== null ? (
              <>
                <div className="v">{rs(agr)}</div>
                <div className="s">{ev.registrationDate ? fmtDate(String(ev.registrationDate)) : 'Date pending'}{area ? ` · Rs. ${inr(agr / area)} per sq.ft. BUA` : ''}</div>
              </>
            ) : <div className="mt-1"><Pending label="Awaiting agreement / Index II" /></div>}
          </div>
        </div>
        {!area && <p className="sub mt-3">Built-up area is not known yet. Rates per sq.ft. and the proposal appear once the agreement or Index II is read.</p>}
      </Panel>

      {/* capture */}
      <div className="split">
        <Panel title="Capture comparables">
          <p className="muted mt-0 text-[13px]">
            Search IGR and the listing sites as usual and capture the result pages (screenshot or PDF). The system reads every entry, <b>keeps the last {ev.rules.window} months within {ev.rules.radius} km</b>, converts each to a rate per sq.ft. built-up and ranks them. Listings are discounted {ev.rules.listingDiscount}% for asking price.
          </p>
          {canEdit ? (
            <div className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="field">
                  <label>Page type</label>
                  <select value={kind} onChange={(e) => { const k = e.target.value as typeof kind; setKind(k); setSource(k === 'igr' ? 'IGR Maharashtra' : k === 'listing' ? '99acres' : ''); }}>
                    <option value="igr">IGR search (Index II)</option>
                    <option value="listing">Listing page</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="field">
                  <label>Source</label>
                  <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="99acres, MagicBricks, Housing" list="vm-ev-sources" />
                  <datalist id="vm-ev-sources"><option value="99acres" /><option value="MagicBricks" /><option value="Housing.com" /><option value="NoBroker" /><option value="IGR Maharashtra" /></datalist>
                </div>
                <div className="field">
                  <label>Page link (optional)</label>
                  <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" inputMode="url" />
                </div>
              </div>
              <FileDrop accept="image/*,application/pdf" onFiles={(f) => upload.mutate(f)} disabled={upload.isPending}>
                <b>{upload.isPending ? <span className="dots">Uploading</span> : 'Drop screenshots or PDFs of the result pages'}</b>
                <div className="sub">One file per captured page. Each entry on the page becomes a comparable.</div>
              </FileDrop>
            </div>
          ) : <p className="sub">{locked ? 'The report is signed and locked.' : 'You do not have permission to add evidence.'}</p>}
        </Panel>

        <Panel title="Captured pages" right={<span className="sub">{captures.length} page(s) · tick to print in the report</span>} pad={false}>
          {captures.length === 0 ? <p className="sub p-4">No pages captured yet.</p> : (
            <ul className="m-0 list-none p-0">
              {captures.map((cp) => (
                <li key={cp.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <b className="block text-[13.5px]">{KIND[cp.source_kind] ?? cp.source_kind}{cp.source_name ? ` · ${cp.source_name}` : ''}</b>
                    <div className="sub flex flex-wrap gap-x-3">
                      <CaptureStatus s={cp.status} />
                      {cp.error && <span className="text-crit" title={cp.error}>{cp.error.slice(0, 90)}</span>}
                      {cp.url && <a className="linkbtn" href={cp.url} target="_blank" rel="noreferrer">Open page</a>}
                      <button className="linkbtn" onClick={() => downloadFile(cp.file_id, `evidence-${cp.id}`).catch(err)}>Download</button>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-[12.5px]">
                    <input type="checkbox" checked={!!Number(cp.in_report)} disabled={!canEdit || inReport.isPending} onChange={(e) => inReport.mutate({ cid: cp.id, inReport: e.target.checked })} />
                    In report
                  </label>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* comparables */}
      <Panel title="Comparables" right={<span className="sub">{inc.length} of {comps.length} used · rates per sq.ft. built-up</span>} pad={false}>
        {comps.length === 0 ? (
          <p className="sub p-4">No comparables yet. Capture IGR search results or listing pages above; this property's own registration is added automatically once its Index II is read.</p>
        ) : (
          <div className="tablewrap">
            <table className="list">
              <thead>
                <tr><th>Source</th><th>Property</th><th>Date</th><th className="text-right">BUA</th><th className="text-right">Price</th><th className="text-right">Rate</th><th>Adjustments</th><th className="text-right">Adjusted</th><th>Weight</th><th>Note</th>{canVal && <th />}</tr>
              </thead>
              <tbody>
                {comps.map((x) => {
                  const used = !!Number(x.included);
                  return (
                    <tr key={x.id} style={used ? undefined : { opacity: 0.55 }}>
                      <td className="whitespace-nowrap">{SOURCE[x.source_type] ?? x.source_type}{x.is_subject ? ' · this property' : ''}{x.file_id ? <> · <button className="linkbtn" onClick={() => downloadFile(x.file_id!, `comparable-${x.id}`).catch(err)}>page</button></> : null}</td>
                      <td className="min-w-[180px]">{[x.building, x.society].filter(Boolean).join(', ') || x.locality || 'Nearby property'}{x.bhk ? ` · ${x.bhk}` : ''}{x.source_ref ? <div className="sub">{x.source_ref}</div> : null}</td>
                      <td className="whitespace-nowrap">{x.txn_date ? fmtDate(x.txn_date) : '—'}{n(x.age_months) !== null && n(x.age_months)! > ev.rules.window ? <div className="sub text-warn">{Math.round(n(x.age_months)!)} months old</div> : null}</td>
                      <td className="n">{inr(n(x.area_bua_sqft))}{x.area_basis === 'carpet' ? <div className="sub">carpet {inr(n(x.area_value))}</div> : null}</td>
                      <td className="n">{inr(n(x.price))}{x.is_asking_price ? <div className="sub">asking</div> : null}</td>
                      <td className="n">{inr(n(x.rate_per_sqft))}</td>
                      <td className="min-w-[140px]">{x.adjustments.length ? x.adjustments.map((a) => <div key={a.code + a.label} className="whitespace-nowrap">{a.label} {a.pct > 0 ? '+' : '−'}{Math.abs(a.pct)}%</div>) : <span className="muted">None</span>}</td>
                      <td className="n"><b>{inr(n(x.adjusted_rate))}</b></td>
                      <td className="whitespace-nowrap">{used ? x.weight_label : <span className="muted">Not used</span>}{x.manual_override ? <div><span className="edited">by valuer</span></div> : null}</td>
                      <td className="min-w-[160px] text-[12.5px]">{!used && x.exclusion_reason ? <div className="text-warn">{x.exclusion_reason}</div> : null}{x.note || x.notes}</td>
                      {canVal && <td><button className="btn sm" onClick={() => setEdit({ comp: x, included: used, weight: String(Number(x.weight)), reason: '' })}>Adjust</button></td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* plot + proposal */}
      {(comps.length > 0 || prop) && (
        <div className="split">
          <Panel title="Rates per sq.ft. built-up">
            <DotPlot comps={comps} prop={prop} adopted={adopted} />
            <div className="legend mb-0 mt-2">
              <span><Dot color="var(--ok)" /> Registered sale</span>
              <span><Dot color="var(--muted)" /> Listing / other</span>
              <span><Dot color="var(--muted)" hollow /> Not used</span>
              <span>Tail = raw rate before adjustment</span>
            </div>
          </Panel>
          <Panel title="Evidence-backed proposal">
            {prop ? (
              <div className="grid gap-3">
                <div className="kv">
                  <div className="k">Evidence-backed rate</div>
                  <div className="v">Rs. {inr(prop.rate)} per sq.ft. built-up</div>
                  <div className="s">range Rs. {inr(prop.lo)} to {inr(prop.hi)}</div>
                </div>
                <p className="m-0 text-[13px]">
                  {anchors.length ? <>Anchored on {anchors.map(describe).join(' and ')}</> : 'Weighted median of the comparables in use'}
                  {listAvg !== null ? <>; listings average Rs. {inr(listAvg)} after adjustment</> : null}. Weighted median of {inc.length} comparable(s); range is the weighted inter-quartile, at least ±3%.
                </p>
                {adopted !== null && Math.abs(adopted - prop.rate) / prop.rate > 0.001 && (
                  <p className="m-0 text-[13px] text-warn">Valuer has adopted Rs. {inr(adopted)} ({adopted > prop.rate ? '+' : '−'}{Math.abs(Math.round(((adopted - prop.rate) / prop.rate) * 1000) / 10)}%).</p>
                )}
                <div className="btns"><button className="btn pri" onClick={() => go('val')}>Use in valuation</button></div>
                <p className="sub m-0">Listing dates are capture dates unless the page shows one.</p>
              </div>
            ) : (
              <p className="sub m-0">{area ? 'No comparables in use yet. Capture evidence, or include a comparable.' : 'The proposal needs the built-up area first.'}</p>
            )}
          </Panel>
        </div>
      )}

      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title="Adjust comparable"
        actions={edit && (
          <>
            <button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
            <button
              className="btn pri"
              disabled={override.isPending || !edit.reason.trim()}
              onClick={() => {
                const w = Number(edit.weight);
                if (!(w >= 0 && w <= 3)) return toast('Weight must be between 0 and 3', 'err');
                override.mutate({ cid: edit.comp.id, included: edit.included, weight: w, reason: edit.reason.trim() });
              }}
            >Save</button>
          </>
        )}
      >
        {edit && (
          <div className="grid gap-3">
            <div className="sub">{SOURCE[edit.comp.source_type] ?? edit.comp.source_type} · {[edit.comp.building, edit.comp.society].filter(Boolean).join(', ') || 'Nearby property'} · adjusted Rs. {inr(n(edit.comp.adjusted_rate))}</div>
            <label className="flex items-center gap-2"><input type="checkbox" checked={edit.included} onChange={(e) => setEdit({ ...edit, included: e.target.checked })} /> Use this comparable</label>
            <div className="field">
              <label>Weight (0 to 3; High ≥ 0.8, Medium ≥ 0.4)</label>
              <input className="mono" inputMode="decimal" value={edit.weight} onChange={(e) => setEdit({ ...edit, weight: e.target.value })} />
              <div className="btns mt-2">
                {[['High', '1'], ['Medium', '0.6'], ['Low', '0.3']].map(([l, w]) => <button key={l} type="button" className="btn sm ghost" onClick={() => setEdit({ ...edit, weight: w })}>{l}</button>)}
              </div>
            </div>
            <div className="field">
              <label>Reason (recorded in the audit trail)</label>
              <textarea rows={3} value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} placeholder="e.g. Different wing with a lift; not comparable" />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function CaptureStatus({ s }: { s: string }) {
  if (s === 'read') return <span className="text-ok">Read</span>;
  if (s === 'failed') return <span className="text-crit">Could not read</span>;
  return <span className="dots">Reading</span>;
}

const Dot = ({ color, hollow }: { color: string; hollow?: boolean }) => (
  <svg width="10" height="10" aria-hidden><circle cx="5" cy="5" r="4" fill={hollow ? 'none' : color} stroke={color} strokeWidth="1.5" /></svg>
);

function DotPlot({ comps, prop, adopted }: { comps: Comp[]; prop: { rate: number; lo: number; hi: number } | null; adopted: number | null }) {
  const pts = comps.map((x) => ({ adj: Number(x.adjusted_rate), raw: Number(x.rate_per_sqft), used: !!Number(x.included), sale: x.source_type !== 'listing', subject: !!Number(x.is_subject), id: x.id })).filter((p) => p.adj > 0);
  const vals = [...pts.flatMap((p) => [p.adj, p.raw]), ...(prop ? [prop.lo, prop.hi, prop.rate] : []), ...(adopted ? [adopted] : [])].filter((v) => v > 0);
  if (!vals.length) return <p className="sub">No rates to plot yet.</p>;
  const step = 1000;
  let min = Math.floor((Math.min(...vals) * 0.95) / step) * step;
  let max = Math.ceil((Math.max(...vals) * 1.05) / step) * step;
  if (max - min < 2 * step) { min -= step; max += step; }
  const W = 600, L = 16, R = 16, rowH = 18, top = 26;
  const H = top + Math.max(pts.length, 1) * rowH + 34;
  const x = (v: number) => L + ((v - min) / (max - min)) * (W - L - R);
  const ticks: number[] = [];
  const tstep = (max - min) / step > 8 ? step * 2 : step;
  for (let t = Math.ceil(min / tstep) * tstep; t <= max; t += tstep) ticks.push(t);
  const axisY = H - 24;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Comparable rates per sq.ft. built-up" style={{ display: 'block', fontFamily: 'var(--f-body)' }}>
      {prop && (
        <g>
          <rect x={x(prop.lo)} y={top - 8} width={Math.max(2, x(prop.hi) - x(prop.lo))} height={axisY - top + 8} fill="var(--stamp-soft)" />
          <text x={x(prop.lo) + 3} y={top - 12} fontSize="11" fill="var(--stamp)">Evidence-backed range</text>
        </g>
      )}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={top - 8} y2={axisY} stroke="var(--line)" strokeDasharray="2 3" />
          <text x={x(t)} y={axisY + 15} fontSize="11" textAnchor="middle" fill="var(--muted)">{inr(t)}</text>
        </g>
      ))}
      <line x1={L} x2={W - R} y1={axisY} y2={axisY} stroke="var(--line)" />
      {prop && (
        <g>
          <line x1={x(prop.rate)} x2={x(prop.rate)} y1={top - 8} y2={axisY} stroke="var(--stamp)" strokeWidth="2" />
          <text x={Math.min(x(prop.rate) + 4, W - 110)} y={axisY - 4} fontSize="11" fontWeight="600" fill="var(--stamp)">Proposed {inr(prop.rate)}</text>
        </g>
      )}
      {adopted && (!prop || Math.abs(adopted - prop.rate) > 1) && (
        <g>
          <line x1={x(adopted)} x2={x(adopted)} y1={top - 8} y2={axisY} stroke="var(--warn)" strokeWidth="2" strokeDasharray="5 4" />
          <text x={Math.min(x(adopted) + 4, W - 100)} y={top + 4} fontSize="11" fontWeight="600" fill="var(--warn)">Valuer: {inr(adopted)}</text>
        </g>
      )}
      {pts.map((p, i) => {
        const y = top + i * rowH + rowH / 2;
        const color = p.sale ? 'var(--ok)' : 'var(--muted)';
        return (
          <g key={p.id}>
            {Math.abs(p.raw - p.adj) > 1 && <line x1={x(p.raw)} x2={x(p.adj)} y1={y} y2={y} stroke={color} strokeDasharray="3 3" />}
            {Math.abs(p.raw - p.adj) > 1 && <circle cx={x(p.raw)} cy={y} r="2" fill={color} />}
            <circle cx={x(p.adj)} cy={y} r={p.subject ? 6 : 5} fill={p.used ? color : 'var(--surface)'} stroke={color} strokeWidth="1.5">
              <title>{`Rs. ${inr(p.adj)} adjusted (raw Rs. ${inr(p.raw)})${p.used ? '' : ' · not used'}`}</title>
            </circle>
          </g>
        );
      })}
    </svg>
  );
}
