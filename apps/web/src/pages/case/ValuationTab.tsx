// Valuation: the valuer picks the area and unit the rate is quoted on, adopts a rate (with a reason
// when it departs from the evidence), adds extras, sees a live preview, applies; the server computes
// the values with the bank's rules.
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { inr } from '@vm/shared';
import { Empty, Field, Loading, Panel, Pending, fmtDate, useErrorToast, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { caseKey, type TabProps } from './context';

interface Extra { code: 'parking' | 'interior' | 'custom' | string; label: string; qty?: number; rate?: number; amount?: number }
interface Values { unit: number; parking: number; interior: number; others: number; fmv: number; realizable: number; distress: number; insurable: number | null; rent: number; lines: { label: string; working: string; amount: number }[] }
type Basis = 'carpet' | 'bua' | 'saleable' | 'measured' | 'plot';
type Unit = 'sqft' | 'sqm';
interface AreaOpt { key: Basis; label: string; sqft: number | null; how: 'stated' | 'rule' | 'site' | 'none'; src: string }
interface ValView {
  method: string; basis: Basis; unit: Unit; basisArea: unknown; choosesBasis: boolean;
  areas: AreaOpt[]; workedOutFrom: string | null; defaultBasis: { basis: Basis; unit: Unit; saved: boolean };
  proposal: { rate: unknown; lo: unknown; hi: unknown } | null;
  guideline: unknown; agreement: unknown;
  rules: { realizable_pct: number; distress_pct: number; gv_variation_pct: number; rate_deviation_pct: number; building_cost_per_sqft: number; rental_yield_pct: number; value_rounding_step: number; rent_rounding_step: number; loading_pct: number; saleable_factor: number };
  bua: unknown;
  current: { adopted_rate: unknown; reason: string | null; values: Values; extras: Extra[]; draft_version: number; created_at: string; basis: string; rate_unit: Unit } | null;
  parking: { count: number; text: string | null; source: string | null } | null;
  justification: { display: string | null; state: string; pendingLabel: string | null; edited: boolean };
  printedRange?: { lo: unknown; hi: unknown; edited: boolean };
  defaults?: Record<string, { value: number | null; origin: 'firm' | 'format' | 'case' }>;
  insurance?: { rate: number; label: string; floors: number | null; band: string | null };
  upperFloors?: { value: unknown; from: unknown };
  guidelineSource?: string | null;
  readyReckoner?: { rate: unknown; year: unknown; zone: unknown; property: unknown; snippet: string | null; fromGuideline: boolean } | null;
  rera?: { number: unknown; date: unknown; project: unknown; carpet: unknown };
  history: { id: number; adopted_rate: unknown; proposed_rate: unknown; reason: string | null; draft_version: number; created_at: string; by: string | null; fmv: number }[];
  locationNote?: { display: string | null; state: string; edited: boolean };
  work?: WorkView;
  rateFactors?: { label: string; avg: number; hint?: string }[];
}
interface WorkRow { key: string; label: string; weight: number; pct: number; note: string | null; weighted: number; per_floor: boolean }
interface WorkView {
  applies: boolean; pct: number | null; source: string | null; reason: string | null; rows: WorkRow[]; hasStages: boolean; stagesFrom: string | null;
  raw: number | null; worked: number | null; step: number; printPresent: boolean; presentValue: number | null;
}
interface Custom { label: string; qty: string; rate: string }
interface Factor { k: string; pct: string; note: string }

// why the adopted rate departs from the evidence: each factor with its figure, then any other note
const FACTORS = ['Floor / view', 'Condition / maintenance', 'Amenities', 'Recent sale nearby', 'Location within the locality', 'Size / layout'];
const sign = (x: number) => (x > 0 ? `+${x}` : x < 0 ? `−${Math.abs(x)}` : '0');
const pctOf = (s: string) => { const v = Number(s.replace('−', '-').replace(/[^\d.\-]/g, '')); return Number.isFinite(v) ? v : 0; };
function composeReason(fs: Factor[], note: string) {
  const parts = fs.filter((f) => f.k && pctOf(f.pct)).map((f) => `${f.k} ${sign(pctOf(f.pct))}%${f.note.trim() ? ` (${f.note.trim()})` : ''}`);
  const t = note.trim();
  return [parts.join('; '), t].filter(Boolean).join(parts.length && t ? '. ' : '') || '';
}
function parseReason(r: string | null, names: string[] = FACTORS): { fs: Factor[]; note: string } {
  if (!r) return { fs: [], note: '' };
  const fs: Factor[] = [];
  let rest = r;
  // longest names first, so "Interior & internal condition" is not cut at a shorter name
  const alt = [...new Set([...names, ...FACTORS])].sort((a, b) => b.length - a.length).map((f) => f.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|');
  const re = new RegExp(`^(${alt}) ([+−-]?[\\d.]+)%(?: \\(([^)]*)\\))?(?:; |\\. |$)`);
  for (let m = rest.match(re); m; m = rest.match(re)) { fs.push({ k: m[1], pct: m[2].replace('−', '-'), note: m[3] ?? '' }); rest = rest.slice(m[0].length); }
  return { fs, note: rest };
}

const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const num = (s: string) => { const d = s.replace(/[^\d.]/g, ''); return d ? Number(d) : 0; };
const roundTo = (x: number, step: number) => Math.round(x / (step || 1)) * (step || 1);
const rs = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `Rs. ${inr(v)}`);
const pct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 1000) / 10)}%`;
const SQM = 10.7639104;
const UL: Record<Unit, string> = { sqft: 'sq.ft.', sqm: 'sq.m.' };
const TAG: Record<AreaOpt['how'], [string, string] | null> = { stated: ['Stated', 'ok'], rule: ['Worked out', 'info'], site: ['Measured', 'warn'], none: null };
const inUnit = (sqft: number, u: Unit) => (u === 'sqm' ? Math.round((sqft / SQM) * 100) / 100 : sqft);
const fmtArea = (x: number, u: Unit) => (u === 'sqm' ? x.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : inr(x));

export default function ValuationTab({ c, go, refresh, locked }: TabProps) {
  const { can } = useAuth();
  const toast = useToast();
  const err = useErrorToast();
  const q = useQuery({ queryKey: caseKey(c.id, 'valuation'), queryFn: () => api.get<ValView>(`/api/assignments/${c.id}/valuation`) });

  const [rate, setRate] = useState('');
  const [factors, setFactors] = useState<Factor[]>([]);
  const [note, setNote] = useState('');
  const reason = composeReason(factors, note);
  const [pkQty, setPkQty] = useState('');
  const [pkRate, setPkRate] = useState('');
  const [interior, setInterior] = useState('');
  const [custom, setCustom] = useState<Custom[]>([]);
  const [basis, setBasis] = useState<Basis>('bua');
  const [unit, setUnit] = useState<Unit>('sqft');
  const [saveDefault, setSaveDefault] = useState(false);
  const [seeded, setSeeded] = useState<string | null>(null);

  // seed the form from the current valuation (or the proposal) once per server version
  useEffect(() => {
    const d = q.data;
    if (!d) return;
    const key = `${d.current?.draft_version ?? 0}:${n(d.proposal?.rate) ?? ''}`;
    if (seeded === key) return;
    setSeeded(key);
    const cur = d.current;
    setBasis(d.basis);
    setUnit(d.unit);
    setSaveDefault(false);
    const opt = d.areas.find((x) => x.key === d.basis);
    const bua0 = n(d.bua);
    // evidence is per sq.ft. built-up: convert it to the chosen area and unit
    const ev = n(d.proposal?.rate) !== null && opt?.sqft && bua0 ? Math.round((n(d.proposal!.rate)! * bua0 / inUnit(opt.sqft, d.unit)) / 100) * 100 : n(d.proposal?.rate);
    setRate(String(n(cur?.adopted_rate) ?? ev ?? ''));
    const pr = parseReason(cur?.reason ?? null, (d.rateFactors ?? []).map((f) => f.label));
    setFactors(pr.fs);
    setNote(pr.note);
    const ex = cur?.extras ?? [];
    const pk = ex.find((e) => e.code === 'parking');
    // no valuation yet: the parking count read from the documents
    setPkQty(pk ? String(pk.qty ?? 1) : !cur && d.parking?.count ? String(d.parking.count) : '');
    setPkRate(pk ? String(pk.rate ?? pk.amount ?? '') : '');
    const it = ex.find((e) => e.code === 'interior');
    setInterior(it ? String(it.amount ?? (it.qty ?? 1) * (it.rate ?? 0)) : '');
    setCustom(ex.filter((e) => e.code !== 'parking' && e.code !== 'interior').map((e) => ({ label: e.label, qty: String(e.qty ?? 1), rate: String(e.rate ?? e.amount ?? '') })));
  }, [q.data, seeded]);

  const apply = useMutation({
    mutationFn: (b: { rate: number; reason: string | null; extras: Extra[]; basis?: Basis; unit?: Unit; saveDefault?: boolean }) => api.post<{ values: Values; draftVersion: number }>(`/api/assignments/${c.id}/valuation`, b),
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

  const opt = d.areas.find((x) => x.key === basis) ?? null;
  const area = d.choosesBasis ? (opt?.sqft ? inUnit(opt.sqft, unit) : null) : n(d.basisArea);
  const ul = UL[d.choosesBasis ? unit : 'sqft'];
  const prop = d.proposal ? { rate: n(d.proposal.rate)!, lo: n(d.proposal.lo), hi: n(d.proposal.hi) } : null;
  const bua = n(d.bua);
  // evidence-backed rate (per sq.ft. built-up) converted to the chosen area and unit
  const factor = area && bua ? bua / area : 1;
  const evRate = prop ? Math.round((prop.rate * factor) / 100) * 100 : null;
  const gv = n(d.guideline);
  const agr = n(d.agreement);
  const r = d.rules;
  const cur = d.current;
  const canApply = can('val') && !locked;
  const rateN = num(rate);
  // compare like with like: the adopted rate as its equivalent per sq.ft. built-up
  const rateBua = rateN && area && bua ? (area * rateN) / bua : rateN;
  const diff = prop && rateN ? (rateBua - prop.rate) / prop.rate : 0;
  const differs = !!prop && !!rateN && Math.abs(diff) > 0.001;
  const outside = !!prop && !!rateN && Math.abs(diff) * 100 > r.rate_deviation_pct;
  const factorSum = factors.reduce((t, f) => t + (f.k ? pctOf(f.pct) : 0), 0);
  // the firm's rate analysis sheet for this property type: factors with their usual % and what to look at
  const sheet = d.rateFactors?.length ? d.rateFactors : FACTORS.map((label) => ({ label, avg: 0, hint: undefined as string | undefined }));
  const factorNames = sheet.map((f) => f.label);
  const sheetOf = (k: string) => sheet.find((f) => f.label === k);
  // base rate (the evidence-backed rate on the chosen area) with the factors applied
  const analysed = evRate && factors.some((f) => f.k && pctOf(f.pct)) ? Math.round((evRate * (1 + factorSum / 100)) / 100) * 100 : null;
  const explained = factors.some((f) => f.k && pctOf(f.pct)) || note.trim().length >= 15;

  // insurance: the rate the server will use (the band for the building's upper floors, or this case's own rate)
  const insRate = d.insurance?.rate ?? r.building_cost_per_sqft;
  // live preview with the same rules and rounding steps the server applies
  const extrasTotal = extras.reduce((t, e) => t + (e.amount ?? (e.qty ?? 1) * (e.rate ?? 0)), 0);
  const step = r.value_rounding_step || 1;
  const pv = area && rateN ? (() => {
    const unit = area * rateN;
    const fmv = roundTo(unit + extrasTotal, step);
    return { unit, fmv, realizable: roundTo((fmv * r.realizable_pct) / 100, step), distress: roundTo((fmv * r.distress_pct) / 100, step), insurable: bua ? roundTo(bua * insRate, step) : null, rent: roundTo((fmv * r.rental_yield_pct) / 100 / 12, r.rent_rounding_step) };
  })() : null;
  const roundingNote = `values to the nearest Rs. ${inr(step)}, rent to the nearest Rs. ${inr(r.rent_rounding_step || 1)} (${c.bank_code} rule)`;

  const submit = () => {
    if (!(rateN > 0)) return toast(`Enter the rate per ${ul}, for example ${unit === 'sqm' ? '137800' : '12800'}`, 'err');
    if (!area) return toast(`The ${(opt?.label ?? 'area for valuation').toLowerCase()} is not known yet`, 'err');
    if (outside && !explained) return toast(`Record the reason: the rate is more than ${r.rate_deviation_pct}% away from the evidence-backed rate. Add the factors with their figures, or a note of at least 15 characters.`, 'err');
    apply.mutate({ rate: rateN, reason: reason.trim() || null, extras, ...(d.choosesBasis ? { basis, unit, saveDefault } : {}) });
  };

  /** Switching the area or unit keeps the value: the rate is converted to the new basis. */
  const choose = (b: Basis, u: Unit) => {
    const next = d.areas.find((x) => x.key === b);
    if (!next?.sqft) return;
    if (area && rateN) setRate(String(Math.round((area * rateN) / inUnit(next.sqft, u))));
    setBasis(b);
    setUnit(u);
  };

  const changed = !!cur && (rateN !== n(cur.adopted_rate) || (reason.trim() || null) !== (cur.reason || null) || JSON.stringify(extras) !== JSON.stringify(cur.extras ?? [])
    || (d.choosesBasis && (basis !== cur.basis || unit !== cur.rate_unit)) || saveDefault);
  const ptype = c.property_type.replace(/_/g, ' ');
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
                {area ? <div className="v">{fmtArea(area, unit)} {ul}</div> : <div className="mt-1"><Pending label="Area awaiting documents" /></div>}
                <div className="s">{opt?.label ?? 'Area'}{d.method !== 'market_comparison' ? ` · ${d.method.replace(/_/g, ' ')}` : ' · market comparison'}</div>
              </div>
              <div className="kv">
                <div className="k">Evidence-backed rate</div>
                {prop ? <div className="v">Rs. {inr(evRate)} <span className="text-[13px] font-normal">per {ul}</span></div> : <div className="mt-1"><Pending label="Awaiting market evidence" /></div>}
                {prop && (basis !== 'bua' || unit !== 'sqft'
                  ? <div className="s">Rs. {inr(prop.rate)} per sq.ft. built-up{basis !== 'bua' && opt?.sqft && bua ? `, × ${(bua / opt.sqft).toFixed(3)} for ${opt?.label.toLowerCase()}` : ''}{unit === 'sqm' ? ', × 10.7639 for sq.m.' : ''}</div>
                  : prop.lo !== null && <div className="s">range Rs. {inr(prop.lo)} to {inr(prop.hi)}</div>)}
              </div>
            </div>

            {d.choosesBasis && d.method === 'market_comparison' && (
              <div>
                <div className="eyebrow mb-1">Area used for valuation</div>
                <p className="sub mb-2 mt-0">One stated area is enough: the others are worked out by {c.bank_code}'s rule (built-up = carpet × {(1 + (r.loading_pct ?? 0) / 100).toFixed(2)}, saleable = carpet × {r.saleable_factor}). A stated figure always wins. Pick the area the rate is quoted on.</p>
                <div className="grid gap-1.5" role="radiogroup" aria-label="Area used for valuation">
                  {d.areas.map((a) => {
                    const tag = TAG[a.how];
                    const off = !a.sqft || !canApply;
                    return (
                      <label key={a.key} className={`flex items-start gap-2.5 rounded-md border px-3 py-2 ${basis === a.key ? 'border-stamp bg-stamp-soft' : 'border-line'} ${off ? 'opacity-60' : 'cursor-pointer'}`}>
                        <input type="radio" name="basis" className="mt-1" checked={basis === a.key} disabled={off} onChange={() => choose(a.key, unit)} />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium">{a.label}{tag && <span className={`sev ${tag[1]}`}>{tag[0]}</span>}</span>
                          <span className="sub block text-[12px]">{a.src}</span>
                        </span>
                        <span className="mono whitespace-nowrap text-[13px]">{a.sqft ? `${fmtArea(inUnit(a.sqft, unit), unit)} ${UL[unit]}` : '—'}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex gap-1" role="group" aria-label="Rate unit">
                    {(['sqft', 'sqm'] as Unit[]).map((u) => <button key={u} type="button" className={`btn sm ${unit === u ? 'pri' : 'ghost'}`} disabled={!canApply} aria-pressed={unit === u} onClick={() => choose(basis, u)}>per {UL[u]}</button>)}
                  </div>
                  {canApply && (
                    <label className="flex items-center gap-2 text-[13px]">
                      <input type="checkbox" checked={saveDefault} onChange={(e) => setSaveDefault(e.target.checked)} />
                      Use this basis by default for {c.bank_code} {ptype}s
                    </label>
                  )}
                </div>
                {d.defaultBasis.saved && <div className="sub mt-1 text-[12px]">Default for {c.bank_code} {ptype}s: {d.areas.find((x) => x.key === d.defaultBasis.basis)?.label.toLowerCase()}, per {UL[d.defaultBasis.unit]}.</div>}
              </div>
            )}

            <div className="field">
              <label>Rate adopted, Rs. per {ul} of {(opt?.label ?? 'built-up area').toLowerCase()}</label>
              <input className="mono" inputMode="numeric" value={rate} disabled={!canApply} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 12800" style={{ fontSize: 18 }} />
              {differs && (
                <div className={`hint ${outside && !explained ? 'text-crit' : ''}`}>
                  Adopted rate is {Math.abs(Math.round(diff * 1000) / 10)}% {diff > 0 ? 'above' : 'below'} the evidence-backed rate{basis !== 'bua' || unit !== 'sqft' ? ` (Rs. ${inr(Math.round(rateBua))} per sq.ft. built-up)` : ''}. {explained ? 'Reason recorded.' : outside ? 'Record the reason below.' : 'No reason recorded yet.'}
                </div>
              )}
            </div>
            <div className="grid gap-2">
              <div className="text-[13px] font-semibold">Reason, if different from the evidence-backed rate{outside ? ' (required)' : ' (optional)'}</div>
              {factors.map((f, i) => (
                <div key={i} className="grid grid-cols-[1fr_80px_auto] gap-2 sm:grid-cols-[1.2fr_80px_1.4fr_auto]">
                  <select value={f.k} disabled={!canApply} aria-label="Factor" title={sheetOf(f.k)?.hint} onChange={(e) => setFactors(factors.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))}>
                    {[...new Set([...factorNames, f.k])].map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                  <input className="mono" inputMode="decimal" value={f.pct} disabled={!canApply} aria-label="Effect on the rate, %" placeholder={sheetOf(f.k)?.avg ? `usual ${sign(sheetOf(f.k)!.avg)}%` : '+5 %'} onChange={(e) => setFactors(factors.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} />
                  <input className="col-span-3 sm:col-span-1" value={f.note} disabled={!canApply} aria-label="Details" placeholder={sheetOf(f.k)?.hint ?? 'e.g. 8th floor, open creek view'} onChange={(e) => setFactors(factors.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />
                  {canApply && <button className="btn sm ghost row-start-1 col-start-3 sm:col-start-4" aria-label="Remove factor" onClick={() => setFactors(factors.filter((_, j) => j !== i))}>Remove</button>}
                </div>
              ))}
              {canApply && (
                <div className="btns">
                  <button className="btn sm ghost" onClick={() => setFactors([...factors, { k: factorNames.find((k) => !factors.some((f) => f.k === k)) ?? factorNames[0], pct: '', note: '' }])}>Add a factor</button>
                  {!!d.rateFactors?.length && factors.length < factorNames.length && <button className="btn sm ghost" title="Every factor of the firm's rate analysis sheet, to fill in the ones that apply" onClick={() => setFactors([...factors, ...factorNames.filter((k) => !factors.some((f) => f.k === k)).map((k) => ({ k, pct: '', note: '' }))])}>Open the rate analysis sheet</button>}
                </div>
              )}
              {analysed !== null && evRate !== null && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-line px-3 py-2 text-[13px]">
                  <span>Rate analysis: base Rs. {inr(evRate)} {sign(Math.round(factorSum * 10) / 10)}% = <b>Rs. {inr(analysed)}</b> per {ul}</span>
                  {canApply && analysed !== rateN && <button className="btn sm" onClick={() => setRate(String(analysed))}>Use Rs. {inr(analysed)}</button>}
                </div>
              )}
              {differs && factors.length > 0 && (
                <div className="sub text-[12.5px]">Factors add up to {sign(Math.round(factorSum * 10) / 10)}% against a gap of {sign(Math.round(diff * 1000) / 10)}% from the evidence.</div>
              )}
              <textarea rows={2} value={note} disabled={!canApply} onChange={(e) => setNote(e.target.value)} aria-label="Other reason" placeholder="Anything else, e.g. local broker enquiries put flats here at Rs. 14,000 to 16,000 per sq.ft. built-up." style={outside && !explained ? { borderColor: 'var(--crit)' } : undefined} />
            </div>

            <div>
              <div className="eyebrow mb-2">Extras</div>
              <div className="grid gap-3">
                <div className="grid grid-cols-[1fr_1fr] gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
                  <div className="col-span-2 self-end text-[13px] font-semibold sm:col-span-1">Car parking{d.parking && <div className="sub font-normal">{d.parking.count} as per {(d.parking.source ?? 'documents').replace(/_/g, ' ')}{d.parking.text ? `: ${d.parking.text}` : ''}</div>}</div>
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
            <Panel title="Preview" right={<span className="sub">before applying · {roundingNote}</span>}>
              <table className="list">
                <tbody>
                  <Row label="Fair market value" working={`${fmtArea(area!, unit)} ${ul} × Rs. ${inr(rateN)}${extrasTotal ? ` + extras Rs. ${inr(extrasTotal)}` : ''}`} value={pv.fmv} strong />
                  <Row label={`Realizable · ${r.realizable_pct}%`} working={`FMV × ${r.realizable_pct}%`} value={pv.realizable} />
                  <Row label={`Distress · ${r.distress_pct}%`} working={`FMV × ${r.distress_pct}%`} value={pv.distress} />
                  <Row label="Insurable" working={`Rs. ${inr(insRate)} (${d.insurance?.label ?? 'building cost'}) × BUA ${inr(bua)} sq.ft.`} value={pv.insurable} />
                  <Row label="Rent p.m." working={`FMV × ${r.rental_yield_pct}% a year ÷ 12, nearest Rs. ${inr(r.rent_rounding_step || 1)}`} value={pv.rent} />
                </tbody>
              </table>
              {gv !== null && <Variation label="guideline value" fmv={pv.fmv} base={gv} limit={r.gv_variation_pct} />}
              {agr !== null && <Variation label="agreement value" fmv={pv.fmv} base={agr} />}
              {d.choosesBasis && opt && (
                <p className="sub mb-0 mt-3 border-t border-line pt-3">
                  Prints in the report as: <b>{opt.label} {fmtArea(area!, unit)} {ul} × Rs. {inr(rateN)}/- per {ul} = Rs. {inr(roundTo(pv.unit, step))}/-</b>
                  {opt.how === 'rule' && <> with the note “(worked out from the {d.workedOutFrom ?? 'stated area'} as per bank norms)”</>}
                  {bua && basis !== 'bua' ? <> · equivalent Rs. {inr(Math.round(pv.unit / bua))} per sq.ft. built-up</> : null}
                </p>
              )}
            </Panel>
          )}

          <Panel title="Values in the report" right={cur && <span className="sub">Rs. {inr(n(cur.adopted_rate))} per {UL[cur.rate_unit ?? 'sqft']} · draft v{cur.draft_version}</span>} pad={!sv}>
            {!sv ? <p className="sub m-0">No valuation applied yet. Values show as pending in the report until the valuer applies a rate.</p> : (
              <>
                <div className="tablewrap">
                  <table className="list">
                    <thead><tr><th>Value</th><th>Working</th><th className="text-right">Rs.</th></tr></thead>
                    <tbody>
                      {sv.lines.map((l, i) => <Row key={i} label={l.label} working={l.working.replace(/Rs\. (\d+)/g, (_, x) => `Rs. ${inr(Number(x))}`)} value={l.amount} />)}
                      <Row label="Fair market value" working={sv.lines.length > 1 ? 'Total of the above' : sv.lines[0]?.working ?? ''} value={sv.fmv} strong />
                      <Row label={`Realizable · ${r.realizable_pct}%`} working={`FMV × ${r.realizable_pct}% (${c.bank_code} rule)`} value={sv.realizable} />
                      <Row label={`Distress · ${r.distress_pct}%`} working={`FMV × ${r.distress_pct}%`} value={sv.distress} />
                      <Row label="Guideline" working={d.guidelineSource ?? 'As per Index II'} value={gv} />
                      <Row label="Agreement" working="Consideration as per Index II" value={agr} />
                      <Row label="Insurable" working={`Rs. ${inr(d.insurance?.rate ?? r.building_cost_per_sqft)} per sq.ft. (${d.insurance?.label ?? 'building cost'}) × built-up area`} value={sv.insurable} />
                      <Row label="Rent p.m." working={`FMV × ${r.rental_yield_pct}% a year ÷ 12, nearest Rs. ${inr(r.rent_rounding_step || 1)}`} value={sv.rent} />
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

          {d.work?.applies && <WorkDone c={c} w={d.work} refresh={refresh} locked={locked} />}

          <CaseDefaults c={c} d={d} refresh={refresh} locked={locked} />

          <PrintedRange c={c} d={d} rate={n(cur?.adopted_rate)} refresh={refresh} locked={locked} />

          <Panel title={<div><div className="eyebrow">Justification as printed{sv && gv ? ` · FMV is ${Math.abs(Math.round(((sv.fmv - gv) / gv) * 1000) / 10)}% ${sv.fmv >= gv ? 'above' : 'below'} guideline value` : ''}</div></div>}
            right={<button className="btn sm ghost" onClick={() => go('rep')}>Edit in report</button>}>
            {d.justification.state === 'filled' && d.justification.display
              ? <p className="m-0 font-report text-[14.5px] leading-relaxed">{d.justification.display}</p>
              : <Pending label={d.justification.pendingLabel ?? 'Awaiting valuation'} />}
            <p className="sub mb-0 mt-2">{d.justification.edited ? 'Your wording, printed as written. ' : 'The firm\'s standard wording, printed as is. '}Change it here or by clicking it in the draft on the Report & sign-off tab.</p>
            <TextEdit c={c} code="VAL.JUSTIFICATION" label="Justification" value={d.justification.display} edited={d.justification.edited} refresh={refresh} locked={locked} />
            {d.locationNote && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="eyebrow mb-1">Location sentence printed after it</div>
                {d.locationNote.display ? <p className="m-0 font-report text-[14.5px] leading-relaxed">{d.locationNote.display}</p> : <Pending label="Awaiting site visit" />}
                <p className="sub mb-0 mt-2">{d.locationNote.edited ? 'Your wording, printed as written.' : 'Built from the nearest station and its distance on the site sheet.'}</p>
                <TextEdit c={c} code="VAL.LOCATION_NOTE" label="Location sentence" value={d.locationNote.display} edited={d.locationNote.edited} refresh={refresh} locked={locked} />
              </div>
            )}
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

const DEFAULT_ROWS: [string, string, string][] = [
  ['realizable_pct', 'Realizable value', '% of FMV'], ['distress_pct', 'Distress value', '% of FMV'],
  ['loading_pct', 'Built-up / plinth', '% over carpet'], ['saleable_factor', 'Saleable', '× carpet'], ['insurance_rate', 'Insurance rate', 'Rs. per sq.ft. built-up'],
];
const ORIGIN: Record<string, string> = { firm: 'firm rule for the bank', format: "report format's default", case: 'changed for this case' };

/** The bank's defaults as they apply to this case, changeable here with a reason (A6, A7, A8). */
function CaseDefaults({ c, d, refresh, locked }: { c: TabProps['c']; d: ValView; refresh: () => void; locked: boolean }) {
  const { can } = useAuth();
  const toast = useToast();
  const onErr = useErrorToast();
  const [edit, setEdit] = useState<Record<string, string> | null>(null);
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => api.patch(`/api/assignments/${c.id}/case-rules`, { rules: Object.fromEntries(Object.entries(edit!).map(([k, v]) => [k, v.trim() === '' ? null : Number(v)])), reason }),
    onSuccess: () => { toast('Defaults changed for this case; values worked out again'); setEdit(null); setReason(''); refresh(); },
    onError: onErr,
  });
  if (!d.defaults) return null;
  const may = can('case_rules') && !locked;
  const rr = d.readyReckoner;
  return (
    <Panel title="Bank defaults for this case" right={may && !edit && <button className="btn sm ghost" onClick={() => setEdit(Object.fromEntries(DEFAULT_ROWS.map(([k]) => [k, d.defaults![k]?.origin === 'case' ? String(d.defaults![k].value ?? '') : ''])))}>Change for this case</button>}>
      <table className="list"><tbody>
        {DEFAULT_ROWS.map(([k, label, unit]) => {
          const x = d.defaults![k];
          return (
            <tr key={k}>
              <td>{label}</td>
              <td className="text-right mono">{edit ? <input className="inp text-right" style={{ maxWidth: 110 }} inputMode="decimal" placeholder={x?.origin === 'case' ? '' : String(x?.value ?? '')} value={edit[k] ?? ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /> : (x?.value ?? '—')}</td>
              <td className="sub">{unit}{x ? ` · ${k === 'insurance_rate' && x.origin !== 'case' ? d.insurance?.label ?? '' : ORIGIN[x.origin]}` : ''}</td>
            </tr>
          );
        })}
      </tbody></table>
      {d.upperFloors?.from != null && <p className="sub mb-0 mt-2">Building: {String(d.upperFloors.from)} → {d.upperFloors.value != null ? `${d.upperFloors.value} upper floors` : 'upper floors not known'} (podiums and stilts do not count). Correct "Upper floors of the building" on Extracted details if needed.</p>}
      {rr && <p className="sub mb-0 mt-2">Ready reckoner: Rs. {inr(Number(rr.rate))}/sq.m.{rr.year ? ` · ${String(rr.year)}` : ''}{rr.zone ? ` · zone ${String(rr.zone)}` : ''}{rr.property ? ` · ${String(rr.property)}` : ''}{rr.fromGuideline ? ' · used for the guideline value (no value in Index II): rate × carpet (sq.m.) × 1.1' : ''}</p>}
      {d.rera && <p className="sub mb-0 mt-2">RERA: {d.rera.number ? `${String(d.rera.number)}${d.rera.date ? ` dated ${String(d.rera.date)}` : ''}${d.rera.project ? ` · ${String(d.rera.project)}` : ''}${d.rera.carpet ? ` · RERA carpet ${String(d.rera.carpet)} sq.ft.` : ''}` : 'Not applicable (no registration found)'}</p>}
      {edit && (
        <div className="mt-3 grid gap-2">
          <p className="sub m-0">Leave a box empty to use the default. The change is logged and an applied valuation is worked out again with the same rate.</p>
          <Field label="Reason (required)"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Branch asked for 95% realizable on this case" /></Field>
          <div className="btns"><button className="btn pri sm" disabled={reason.trim().length < 5 || save.isPending} onClick={() => save.mutate()}>Save for this case</button><button className="btn ghost sm" onClick={() => setEdit(null)}>Cancel</button></div>
        </div>
      )}
    </Panel>
  );
}

/** The "rates in the nearby area" range the report prints (#1): worked out from the comparables and widened to take in
 *  the adopted rate, or the valuer's own figures. A Check warns when the adopted rate falls outside it. */
function PrintedRange({ c, d, rate, refresh, locked }: { c: TabProps['c']; d: ValView; rate: number | null; refresh: () => void; locked: boolean }) {
  const { can } = useAuth();
  const toast = useToast();
  const onErr = useErrorToast();
  const [edit, setEdit] = useState<{ lo: string; hi: string } | null>(null);
  const pr = d.printedRange;
  const put = async (lo: string | null, hi: string | null, reason: string) => {
    await api.put(`/api/assignments/${c.id}/fields/VAL.EVIDENCE_LO`, { value: lo, reason });
    await api.put(`/api/assignments/${c.id}/fields/VAL.EVIDENCE_HI`, { value: hi, reason });
  };
  const save = useMutation({
    mutationFn: () => put(String(num(edit!.lo)), String(num(edit!.hi)), 'Range entered on the Valuation tab'),
    onSuccess: () => { toast('Printed range saved'); setEdit(null); refresh(); },
    onError: onErr,
  });
  const reset = useMutation({
    mutationFn: () => put(null, null, 'Range worked out from the comparables again'),
    onSuccess: () => { toast('Range worked out from the comparables'); refresh(); },
    onError: onErr,
  });
  if (!pr) return null;
  const lo = n(pr.lo), hi = n(pr.hi);
  const unit = d.unit === 'sqm' ? 'sq.m.' : 'sq.ft.';
  const outside = rate !== null && lo !== null && hi !== null && (rate < lo || rate > hi);
  const may = can('val') && !locked;
  const bad = edit && (!num(edit.lo) || !num(edit.hi) || num(edit.lo) > num(edit.hi));
  return (
    <Panel title={<div className="eyebrow">Rates in the nearby area, as printed</div>}
      right={may && !edit && lo !== null && <button className="btn sm ghost" onClick={() => setEdit({ lo: String(lo), hi: String(hi ?? '') })}>Change</button>}>
      {lo === null || hi === null
        ? <Pending label="Awaiting market evidence" />
        : !edit && <p className="m-0">Rs. {inr(lo)} to Rs. {inr(hi)} per {unit}{rate !== null ? ` · adopted Rs. ${inr(rate)}` : ''}</p>}
      {outside && <p className="mb-0 mt-2 text-[13px]" style={{ color: "var(--crit)" }}>The adopted rate is outside this range. A bank reviewer will question it: change the range so it takes in the adopted rate.</p>}
      {edit && (
        <div className="mt-1 grid gap-2">
          <div className="flex flex-wrap items-end gap-2">
            <Field label={`From, Rs. per ${unit}`}><input className="inp" inputMode="numeric" value={edit.lo} onChange={(e) => setEdit({ ...edit, lo: e.target.value })} /></Field>
            <Field label={`To, Rs. per ${unit}`}><input className="inp" inputMode="numeric" value={edit.hi} onChange={(e) => setEdit({ ...edit, hi: e.target.value })} /></Field>
          </div>
          <div className="btns"><button className="btn pri sm" disabled={!!bad || save.isPending} onClick={() => save.mutate()}>Save range</button><button className="btn ghost sm" onClick={() => setEdit(null)}>Cancel</button></div>
        </div>
      )}
      <p className="sub mb-0 mt-2">{pr.edited ? 'Entered by the valuer. ' : 'Worked out from the comparables, widened to take in the adopted rate. '}
        {pr.edited && may && <button className="linkbtn" disabled={reset.isPending} onClick={() => reset.mutate()}>Work it out from the comparables again</button>}</p>
    </Panel>
  );
}

/** Change a sentence the report prints (justification, location) in one place; the report's click-to-edit saves the same field. */
function TextEdit({ c, code, label, value, edited, refresh, locked }: { c: TabProps['c']; code: string; label: string; value: string | null; edited: boolean; refresh: () => void; locked: boolean }) {
  const { can } = useAuth();
  const toast = useToast();
  const onErr = useErrorToast();
  const [draft, setDraft] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (v: string | null) => api.put(`/api/assignments/${c.id}/fields/${code}`, { value: v, reason: v === null ? 'Back to the standard wording' : 'Edited on the Valuation tab' }),
    onSuccess: (_r, v) => { toast(v === null ? `${label}: standard wording again` : `${label} saved; draft updated`); setDraft(null); refresh(); },
    onError: onErr,
  });
  if (!can('val') || locked) return null;
  if (draft === null) return (
    <div className="btns mt-2">
      <button className="btn sm ghost" onClick={() => setDraft(value ?? '')}>Edit</button>
      {edited && <button className="linkbtn" disabled={save.isPending} onClick={() => save.mutate(null)}>Use the standard wording</button>}
    </div>
  );
  return (
    <div className="mt-2 grid gap-2">
      <textarea rows={4} autoFocus value={draft} aria-label={label} onChange={(e) => setDraft(e.target.value)} />
      <div className="btns"><button className="btn pri sm" disabled={!draft.trim() || save.isPending} onClick={() => save.mutate(draft.trim())}>Save</button><button className="btn ghost sm" onClick={() => setDraft(null)}>Cancel</button></div>
    </div>
  );
}

/** A building under construction: the % of work completed worked out from the stage of each activity with the firm's
 *  weightage table, the working activity by activity, the valuer's own figure with a reason, and whether the value as
 *  per work completed prints in the report (off unless switched on). */
function WorkDone({ c, w, refresh, locked }: { c: TabProps['c']; w: WorkView; refresh: () => void; locked: boolean }) {
  const { can } = useAuth();
  const toast = useToast();
  const onErr = useErrorToast();
  const [open, setOpen] = useState(!w.hasStages);
  const [stages, setStages] = useState<Record<string, string> | null>(null);
  const [own, setOwn] = useState<{ pct: string; reason: string } | null>(null);
  const may = can('edit') && !locked;
  const put = (code: string, value: string | null, reason: string) => api.put(`/api/assignments/${c.id}/fields/${code}`, { value, reason });
  const done = (msg: string) => () => { toast(msg); setStages(null); setOwn(null); refresh(); };
  const saveStages = useMutation({
    mutationFn: () => put('PHYS.WORK_STAGES', JSON.stringify(w.rows.map((r) => ({ key: r.key, pct: Math.max(0, Math.min(100, num(stages![r.key] ?? String(r.pct)))), note: stages![r.key] !== undefined && num(stages![r.key]) !== r.pct ? 'entered by hand' : r.note }))), 'Stage of each activity entered on the Valuation tab'),
    onSuccess: done('Stages saved; % of work completed worked out again'), onError: onErr,
  });
  const saveOwn = useMutation({ mutationFn: () => put('PHYS.PCT_DONE', String(num(own!.pct)), own!.reason.trim()), onSuccess: done('% of work completed set'), onError: onErr });
  const useWorked = useMutation({ mutationFn: () => put('PHYS.PCT_DONE', null, 'Back to the worked-out figure'), onSuccess: done('Worked-out figure in use again'), onError: onErr });
  const print = useMutation({
    mutationFn: (on: boolean) => put('VAL.PRINT_PRESENT', on ? 'Yes' : null, on ? 'Value as per work completed printed' : 'Value as per work completed not printed'),
    onSuccess: (_r, on) => { toast(on ? 'The value as per work completed prints in the report' : 'The value as per work completed is left out of the report'); refresh(); }, onError: onErr,
  });
  // live total while the stages are being edited
  const pctOfRow = (r: WorkRow) => (stages && stages[r.key] !== undefined ? Math.max(0, Math.min(100, num(stages[r.key]))) : r.pct);
  const raw = Math.round(w.rows.reduce((t, r) => t + (r.weight * pctOfRow(r)) / 100, 0) * 100) / 100;
  const rounded = Math.min(100, Math.floor(raw / (w.step || 1) + 0.5) * (w.step || 1));
  const manual = w.source === 'manual';
  return (
    <Panel title="Work completed (under construction)" right={<button className="btn sm ghost" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide the working' : 'How it is worked out'}</button>}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {w.pct === null ? <Pending label="Stage of work not known yet" /> : <span className="text-[22px] font-semibold">{w.pct}%</span>}
        <span className="sub">{manual ? `set by the valuer${w.reason ? `: ${w.reason}` : ''}${w.worked !== null ? ` · worked out: ${w.worked}%` : ''}` : w.source === 'derived' ? `worked out from the stage of each activity${w.stagesFrom === 'manual' ? ' (entered by hand)' : ' (site sheet)'}: ${w.raw}% → ${w.worked}%` : w.source === 'site_sheet' ? 'as stated on the site sheet' : 'enter the stage of each activity below'}</span>
      </div>
      {open && (
        <div className="mt-3">
          <div className="tablewrap">
            <table className="list">
              <thead><tr><th>Activity</th><th className="text-right">Weight %</th><th className="text-right">Completed %</th><th className="text-right">Counts</th></tr></thead>
              <tbody>
                {w.rows.map((r) => (
                  <tr key={r.key}>
                    <td>{r.label}{r.note && <div className="sub">{r.note}</div>}</td>
                    <td className="n mono">{r.weight}</td>
                    <td className="n mono">{stages ? <input className="inp text-right" style={{ maxWidth: 80 }} inputMode="decimal" aria-label={`${r.label}: % completed`} value={stages[r.key] ?? String(r.pct)} onChange={(e) => setStages({ ...stages, [r.key]: e.target.value })} /> : r.pct}</td>
                    <td className="n mono">{(Math.round(r.weight * pctOfRow(r)) / 100).toFixed(2)}</td>
                  </tr>
                ))}
                <tr><td className="font-semibold">Total</td><td className="n mono">{Math.round(w.rows.reduce((t, r) => t + r.weight, 0))}</td><td /><td className="n mono font-semibold">{raw.toFixed(2)}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="sub mb-0 mt-2">Weight × completed, summed: {raw.toFixed(2)}%, rounded to the nearest {w.step}% (halves up) = <b>{rounded}%</b>. Per-floor activities count floors done ÷ floors of the building. The activities and weights are the firm's (Firm settings → Valuation rules).</p>
          {may && (stages
            ? <div className="btns mt-2"><button className="btn pri sm" disabled={saveStages.isPending} onClick={() => saveStages.mutate()}>Save stages</button><button className="btn ghost sm" onClick={() => setStages(null)}>Cancel</button></div>
            : <div className="btns mt-2"><button className="btn sm" onClick={() => setStages({})}>Change the stages</button></div>)}
        </div>
      )}
      {may && (own
        ? (
          <div className="mt-3 grid gap-2 border-t border-line pt-3">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Work completed, %"><input className="inp" style={{ maxWidth: 110 }} inputMode="decimal" value={own.pct} onChange={(e) => setOwn({ ...own, pct: e.target.value })} /></Field>
              <Field label="Reason (required)"><input value={own.reason} onChange={(e) => setOwn({ ...own, reason: e.target.value })} placeholder="e.g. finishing of this wing is ahead of the rest" /></Field>
            </div>
            <div className="btns"><button className="btn pri sm" disabled={!(num(own.pct) > 0 && num(own.pct) <= 100) || own.reason.trim().length < 5 || saveOwn.isPending} onClick={() => saveOwn.mutate()}>Set this figure</button><button className="btn ghost sm" onClick={() => setOwn(null)}>Cancel</button></div>
          </div>
        ) : (
          <div className="btns mt-3">
            <button className="btn sm ghost" onClick={() => setOwn({ pct: String(w.pct ?? ''), reason: '' })}>Set the % myself</button>
            {manual && w.worked !== null && <button className="linkbtn" disabled={useWorked.isPending} onClick={() => useWorked.mutate()}>Use the worked-out {w.worked}%</button>}
          </div>
        ))}
      <div className="mt-3 border-t border-line pt-3">
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" checked={w.printPresent} disabled={!can('val') || locked || print.isPending} onChange={(e) => print.mutate(e.target.checked)} />
          <span><b className="font-medium">Print value as per work completed</b>
            <span className="sub block">{w.printPresent
              ? `Prints the "as per current stage of ${w.pct ?? '…'}% work completion" row, the "As on date" line and the remark${w.presentValue !== null ? `: Rs. ${inr(w.presentValue)}` : ''}.`
              : 'Off: the value-today row, the "As on date is Fair Market value" line and the "At present only …% of the building work is completed" remark are left out. The % of work completed still prints in section 6.'}</span>
          </span>
        </label>
      </div>
    </Panel>
  );
}
