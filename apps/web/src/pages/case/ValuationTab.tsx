// Valuation: the valuer adopts a rate (with a reason when it departs from the evidence), adds
// extras, sees a live preview, applies; the server computes the values with the bank's rules.
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { inr } from '@vm/shared';
import { Empty, Loading, Panel, Pending, fmtDate, useErrorToast, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { caseKey, type TabProps } from './context';

interface Extra { code: 'parking' | 'interior' | 'custom' | string; label: string; qty?: number; rate?: number; amount?: number }
interface Values { unit: number; parking: number; interior: number; others: number; fmv: number; realizable: number; distress: number; insurable: number | null; rent: number; lines: { label: string; working: string; amount: number }[] }
interface ValView {
  method: string; basis: string; basisArea: unknown;
  proposal: { rate: unknown; lo: unknown; hi: unknown } | null;
  guideline: unknown; agreement: unknown;
  rules: { realizable_pct: number; distress_pct: number; gv_variation_pct: number; rate_deviation_pct: number; building_cost_per_sqft: number; rental_yield_pct: number };
  current: { adopted_rate: unknown; reason: string | null; values: Values; extras: Extra[]; draft_version: number; created_at: string } | null;
  justification: { display: string | null; state: string; pendingLabel: string | null; edited: boolean };
  history: { id: number; adopted_rate: unknown; proposed_rate: unknown; reason: string | null; draft_version: number; created_at: string; by: string | null; fmv: number }[];
}
interface Custom { label: string; qty: string; rate: string }

const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const num = (s: string) => { const d = s.replace(/[^\d.]/g, ''); return d ? Number(d) : 0; };
const rs = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `Rs. ${inr(v)}`);
const pct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 1000) / 10)}%`;
const BASIS: Record<string, string> = { bua: 'Built-up area', carpet: 'Carpet area', plot: 'Plot area' };

export default function ValuationTab({ c, go, refresh, locked }: TabProps) {
  const { can } = useAuth();
  const toast = useToast();
  const err = useErrorToast();
  const q = useQuery({ queryKey: caseKey(c.id, 'valuation'), queryFn: () => api.get<ValView>(`/api/assignments/${c.id}/valuation`) });

  const [rate, setRate] = useState('');
  const [reason, setReason] = useState('');
  const [pkQty, setPkQty] = useState('');
  const [pkRate, setPkRate] = useState('');
  const [interior, setInterior] = useState('');
  const [custom, setCustom] = useState<Custom[]>([]);
  const [seeded, setSeeded] = useState<string | null>(null);

  // seed the form from the current valuation (or the proposal) once per server version
  useEffect(() => {
    const d = q.data;
    if (!d) return;
    const key = `${d.current?.draft_version ?? 0}:${n(d.proposal?.rate) ?? ''}`;
    if (seeded === key) return;
    setSeeded(key);
    const cur = d.current;
    setRate(String(n(cur?.adopted_rate) ?? n(d.proposal?.rate) ?? ''));
    setReason(cur?.reason ?? '');
    const ex = cur?.extras ?? [];
    const pk = ex.find((e) => e.code === 'parking');
    setPkQty(pk ? String(pk.qty ?? 1) : '');
    setPkRate(pk ? String(pk.rate ?? pk.amount ?? '') : '');
    const it = ex.find((e) => e.code === 'interior');
    setInterior(it ? String(it.amount ?? (it.qty ?? 1) * (it.rate ?? 0)) : '');
    setCustom(ex.filter((e) => e.code !== 'parking' && e.code !== 'interior').map((e) => ({ label: e.label, qty: String(e.qty ?? 1), rate: String(e.rate ?? e.amount ?? '') })));
  }, [q.data, seeded]);

  const apply = useMutation({
    mutationFn: (b: { rate: number; reason: string | null; extras: Extra[] }) => api.post<{ values: Values; draftVersion: number }>(`/api/assignments/${c.id}/valuation`, b),
    onSuccess: (r) => { toast(`Valuation applied: FMV Rs. ${inr(r.values.fmv)}. Draft v${r.draftVersion}.`); setSeeded(null); refresh(); },
    onError: err,
  });

  const d = q.data;
  const extras: Extra[] = useMemo(() => {
    const out: Extra[] = [];
    if (num(pkQty) > 0 && num(pkRate) > 0) out.push({ code: 'parking', label: 'Car parking', qty: num(pkQty), rate: num(pkRate) });
    if (num(interior) > 0) out.push({ code: 'interior', label: 'Interior decoration / furniture', amount: num(interior) });
    for (const cu of custom) if (cu.label.trim() && num(cu.rate) > 0) out.push({ code: 'custom', label: cu.label.trim(), qty: num(cu.qty) || 1, rate: num(cu.rate) });
    return out;
  }, [pkQty, pkRate, interior, custom]);

  if (q.isLoading) return <Loading />;
  if (!d) return <Empty title="Valuation could not be loaded" />;

  const area = n(d.basisArea);
  const prop = d.proposal ? { rate: n(d.proposal.rate)!, lo: n(d.proposal.lo), hi: n(d.proposal.hi) } : null;
  const gv = n(d.guideline);
  const agr = n(d.agreement);
  const r = d.rules;
  const cur = d.current;
  const canApply = can('val') && !locked;
  const rateN = num(rate);
  const diff = prop && rateN ? (rateN - prop.rate) / prop.rate : 0;
  const differs = !!prop && !!rateN && Math.abs(diff) > 0.001;
  const outside = !!prop && !!rateN && Math.abs(diff) * 100 > r.rate_deviation_pct;

  // live client-side preview (server rounding may differ slightly)
  const extrasTotal = extras.reduce((t, e) => t + (e.amount ?? (e.qty ?? 1) * (e.rate ?? 0)), 0);
  const pv = area && rateN ? (() => {
    const unit = area * rateN;
    const fmv = Math.round(unit + extrasTotal);
    return { unit, fmv, realizable: Math.round((fmv * r.realizable_pct) / 100), distress: Math.round((fmv * r.distress_pct) / 100), insurable: d.basis === 'bua' ? Math.round(area * r.building_cost_per_sqft) : null, rent: Math.round((fmv * r.rental_yield_pct) / 100 / 12 / 500) * 500 };
  })() : null;

  const submit = () => {
    if (!(rateN >= 100)) return toast('Enter a rate per sq.ft., for example 12800', 'err');
    if (!area) return toast('The area for valuation is not known yet', 'err');
    if (outside && !reason.trim()) return toast(`Record the reason: the rate is more than ${r.rate_deviation_pct}% away from the evidence-backed rate`, 'err');
    apply.mutate({ rate: rateN, reason: reason.trim() || null, extras });
  };

  const changed = !!cur && (rateN !== n(cur.adopted_rate) || (reason.trim() || null) !== (cur.reason || null) || JSON.stringify(extras) !== JSON.stringify(cur.extras ?? []));
  const sv = cur?.values;

  return (
    <div className="grid gap-4">
      {!prop && !cur && (
        <div className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div><b>Capture market evidence first</b><div className="sub">The evidence-backed rate and range come from the comparables on the Market evidence tab.</div></div>
          <button className="btn" onClick={() => go('mkt')}>Go to Market evidence</button>
        </div>
      )}

      <div className="split">
        <Panel title="Rate and extras">
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="kv">
                <div className="k">Basis</div>
                {area ? <div className="v">{inr(area)} sq.ft.</div> : <div className="mt-1"><Pending label="Area awaiting documents" /></div>}
                <div className="s">{BASIS[d.basis] ?? d.basis}{d.method !== 'market_comparison' ? ` · ${d.method.replace(/_/g, ' ')}` : ' · market comparison'}</div>
              </div>
              <div className="kv">
                <div className="k">Evidence-backed rate</div>
                {prop ? <div className="v">Rs. {inr(prop.rate)}</div> : <div className="mt-1"><Pending label="Awaiting market evidence" /></div>}
                {prop && prop.lo !== null && <div className="s">range Rs. {inr(prop.lo)} to {inr(prop.hi)}</div>}
              </div>
            </div>

            <div className="field">
              <label>Rate adopted, Rs. per sq.ft. {(BASIS[d.basis] ?? 'built-up').toLowerCase()}</label>
              <input className="mono" inputMode="numeric" value={rate} disabled={!canApply} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 12800" style={{ fontSize: 18 }} />
              {differs && (
                <div className={`hint ${outside && !reason.trim() ? 'text-crit' : ''}`}>
                  Adopted rate is {Math.abs(Math.round(diff * 1000) / 10)}% {diff > 0 ? 'above' : 'below'} the evidence-backed rate. {reason.trim() ? 'Reason recorded.' : outside ? 'Record the reason below.' : 'No reason recorded yet.'}
                </div>
              )}
            </div>
            <div className="field">
              <label>Reason, if different from the evidence-backed rate{outside ? ' (required)' : ' (optional)'}</label>
              <textarea rows={3} value={reason} disabled={!canApply} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Local broker enquiries put flats in this area at Rs. 14,000 to 16,000 per sq.ft. BUA; listings are in larger buildings." style={outside && !reason.trim() ? { borderColor: 'var(--crit)' } : undefined} />
            </div>

            <div>
              <div className="eyebrow mb-2">Extras</div>
              <div className="grid gap-3">
                <div className="grid grid-cols-[1fr_1fr] gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
                  <div className="col-span-2 self-end text-[13px] font-semibold sm:col-span-1">Car parking</div>
                  <div className="field"><label>Number</label><input className="mono" inputMode="numeric" value={pkQty} disabled={!canApply} onChange={(e) => setPkQty(e.target.value)} placeholder="0" /></div>
                  <div className="field"><label>Rs. each</label><input className="mono" inputMode="numeric" value={pkRate} disabled={!canApply} onChange={(e) => setPkRate(e.target.value)} placeholder="0" /></div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.4fr_2fr]">
                  <div className="self-end text-[13px] font-semibold">Interior decoration / furniture</div>
                  <div className="field"><label>Amount, Rs.</label><input className="mono" inputMode="numeric" value={interior} disabled={!canApply} onChange={(e) => setInterior(e.target.value)} placeholder="0" /></div>
                </div>
                {custom.map((cu, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-3 sm:grid-cols-[1.4fr_0.6fr_1fr_auto]">
                    <div className="field col-span-3 sm:col-span-1"><label>Item</label><input value={cu.label} disabled={!canApply} onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="e.g. Government charges" /></div>
                    <div className="field"><label>Qty</label><input className="mono" inputMode="numeric" value={cu.qty} disabled={!canApply} onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} /></div>
                    <div className="field"><label>Rs. each</label><input className="mono" inputMode="numeric" value={cu.rate} disabled={!canApply} onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} /></div>
                    <div className="self-end">{canApply && <button className="btn sm ghost" aria-label="Remove item" onClick={() => setCustom(custom.filter((_, j) => j !== i))}>Remove</button>}</div>
                  </div>
                ))}
                {canApply && <div><button className="btn sm ghost" onClick={() => setCustom([...custom, { label: '', qty: '1', rate: '' }])}>Add item</button></div>}
              </div>
            </div>

            {canApply ? (
              <div className="btns">
                <button className="btn pri" disabled={apply.isPending || (!!cur && !changed)} onClick={submit}>{apply.isPending ? <span className="dots">Applying</span> : cur ? 'Apply revised valuation' : 'Apply to report'}</button>
                {cur && !changed && <span className="sub">Applied in draft v{cur.draft_version} · {fmtDate(cur.created_at, true)}</span>}
              </div>
            ) : (
              <p className="sub m-0">{locked ? 'The report is signed and locked.' : 'Only the valuer can apply a valuation. Values below are read-only.'}</p>
            )}
          </div>
        </Panel>

        <div className="grid gap-4">
          {canApply && pv && (!cur || changed) && (
            <Panel title="Preview" right={<span className="sub">before applying · server rounding may differ</span>}>
              <table className="list">
                <tbody>
                  <Row label="Fair market value" working={`${inr(area)} × Rs. ${inr(rateN)}${extrasTotal ? ` + extras Rs. ${inr(extrasTotal)}` : ''}`} value={pv.fmv} strong />
                  <Row label={`Realizable · ${r.realizable_pct}%`} working={`FMV × ${r.realizable_pct}%`} value={pv.realizable} />
                  <Row label={`Distress · ${r.distress_pct}%`} working={`FMV × ${r.distress_pct}%`} value={pv.distress} />
                  <Row label="Insurable" working={`Rs. ${inr(r.building_cost_per_sqft)} × ${inr(area)} sq.ft.`} value={pv.insurable} />
                  <Row label="Rent p.m." working={`FMV × ${r.rental_yield_pct}% ÷ 12, nearest Rs. 500`} value={pv.rent} />
                </tbody>
              </table>
              {gv !== null && <Variation label="guideline value" fmv={pv.fmv} base={gv} limit={r.gv_variation_pct} />}
              {agr !== null && <Variation label="agreement value" fmv={pv.fmv} base={agr} />}
            </Panel>
          )}

          <Panel title="Values in the report" right={cur && <span className="sub">Rs. {inr(n(cur.adopted_rate))} per sq.ft. · draft v{cur.draft_version}</span>} pad={!sv}>
            {!sv ? <p className="sub m-0">No valuation applied yet. Values show as pending in the report until the valuer applies a rate.</p> : (
              <>
                <div className="tablewrap">
                  <table className="list">
                    <thead><tr><th>Value</th><th>Working</th><th className="text-right">Rs.</th></tr></thead>
                    <tbody>
                      {sv.lines.map((l, i) => <Row key={i} label={l.label} working={l.working.replace(/Rs\. (\d+)/g, (_, x) => `Rs. ${inr(Number(x))}`)} value={l.amount} />)}
                      <Row label="Fair market value" working={sv.lines.length > 1 ? 'Total of the above' : `${inr(area)} sq.ft. × Rs. ${inr(n(cur!.adopted_rate))}`} value={sv.fmv} strong />
                      <Row label={`Realizable · ${r.realizable_pct}%`} working={`FMV × ${r.realizable_pct}% (${c.bank_code} rule)`} value={sv.realizable} />
                      <Row label={`Distress · ${r.distress_pct}%`} working={`FMV × ${r.distress_pct}%`} value={sv.distress} />
                      <Row label="Guideline" working="As per Index II" value={gv} />
                      <Row label="Agreement" working="Consideration as per Index II" value={agr} />
                      <Row label="Insurable" working={`Building cost Rs. ${inr(r.building_cost_per_sqft)} × BUA`} value={sv.insurable} />
                      <Row label="Rent p.m." working={`FMV × ${r.rental_yield_pct}% a year ÷ 12, rounded`} value={sv.rent} />
                    </tbody>
                  </table>
                </div>
                <div className="px-4 pb-4">
                  {gv !== null && <Variation label="guideline value" fmv={sv.fmv} base={gv} limit={r.gv_variation_pct} />}
                  {agr !== null && <Variation label="agreement value" fmv={sv.fmv} base={agr} />}
                  {cur!.reason && <p className="sub mb-0 mt-2">Reason for rate: {cur!.reason}</p>}
                </div>
              </>
            )}
          </Panel>

          <Panel title={<div><div className="eyebrow">Draft justification{sv && gv ? ` · FMV is ${Math.abs(Math.round(((sv.fmv - gv) / gv) * 1000) / 10)}% ${sv.fmv >= gv ? 'above' : 'below'} guideline value` : ''}</div></div>}
            right={<button className="btn sm ghost" onClick={() => go('rep')}>Edit in report</button>}>
            {d.justification.state === 'filled' && d.justification.display
              ? <p className="m-0 font-report text-[14.5px] leading-relaxed">{d.justification.display}</p>
              : <Pending label={d.justification.pendingLabel ?? 'Awaiting valuation'} />}
            <p className="sub mb-0 mt-2">{d.justification.edited ? 'Edited in the report. ' : ''}The wording is edited in place on the Report & sign-off tab: click it in the draft.</p>
          </Panel>
        </div>
      </div>

      {d.history.length > 1 && (
        <Panel title="Earlier valuations" pad={false}>
          <div className="tablewrap">
            <table className="list">
              <thead><tr><th>When</th><th>By</th><th className="text-right">Rate</th><th className="text-right">FMV</th><th>Reason</th><th>Draft</th></tr></thead>
              <tbody>
                {d.history.map((h) => (
                  <tr key={h.id}><td className="whitespace-nowrap">{fmtDate(h.created_at, true)}</td><td>{h.by ?? '—'}</td><td className="n">{inr(n(h.adopted_rate))}</td><td className="n">{inr(n(h.fmv))}</td><td className="text-[12.5px]">{h.reason ?? '—'}</td><td>v{h.draft_version}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

function Row({ label, working, value, strong }: { label: string; working: string; value: number | null | undefined; strong?: boolean }) {
  return (
    <tr>
      <td className={strong ? 'font-semibold' : ''}>{label}</td>
      <td className="sub">{working}</td>
      <td className={`n mono ${strong ? 'font-semibold' : ''}`}>{value === null || value === undefined ? <span className="muted">—</span> : inr(value)}</td>
    </tr>
  );
}

function Variation({ label, fmv, base, limit }: { label: string; fmv: number; base: number; limit?: number }) {
  if (!base) return null;
  const v = (fmv - base) / base;
  const over = limit !== undefined && Math.abs(v) * 100 >= limit;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
      <span className={`sev ${over ? 'warn' : 'info'}`}>{pct(v)}</span>
      <span>FMV vs {label} ({rs(base)}){over ? ` · ${limit}% or more: the report carries a justification` : ''}</span>
    </div>
  );
}
