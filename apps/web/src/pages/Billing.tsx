// Billing & payouts: ready to bill, invoices (tax and proforma) with send / payment / credit note,
// payments & ageing with reminders, GST tracking, engineer payouts, accounting exports, setup.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { PAY_MODES, financialYear, gstStateName, inr } from '@vm/shared';
import { api, downloadUrl, saveCsv, whatsappUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Empty, Field, Loading, Modal, PageHead, Panel, fmtDate, useErrorToast, useToast } from '@/components/ui';

// ---- types ---------------------------------------------------------------------------------------
interface Ready {
  id: number; case_no: string; report_no: string; sent_at: string; borrower_name: string | null; property: string | null; bank_code: string; bank_short: string | null;
  branch_id: number; branch_name: string; payer: 'bank' | 'borrower'; payer_overridden: boolean; billing_cycle: 'case' | 'batch'; fee: number | null; proforma: { id: number; invoice_no: string } | null;
}
interface Inv {
  id: number; kind: 'tax' | 'proforma'; invoice_no: string; invoice_date: string; bill_mode: 'case' | 'batch'; payer: 'bank' | 'borrower'; bill_to_name: string; bill_to_gstin: string | null;
  bill_to_address: string | null; bill_to_email: string | null; bill_to_phone: string | null; pos_code: string; sac: string; gst_rate: number; taxable: number; cgst: number; sgst: number; igst: number;
  round_off: number; total: number; period_label: string | null; lines: number; received: number; tds: number; credited: number; writtenOff: number; paid: number; balance: number;
  status: string; status_label: string; age_days: number; sent_at: string | null; converted_invoice_id: number | null; cancelled_at: string | null;
}
interface InvDetail extends Omit<Inv, 'lines'> {
  lines: { id: number; line_no: number; assignment_id: number | null; ref_text: string; description: string; amount: number; released_at: string | null; case_no: string | null }[];
  payments: { id: number; received_on: string; amount: number; tds: number; pay_mode: string; ref_no: string | null; note: string | null }[];
  notes: { id: number; kind: 'credit_note' | 'write_off'; note_no: string | null; note_date: string; total: number; reason: string; released_cases: number }[];
  linked: { id: number; invoice_no: string; kind: string }[]; default_tds: number; tds_pct: number; pos_name: string;
}
interface Setup {
  enabled: boolean; fy: string; firm: { name: string; gstin: string | null; pan: string | null; state_code: string | null; address: string | null };
  settings: { invoice_pattern: string; proforma_pattern: string; credit_note_pattern: string; sac: string; gst_pct: number; tds_pct: number; due_days: number; upi_id: string;
    bank_account: { bank: string; name: string; number: string; ifsc: string; branch: string }; invoice_note: string; engineer_fee: number;
    tally_ledgers: { sales: string; cgst: string; sgst: string; igst: string; round_off: string; bank: string; tds: string } };
  next: { invoice: number; proforma: number; credit_note: number }; exports: Record<string, string>;
}
interface Msg { to: string | null; phone: string | null; subject: string; body: string }

const rs = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `Rs. ${inr(n)}`);
const lakhs = (n: number) => (Math.abs(n) < 1e5 ? `Rs. ${inr(n)}` : `Rs. ${(n / 1e5).toFixed(2)} L`);
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const Status = ({ s, label }: { s: string; label: string }) => <span className={`chip c-${s}`}>{label}</span>;
const useSetup = () => useQuery({ queryKey: ['billing', 'setup'], queryFn: () => api.get<Setup>('/api/billing/setup') });

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['billing'] });
}

// ---- send panel (email with PDF, WhatsApp text) --------------------------------------------------------
function SendPanel({ msg, onEmail, onWhatsapp, sending, title }: { msg: Msg; onEmail: (m: { to: string; subject: string; body: string }) => void; onWhatsapp?: (phone: string, body: string) => void; sending: boolean; title: string }) {
  const toast = useToast();
  const [to, setTo] = useState(msg.to ?? '');
  const [phone, setPhone] = useState(msg.phone ?? '');
  const [subject, setSubject] = useState(msg.subject);
  const [body, setBody] = useState(msg.body);
  return (
    <Panel title={title}>
      <div className="grid gap-3">
        <div className="split">
          <Field label="Email to"><input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="accounts@bank.co.in" /></Field>
          <Field label="WhatsApp number" hint="10-digit mobile; 91 is added"><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98xxxxxxxx" /></Field>
        </div>
        <Field label="Subject"><input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        <Field label="Message"><textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        <div className="btns">
          <button className="btn pri" disabled={sending || !/^\S+@\S+\.\S+$/.test(to.trim())} onClick={() => onEmail({ to: to.trim(), subject, body })}>{sending ? <span className="dots">Sending</span> : 'Send email'}</button>
          <a className={`btn ${phone.replace(/\D/g, '').length >= 10 ? '' : 'pointer-events-none opacity-50'}`} href={whatsappUrl(phone, body)} target="_blank" rel="noreferrer" onClick={() => onWhatsapp?.(phone, body)}>Open in WhatsApp</a>
          <button className="btn ghost" onClick={() => navigator.clipboard.writeText(`${subject}\n\n${body}`).then(() => toast('Copied'))}>Copy</button>
        </div>
      </div>
    </Panel>
  );
}

// ---- ready to bill ------------------------------------------------------------------------------------
function ReadyTab() {
  const toast = useToast();
  const onErr = useErrorToast();
  const nav = useNavigate();
  const inval = useInvalidate();
  const q = useQuery({ queryKey: ['billing', 'ready'], queryFn: () => api.get<Ready[]>('/api/billing/ready') });
  const cand = useQuery({ queryKey: ['billing', 'proforma-cases'], queryFn: () => api.get<{ id: number; case_no: string; borrower_name: string | null; stage: string; fee: number | null; payer: string; bank_code: string; branch_name: string }[]>('/api/billing/proforma-cases') });
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [date, setDate] = useState(today());
  const [pro, setPro] = useState(0);
  const rows = q.data ?? [];
  useEffect(() => { setSel((s) => new Set([...s].filter((id) => rows.some((r) => r.id === id)))); }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const make = useMutation({
    mutationFn: (b: { assignmentIds: number[]; mode: 'case' | 'batch'; kind: 'tax' | 'proforma' }) => api.post<{ id: number; invoiceNo: string; total: number }[]>('/api/billing/invoices', { ...b, date }),
    onSuccess: (made) => {
      toast(`${made.length === 1 ? 'Invoice' : `${made.length} invoices`} raised: ${made.map((m) => m.invoiceNo).join(', ')}`);
      setSel(new Set());
      inval();
      if (made.length === 1) nav(`/billing/invoices/${made[0].id}`);
      else nav('/billing/invoices');
    },
    onError: onErr,
  });
  const patch = useMutation({
    mutationFn: ({ id, ...b }: { id: number; fee?: number | null; payer?: string | null }) => api.patch(`/api/billing/cases/${id}`, b),
    onSuccess: () => inval(),
    onError: onErr,
  });

  if (q.isLoading) return <Loading />;
  const chosen = rows.filter((r) => sel.has(r.id));
  const amount = chosen.reduce((t, r) => t + Number(r.fee ?? 0), 0);
  const branches = new Set(chosen.filter((r) => r.payer === 'bank').map((r) => r.branch_id)).size + chosen.filter((r) => r.payer === 'borrower').length;
  const ids = [...sel];
  return (
    <div className="grid gap-4">
      <div className="btns">
        <Field label="Invoice date"><input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        <button className="btn pri self-end" disabled={!sel.size || make.isPending} onClick={() => make.mutate({ assignmentIds: ids, mode: 'case', kind: 'tax' })}>Bill selected, one per case</button>
        <button className="btn self-end" disabled={!sel.size || make.isPending} onClick={() => make.mutate({ assignmentIds: ids, mode: 'batch', kind: 'tax' })}>Batch bill selected{sel.size ? ` (${branches} invoice${branches === 1 ? '' : 's'})` : ''}</button>
        <button className="btn self-end" disabled={!sel.size || make.isPending || chosen.some((r) => r.proforma)} onClick={() => make.mutate({ assignmentIds: ids, mode: 'case', kind: 'proforma' })}>Proforma for selected</button>
        <span className="sub self-end pb-2">{sel.size} selected · {rs(amount)} before GST</span>
      </div>
      <Panel pad={false} title={<div><h3 className="text-[14px] font-semibold">Signed and sent, not billed yet</h3><div className="sub">Batch bills combine cases the bank pays, one invoice per branch. Borrower-paid cases are billed one by one.</div></div>}>
        <div className="tablewrap">
          <table className="list">
            <thead><tr>
              <th><input type="checkbox" aria-label="Select all" checked={!!rows.length && sel.size === rows.length} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>
              <th>Report no.</th><th>Sent</th><th>Bank · branch</th><th>Property</th><th>Payer</th><th>Usual cycle</th><th className="n">Fee</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><input type="checkbox" aria-label={`Select ${r.report_no}`} checked={sel.has(r.id)} onChange={(e) => { const s = new Set(sel); if (e.target.checked) s.add(r.id); else s.delete(r.id); setSel(s); }} /></td>
                  <td className="mono whitespace-nowrap"><Link to={`/cases/${r.id}/out`}>{r.report_no}</Link><div className="sub">{r.case_no}</div>{r.proforma && <div className="sub">Advance on <Link to={`/billing/invoices/${r.proforma.id}`}>{r.proforma.invoice_no}</Link></div>}</td>
                  <td className="whitespace-nowrap">{fmtDate(r.sent_at)}</td>
                  <td>{r.bank_short ?? r.bank_code}<div className="sub">{r.branch_name}</div></td>
                  <td>{r.borrower_name}<div className="sub">{r.property}</div></td>
                  <td>
                    <select className="inp" style={{ width: 'auto', padding: '4px 8px' }} aria-label={`Payer for ${r.report_no}`} value={r.payer} disabled={patch.isPending}
                      onChange={(e) => patch.mutate({ id: r.id, payer: e.target.value })}>
                      <option value="bank">Bank</option><option value="borrower">Borrower</option>
                    </select>
                    {r.payer_overridden && <div className="sub">changed for this case</div>}
                  </td>
                  <td className="sub">{r.billing_cycle === 'batch' ? 'Monthly batch' : 'Per case'}</td>
                  <td className="n"><FeeInput value={r.fee} onSave={(fee) => patch.mutate({ id: r.id, fee })} /></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} className="muted">Nothing waiting to be billed. Reports appear here once they are signed and marked as sent.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Advance before the report (proforma)">
        <div className="inline-form">
          <Field label="Case">
            <select value={pro} onChange={(e) => setPro(Number(e.target.value))}>
              <option value={0}>Choose a case…</option>
              {(cand.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.case_no} · {c.borrower_name ?? 'borrower not named'} · {c.bank_code} {c.branch_name} · {c.fee ? rs(c.fee) : 'no fee'}</option>)}
            </select>
          </Field>
          <button className="btn" disabled={!pro || make.isPending} onClick={() => make.mutate({ assignmentIds: [pro], mode: 'case', kind: 'proforma' })}>Raise proforma</button>
        </div>
        <p className="sub mb-0 mt-2">A proforma is marked “not a tax invoice”. Record the advance on it; billing the case later converts it to a tax invoice with the advance adjusted.</p>
      </Panel>
    </div>
  );
}

function FeeInput({ value, onSave }: { value: number | null; onSave: (v: number) => void }) {
  const [v, setV] = useState(value === null ? '' : String(value));
  useEffect(() => setV(value === null ? '' : String(value)), [value]);
  return (
    <input className="inp mono text-right" style={{ width: 96, padding: '4px 8px' }} aria-label="Fee" value={v} inputMode="numeric" onChange={(e) => setV(e.target.value)}
      onBlur={() => { const n = Number(v.replace(/[, ]/g, '')); if (n > 0 && n !== value) onSave(n); else setV(value === null ? '' : String(value)); }} />
  );
}

// ---- invoices --------------------------------------------------------------------------------------
function InvoicesTab() {
  const nav = useNavigate();
  const [kind, setKind] = useState<'' | 'tax' | 'proforma'>('');
  const [status, setStatus] = useState('');
  const q = useQuery({ queryKey: ['billing', 'invoices', kind], queryFn: () => api.get<Inv[]>(`/api/billing/invoices${kind ? `?kind=${kind}` : ''}`) });
  if (q.isLoading) return <Loading />;
  const rows = (q.data ?? []).filter((i) => !status || i.status === status || (status === 'open' && i.balance > 0 && i.kind === 'tax'));
  return (
    <div className="grid gap-3">
      <div className="btns">
        <select className="inp" style={{ width: 'auto' }} value={kind} onChange={(e) => setKind(e.target.value as any)} aria-label="Type"><option value="">All invoices</option><option value="tax">Tax invoices</option><option value="proforma">Proformas</option></select>
        <select className="inp" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Any status</option><option value="open">Balance open</option><option value="overdue">Overdue</option><option value="part">Part paid</option><option value="paid">Paid</option></select>
        <span className="sub">{rows.length} shown</span>
      </div>
      <Panel pad={false}>
        <div className="tablewrap">
          <table className="list click">
            <thead><tr><th>Invoice</th><th>Date</th><th>Bill to</th><th>Type</th><th className="n">Total</th><th className="n">Balance</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} onClick={() => nav(`/billing/invoices/${i.id}`)}>
                  <td className="mono whitespace-nowrap">{i.invoice_no}</td>
                  <td className="whitespace-nowrap">{fmtDate(i.invoice_date)}</td>
                  <td>{i.bill_to_name}<div className="sub">{i.bill_to_gstin ?? 'Unregistered (B2C)'}</div></td>
                  <td className="sub">{i.kind === 'proforma' ? 'Proforma' : i.bill_mode === 'batch' ? `Batch · ${i.lines}${i.period_label ? ` · ${i.period_label}` : ''}` : 'Single case'}</td>
                  <td className="n mono">{inr(i.total)}</td>
                  <td className="n mono">{i.kind === 'proforma' && i.converted_invoice_id ? '—' : inr(i.balance)}</td>
                  <td><Status s={i.status} label={i.status_label} />{i.status === 'overdue' && <div className="sub">{i.age_days} days</div>}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className="muted">No invoices yet. Raise them from Ready to bill.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function InvoiceView() {
  const id = Number(useParams().id);
  const toast = useToast();
  const onErr = useErrorToast();
  const inval = useInvalidate();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['billing', 'invoice', id], queryFn: () => api.get<InvDetail>(`/api/billing/invoices/${id}`) });
  const msg = useQuery({ queryKey: ['billing', 'invoice', id, 'msg'], queryFn: () => api.get<Msg>(`/api/billing/invoices/${id}/message`) });
  const [pdf, setPdf] = useState<string>();
  const [mode, setMode] = useState<'' | 'pay' | 'close' | 'send' | 'cancel'>('');
  useEffect(() => {
    let url: string | undefined;
    let live = true;
    if (q.data) api.binary(`/api/billing/invoices/${id}/pdf`).then((b) => { url = URL.createObjectURL(new Blob([b], { type: 'application/pdf' })); if (live) setPdf(url); }).catch(() => undefined);
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [id, q.data?.balance, q.data?.paid, q.data?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = (m: string) => () => { toast(m); setMode(''); inval(); };
  const email = useMutation({ mutationFn: (b: { to: string; subject: string; body: string }) => api.post(`/api/billing/invoices/${id}/email`, b), onSuccess: done('Invoice emailed with PDF'), onError: onErr });
  const wa = useMutation({ mutationFn: (b: { phone: string; body: string }) => api.post(`/api/billing/invoices/${id}/whatsapp`, b), onSuccess: () => inval(), onError: onErr });
  const convert = useMutation({ mutationFn: () => api.post<{ id: number; invoiceNo: string }>(`/api/billing/invoices/${id}/convert`, {}), onSuccess: (r) => { toast(`Tax invoice ${r.invoiceNo} raised; advance adjusted`); inval(); nav(`/billing/invoices/${r.id}`); }, onError: onErr });

  if (q.isLoading) return <Loading />;
  if (!q.data) return <Empty title="Invoice not found" />;
  const v = q.data;
  const open = v.balance > 0 && !v.converted_invoice_id && !v.cancelled_at;
  const isPro = v.kind === 'proforma';
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/billing/invoices" className="linkbtn">← Invoices</Link>
          <h2 className="mono text-[18px]">{v.invoice_no} <Status s={v.status} label={v.status_label} /></h2>
          <div className="sub">{isPro ? 'Proforma invoice (not a tax invoice)' : 'Tax invoice'} · {fmtDate(v.invoice_date)} · {v.bill_to_name}{v.sent_at ? ` · sent ${fmtDate(v.sent_at, true)}` : ''}</div>
        </div>
        <div className="btns">
          {isPro && !v.converted_invoice_id && !v.cancelled_at && <button className="btn pri" disabled={convert.isPending} onClick={() => convert.mutate()}>Convert to tax invoice</button>}
          {open && <button className={`btn ${isPro ? '' : 'pri'}`} onClick={() => setMode(mode === 'pay' ? '' : 'pay')}>{isPro ? 'Record advance' : 'Record payment'}</button>}
          {!v.cancelled_at && !v.converted_invoice_id && <button className="btn" onClick={() => setMode(mode === 'send' ? '' : 'send')}>Send to {v.payer === 'bank' ? 'bank' : 'borrower'}</button>}
          {!isPro && open && <button className="btn" onClick={() => setMode(mode === 'close' ? '' : 'close')}>Credit note / write off</button>}
          {isPro && !v.converted_invoice_id && !v.cancelled_at && v.paid === 0 && <button className="btn ghost" onClick={() => setMode('cancel')}>Cancel proforma</button>}
          <button className="btn" onClick={() => downloadUrl(`/api/billing/invoices/${id}/pdf`, `${v.invoice_no.replace(/\//g, '-')}.pdf`).catch(onErr)}>Download PDF</button>
        </div>
      </div>

      {mode === 'pay' && <PaymentForm v={v} onDone={done(isPro ? 'Advance recorded' : 'Payment recorded')} onCancel={() => setMode('')} />}
      {mode === 'close' && <CloseForm v={v} onDone={done('Saved')} onCancel={() => setMode('')} />}
      {mode === 'send' && msg.data && <SendPanel title={`Send ${v.invoice_no}`} msg={{ ...msg.data, to: msg.data.to ?? v.bill_to_email, phone: msg.data.phone ?? v.bill_to_phone }} sending={email.isPending} onEmail={(m) => email.mutate(m)} onWhatsapp={(phone, body) => wa.mutate({ phone, body })} />}
      <CancelModal open={mode === 'cancel'} id={id} onClose={() => setMode('')} onDone={done('Proforma cancelled')} />

      <div className="cols">
        <div>{pdf ? <iframe className="invframe" src={pdf} title={`Invoice ${v.invoice_no}`} /> : <Loading what="Preparing PDF" />}</div>
        <div className="grid gap-4">
          <Panel title="Amounts">
            <div className="grid gap-1 text-[13.5px]">
              <Row k="Taxable value" v={rs(v.taxable)} />
              {v.igst > 0 ? <Row k={`IGST ${v.gst_rate}%`} v={rs(v.igst)} /> : <><Row k={`CGST ${v.gst_rate / 2}%`} v={rs(v.cgst)} /><Row k={`SGST ${v.gst_rate / 2}%`} v={rs(v.sgst)} /></>}
              <Row k="Total" v={<b>{rs(v.total)}</b>} />
              <Row k={isPro ? 'Advance received' : 'Received'} v={rs(v.received)} />
              {v.tds > 0 && <Row k="TDS deducted" v={rs(v.tds)} />}
              {v.credited > 0 && <Row k="Credit notes" v={rs(v.credited)} />}
              {v.writtenOff > 0 && <Row k="Written off" v={rs(v.writtenOff)} />}
              <Row k="Balance" v={<b>{v.converted_invoice_id ? 'moved to tax invoice' : rs(v.balance)}</b>} />
            </div>
            <div className="sub mt-3">Place of supply {v.pos_name} ({v.pos_code}) · SAC {v.sac} · {v.bill_to_gstin ? `B2B, GSTIN ${v.bill_to_gstin}` : 'B2C (unregistered)'}</div>
            {v.linked.map((l) => <div key={l.id} className="sub mt-1">{l.kind === 'proforma' ? 'Converted from' : 'Converted to'} <Link to={`/billing/invoices/${l.id}`}>{l.invoice_no}</Link></div>)}
          </Panel>
          <Panel title={`Cases (${v.lines.length})`} pad={false}>
            {v.lines.map((l) => (
              <div key={l.id} className="border-b border-line px-4 py-2 last:border-b-0">
                <div className="flex justify-between gap-2"><span className="mono text-[13px]">{l.assignment_id ? <Link to={`/cases/${l.assignment_id}/out`}>{l.ref_text}</Link> : l.ref_text}</span><span className="mono">{inr(l.amount)}</span></div>
                <div className="sub">{l.description}{l.released_at ? ' · released to bill again' : ''}</div>
              </div>
            ))}
          </Panel>
          {(v.payments.length > 0 || v.notes.length > 0) && (
            <Panel title="Payments and adjustments" pad={false}>
              <table className="list">
                <tbody>
                  {v.payments.map((p) => <tr key={`p${p.id}`}><td className="whitespace-nowrap">{fmtDate(p.received_on)}</td><td>{p.pay_mode}{p.ref_no && <div className="sub mono">{p.ref_no}</div>}{p.note && <div className="sub">{p.note}</div>}</td><td className="n mono">{inr(p.amount)}{p.tds > 0 && <div className="sub">TDS {inr(p.tds)}</div>}</td></tr>)}
                  {v.notes.map((n) => <tr key={`n${n.id}`}><td className="whitespace-nowrap">{fmtDate(n.note_date)}</td><td>{n.kind === 'credit_note' ? `Credit note ${n.note_no}` : 'Written off'}<div className="sub">{n.reason}</div></td><td className="n mono">{inr(n.total)}</td></tr>)}
                </tbody>
              </table>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: ReactNode }) => <div className="flex justify-between gap-3"><span className="muted">{k}</span><span className="mono">{v}</span></div>;

function PaymentForm({ v, onDone, onCancel }: { v: InvDetail; onDone: () => void; onCancel: () => void }) {
  const onErr = useErrorToast();
  const [tds, setTds] = useState(String(v.paid > 0 ? 0 : Math.min(v.default_tds, v.balance)));
  const [amount, setAmount] = useState(String(Math.max(0, Math.round(v.balance - Number(tds)))));
  const [date, setDate] = useState(today());
  const [mode, setMode] = useState<string>(v.payer === 'bank' ? 'NEFT' : 'UPI');
  const [ref, setRef] = useState('');
  const save = useMutation({ mutationFn: () => api.post(`/api/billing/invoices/${v.id}/payments`, { amount: Number(amount) || 0, tds: Number(tds) || 0, date, mode, ref: ref || null }), onSuccess: onDone, onError: onErr });
  return (
    <Panel title={`${v.kind === 'proforma' ? 'Record advance' : 'Record payment'} · balance ${rs(v.balance)}`}>
      <div className="inline-form">
        <Field label="Amount received"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        {v.kind === 'tax' && <Field label="TDS deducted" hint={v.payer === 'bank' ? `${v.tds_pct}% of taxable value` : 'usually nil for individuals'}><input inputMode="decimal" value={tds} onChange={(e) => { setTds(e.target.value); setAmount(String(Math.max(0, Math.round(v.balance - (Number(e.target.value) || 0))))); }} /></Field>}
        <Field label="Date"><input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Mode"><select value={mode} onChange={(e) => setMode(e.target.value)}>{PAY_MODES.map((m) => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Reference / UTR"><input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="UTR or cheque no." /></Field>
      </div>
      <div className="btns mt-3">
        <button className="btn pri" disabled={save.isPending || !(Number(amount) + Number(tds) > 0)} onClick={() => save.mutate()}>Save payment</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        <span className="sub">Part payments are fine; the balance stays open. Amount + TDS = Rs. {inr((Number(amount) || 0) + (Number(tds) || 0))}</span>
      </div>
    </Panel>
  );
}

function CloseForm({ v, onDone, onCancel }: { v: InvDetail; onDone: () => void; onCancel: () => void }) {
  const onErr = useErrorToast();
  const [kind, setKind] = useState<'credit_note' | 'write_off'>('credit_note');
  const [amount, setAmount] = useState(String(v.balance));
  const [reason, setReason] = useState('');
  const [release, setRelease] = useState(false);
  const whole = v.paid === 0 && v.credited + v.writtenOff === 0 && Math.abs(Number(amount) - v.total) < 0.5;
  const save = useMutation({ mutationFn: () => api.post(`/api/billing/invoices/${v.id}/close`, { kind, amount: Number(amount), reason, release: kind === 'credit_note' && whole && release }), onSuccess: onDone, onError: onErr });
  return (
    <Panel title={`Close balance of ${rs(v.balance)}`}>
      <div className="inline-form">
        <Field label="How"><select value={kind} onChange={(e) => setKind(e.target.value as any)}><option value="credit_note">Credit note (GST reversed)</option><option value="write_off">Write off (bad debt, no GST effect)</option></select></Field>
        <Field label="Amount incl. GST"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Reason"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === 'credit_note' ? 'e.g. fee revised by the bank' : 'e.g. borrower not reachable'} /></Field>
      </div>
      {kind === 'credit_note' && whole && (
        <label className="mt-3 flex items-start gap-2"><input type="checkbox" className="mt-1" checked={release} onChange={(e) => setRelease(e.target.checked)} /><span>Cancel the invoice and return its cases to Ready to bill<span className="sub block">Use when the invoice was raised wrongly (wrong payer, amount or batch). Reissuing a billed report also needs this.</span></span></label>
      )}
      <div className="btns mt-3">
        <button className="btn pri" disabled={save.isPending || reason.trim().length < 3 || !(Number(amount) > 0)} onClick={() => save.mutate()}>{kind === 'credit_note' ? 'Issue credit note' : 'Write off'}</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </Panel>
  );
}

function CancelModal({ open, id, onClose, onDone }: { open: boolean; id: number; onClose: () => void; onDone: () => void }) {
  const onErr = useErrorToast();
  const [reason, setReason] = useState('');
  const m = useMutation({ mutationFn: () => api.post(`/api/billing/invoices/${id}/cancel`, { reason }), onSuccess: onDone, onError: onErr });
  return (
    <Modal open={open} onClose={onClose} title="Cancel proforma" actions={<><button className="btn" onClick={onClose}>Keep it</button><button className="btn pri" disabled={reason.trim().length < 3 || m.isPending} onClick={() => m.mutate()}>Cancel proforma</button></>}>
      <Field label="Reason"><input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
    </Modal>
  );
}

// ---- payments & ageing ------------------------------------------------------------------------------
interface Ageing {
  buckets: { key: string; label: string; amount: number; count: number }[];
  parties: { party: string; gstin: string | null; email: string | null; phone: string | null; amount: number; oldest: string; invoices: { id: number; invoice_no: string; invoice_date: string; balance: number; age_days: number }[] }[];
  receipts: { id: number; received_on: string; amount: number; tds: number; pay_mode: string; ref_no: string | null; invoice_id: number; invoice_no: string; bill_to_name: string }[];
}
function PaymentsTab() {
  const toast = useToast();
  const onErr = useErrorToast();
  const q = useQuery({ queryKey: ['billing', 'ageing'], queryFn: () => api.get<Ageing>('/api/billing/ageing') });
  const [party, setParty] = useState<string | null>(null);
  const msg = useQuery({ queryKey: ['billing', 'reminder', party], enabled: !!party, queryFn: () => api.get<Msg>(`/api/billing/reminder?party=${encodeURIComponent(party!)}`) });
  const send = useMutation({ mutationFn: (m: { to: string; subject: string; body: string }) => api.post('/api/billing/reminder/email', { ...m, party }), onSuccess: () => { toast('Reminder emailed'); setParty(null); }, onError: onErr });
  if (q.isLoading || !q.data) return <Loading />;
  const d = q.data;
  return (
    <div className="grid gap-4">
      <div className="kpis">{d.buckets.map((b) => <div key={b.key} className="panel kpi"><div className="l">{b.label}</div><div className="n">{lakhs(b.amount)}</div><div className="s">{b.count} invoice{b.count === 1 ? '' : 's'}</div></div>)}</div>
      <Panel title="Outstanding by party" pad={false}>
        <div className="tablewrap">
          <table className="list">
            <thead><tr><th>Bill to</th><th className="n">Invoices</th><th className="n">Outstanding</th><th>Oldest</th><th /></tr></thead>
            <tbody>
              {d.parties.map((p) => (
                <tr key={p.party}>
                  <td>{p.party}<div className="sub">{p.invoices.map((i) => i.invoice_no).join(', ')}</div></td>
                  <td className="n mono">{p.invoices.length}</td><td className="n mono">{inr(p.amount)}</td>
                  <td className="whitespace-nowrap">{fmtDate(p.oldest)}<div className="sub">{Math.max(...p.invoices.map((i) => i.age_days))} days</div></td>
                  <td><button className="btn sm" onClick={() => setParty(party === p.party ? null : p.party)}>Draft reminder</button></td>
                </tr>
              ))}
              {!d.parties.length && <tr><td colSpan={5} className="muted">Nothing outstanding.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
      {party && msg.data && <SendPanel key={party} title={`Reminder to ${party}`} msg={msg.data} sending={send.isPending} onEmail={(m) => send.mutate(m)} />}
      <Panel title="Receipts" right={<span className="sub">including TDS</span>} pad={false}>
        <div className="tablewrap">
          <table className="list">
            <thead><tr><th>Date</th><th>Invoice</th><th>From</th><th>Mode</th><th className="n">Received</th><th className="n">TDS</th></tr></thead>
            <tbody>
              {d.receipts.map((r) => <tr key={r.id}><td className="whitespace-nowrap">{fmtDate(r.received_on)}</td><td className="mono"><Link to={`/billing/invoices/${r.invoice_id}`}>{r.invoice_no}</Link></td><td>{r.bill_to_name}</td><td>{r.pay_mode}{r.ref_no && <div className="sub mono">{r.ref_no}</div>}</td><td className="n mono">{inr(r.amount)}</td><td className="n mono">{inr(r.tds)}</td></tr>)}
              {!d.receipts.length && <tr><td colSpan={6} className="muted">No payments recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

// ---- GST ----------------------------------------------------------------------------------------------
function GstTab() {
  const q = useQuery({ queryKey: ['billing', 'gst'], queryFn: () => api.get<{ months: { month: string; label: string; invoices: number; taxable: number; gst: number; credit: number; received: number; toCollect: number }[]; totals: { gst: number; received: number; toCollect: number } }>('/api/billing/gst') });
  if (q.isLoading || !q.data) return <Loading />;
  const { months, totals } = q.data;
  return (
    <div className="grid gap-4">
      <div className="kpis">
        <div className="panel kpi"><div className="l">GST charged (net of credit notes)</div><div className="n">{rs(totals.gst)}</div><div className="s">due to the government by invoice date</div></div>
        <div className="panel kpi"><div className="l">GST received from clients</div><div className="n">{rs(totals.received)}</div><div className="s">GST share of payments received</div></div>
        <div className="panel kpi"><div className="l">GST still to collect</div><div className="n" style={{ color: 'var(--warn)' }}>{rs(totals.toCollect)}</div><div className="s">paid to the government before the client pays you</div></div>
      </div>
      <Panel pad={false}>
        <div className="tablewrap">
          <table className="list">
            <thead><tr><th>Month</th><th className="n">Invoices</th><th className="n">Taxable value</th><th className="n">GST charged</th><th className="n">Credit notes</th><th className="n">GST received</th><th className="n">To collect</th></tr></thead>
            <tbody>
              {months.map((m) => <tr key={m.month}><td>{m.label}</td><td className="n mono">{m.invoices}</td><td className="n mono">{inr(m.taxable)}</td><td className="n mono">{inr(m.gst)}</td><td className="n mono">{inr(m.credit)}</td><td className="n mono">{inr(m.received)}</td><td className="n mono">{inr(m.toCollect)}</td></tr>)}
              {!months.length && <tr><td colSpan={7} className="muted">No tax invoices yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
      <p className="sub m-0">CGST + SGST within the firm's state, IGST for a place of supply in another state. Proforma invoices are not counted. For filing use Accounting export → GSTR-1, and confirm the figures and the SAC code with your CA.</p>
    </div>
  );
}

// ---- engineer payouts ------------------------------------------------------------------------------------
interface Payouts { month: string; label: string; defaultFee: number; rows: { engineer_id: number; name: string; phone: string | null; visits: number; fee: number; amount: number; paid_on: string | null; ref_no: string | null; current_visits: number }[] }
function PayoutsTab() {
  const toast = useToast();
  const onErr = useErrorToast();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [paying, setPaying] = useState<number | null>(null);
  const [ref, setRef] = useState('');
  const [paidOn, setPaidOn] = useState(today());
  const q = useQuery({ queryKey: ['billing', 'payouts', month], queryFn: () => api.get<Payouts>(`/api/billing/payouts?month=${month}`) });
  const pay = useMutation({
    mutationFn: (engineerId: number) => api.post<Payouts>(`/api/billing/payouts/${engineerId}`, { month, paidOn, ref: ref || null }),
    onSuccess: (d) => { qc.setQueryData(['billing', 'payouts', month], d); toast('Marked paid'); setPaying(null); setRef(''); },
    onError: onErr,
  });
  const d = q.data;
  return (
    <div className="grid gap-3">
      <div className="btns">
        <Field label="Month"><input type="month" value={month} max={today().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} /></Field>
        {d && can('exp') && <button className="btn self-end" disabled={!d.rows.length} onClick={() => saveCsv(`engineer_payouts_${month}.csv`, ['engineer', 'phone', 'month', 'visits', 'fee_per_visit', 'payable', 'paid_on', 'reference'], d.rows.map((r) => [r.name, r.phone, month, r.visits, r.fee, r.amount, r.paid_on, r.ref_no]))}>Export CSV</button>}
        {d && <span className="sub self-end pb-2">Site visits submitted in {d.label} · default Rs. {inr(d.defaultFee)} per visit (set per engineer in Firm settings)</span>}
      </div>
      {q.isLoading || !d ? <Loading /> : (
        <Panel pad={false}>
          <div className="tablewrap">
            <table className="list">
              <thead><tr><th>Engineer</th><th className="n">Visits</th><th className="n">Fee / visit</th><th className="n">Payable</th><th>Status</th><th /></tr></thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.engineer_id}>
                    <td>{r.name}{r.phone && <div className="sub">{r.phone}</div>}</td>
                    <td className="n mono">{r.visits}{r.paid_on && r.current_visits !== r.visits && <div className="sub">now {r.current_visits}</div>}</td>
                    <td className="n mono">{inr(r.fee)}</td><td className="n mono">{inr(r.amount)}</td>
                    <td>{r.paid_on ? <span className="chip c-paid">Paid {fmtDate(r.paid_on)}</span> : <span className="chip c-unpaid">Pending</span>}{r.ref_no && <div className="sub mono">{r.ref_no}</div>}</td>
                    <td>{!r.paid_on && (paying === r.engineer_id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input type="date" className="inp" style={{ width: 150, padding: '4px 8px' }} value={paidOn} max={today()} onChange={(e) => setPaidOn(e.target.value)} aria-label="Paid on" />
                        <input className="inp" style={{ width: 130, padding: '4px 8px' }} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="UTR / UPI ref" aria-label="Reference" />
                        <button className="btn sm pri" disabled={pay.isPending} onClick={() => pay.mutate(r.engineer_id)}>Save</button>
                        <button className="btn sm ghost" onClick={() => setPaying(null)}>Cancel</button>
                      </div>
                    ) : <button className="btn sm" onClick={() => setPaying(r.engineer_id)}>Mark paid</button>)}</td>
                  </tr>
                ))}
                {!d.rows.length && <tr><td colSpan={6} className="muted">No site visits submitted in {d.label}.</td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

// ---- accounting export ------------------------------------------------------------------------------------
const EXPORT_GROUPS: { title: string; note: string; kinds: string[] }[] = [
  { title: 'Tally', note: 'Sales, credit note and receipt vouchers for Tally Prime / ERP 9. Ledger names come from Billing setup; create them in Tally first.', kinds: ['tally'] },
  { title: 'Zoho Books', note: "Invoices in Zoho Books' import columns (one row per line).", kinds: ['zoho'] },
  { title: 'Excel / CSV', note: 'For Busy, Marg, QuickBooks or your CA: invoices with received, TDS, credit notes and balance; receipts; credit notes and write-offs.', kinds: ['invoices', 'receipts', 'credit_notes'] },
  { title: 'GST return data (GSTR-1)', note: 'Columns of the GST offline tool: B2B invoice-wise, B2C small summary, credit notes to registered parties, SAC summary.', kinds: ['gstr1_b2b', 'gstr1_b2cs', 'gstr1_cdnr', 'gstr1_hsn'] },
  { title: 'TDS', note: 'TDS deducted by each payer in the period, to match with Form 26AS.', kinds: ['tds'] },
];
function ExportTab() {
  const onErr = useErrorToast();
  const setup = useSetup();
  const fy = financialYear();
  const [from, setFrom] = useState(today().slice(0, 8) + '01');
  const [to, setTo] = useState(today());
  const [busy, setBusy] = useState('');
  const presets: [string, string, string][] = useMemo(() => {
    const t = today();
    const [y, m] = t.split('-').map(Number);
    const lastEnd = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
    return [['This month', t.slice(0, 8) + '01', t], ['Last month', lastEnd.slice(0, 8) + '01', lastEnd], [`FY ${fy.short}`, `${fy.start}-04-01`, t]];
  }, [fy.short, fy.start]);
  const labels = setup.data?.exports ?? {};
  const get = async (k: string) => {
    setBusy(k);
    try { await downloadUrl(`/api/billing/export/${k}?from=${from}&to=${to}`, `${k}_${from}_to_${to}.${k === 'tally' ? 'xml' : 'csv'}`); } catch (e) { onErr(e); } finally { setBusy(''); }
  };
  return (
    <div className="grid gap-4">
      <div className="btns">
        <Field label="From"><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} min={from} max={today()} onChange={(e) => setTo(e.target.value)} /></Field>
        {presets.map(([l, f, t]) => <button key={l} className={`btn sm self-end ${from === f && to === t ? 'pri' : ''}`} onClick={() => { setFrom(f); setTo(t); }}>{l}</button>)}
      </div>
      <Panel pad={false}>
        {EXPORT_GROUPS.map((g) => (
          <div key={g.title} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0">
            <div className="min-w-0 max-w-xl"><b>{g.title}</b><div className="sub">{g.note}</div></div>
            <div className="btns">{g.kinds.map((k) => <button key={k} className="btn sm" disabled={!!busy} onClick={() => get(k)}>{busy === k ? <span className="dots">Preparing</span> : labels[k]?.replace(/^GSTR-1 /, '') ?? k}</button>)}</div>
          </div>
        ))}
      </Panel>
      <p className="sub m-0">Tax invoices only (proformas are not accounting documents). Check each format once with a sample import into your software before relying on it.</p>
    </div>
  );
}

// ---- setup --------------------------------------------------------------------------------------------------
function SetupTab() {
  const q = useSetup();
  const toast = useToast();
  const onErr = useErrorToast();
  const inval = useInvalidate();
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api.get<{ branches: { id: number; bank_code: string; name: string; default_payer: string; billing_cycle: string; fee: number | null; gstin: string | null; state_code: string | null }[] }>('/api/meta') });
  const [f, setF] = useState<Setup['settings'] | null>(null);
  const [pan, setPan] = useState('');
  const [next, setNext] = useState('');
  useEffect(() => { if (q.data) { setF(q.data.settings); setPan(q.data.firm.pan ?? ''); setNext(String(q.data.next.invoice)); } }, [q.data]);
  const save = useMutation({
    mutationFn: () => api.patch('/api/billing/setup', { settings: f, pan: pan || null, ...(Number(next) !== q.data?.next.invoice ? { nextInvoice: Number(next) } : {}) }),
    onSuccess: () => { toast('Billing setup saved'); inval(); },
    onError: onErr,
  });
  if (!q.data || !f) return <Loading />;
  const d = q.data;
  const set = <K extends keyof Setup['settings']>(k: K, v: Setup['settings'][K]) => setF({ ...f, [k]: v });
  const sample = (p: string, n: number) => p.replace('{FY}', d.fy).replace('{N}', String(n).padStart(4, '0'));
  return (
    <div className="grid gap-4">
      <section className="panel">
        <form className="form" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <h3>Firm tax details</h3>
          <Field label="Firm GSTIN" hint={<>Change in <Link to="/settings/firm">Firm settings</Link></>}><input className="mono" value={d.firm.gstin ?? ''} disabled /></Field>
          <Field label="State (for CGST/SGST vs IGST)"><input value={d.firm.state_code ? `${gstStateName(d.firm.state_code)} (${d.firm.state_code})` : 'Not set'} disabled /></Field>
          <Field label="PAN"><input className="mono" value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} maxLength={10} /></Field>
          <Field label="SAC code" hint="Confirm with your CA"><input className="mono" value={f.sac} onChange={(e) => set('sac', e.target.value)} /></Field>
          <Field label="GST %"><input inputMode="decimal" value={f.gst_pct} onChange={(e) => set('gst_pct', e.target.value as any)} /></Field>
          <Field label="TDS by banks, % of taxable value" hint="Default on the payment form (section 194J)"><input inputMode="decimal" value={f.tds_pct} onChange={(e) => set('tds_pct', e.target.value as any)} /></Field>
          <Field label="Overdue after (days)"><input inputMode="numeric" value={f.due_days} onChange={(e) => set('due_days', e.target.value as any)} /></Field>
          <h3>Numbering</h3>
          <Field label="Tax invoice" hint={`Next: ${sample(f.invoice_pattern, Number(next) || d.next.invoice)}`}><input className="mono" value={f.invoice_pattern} onChange={(e) => set('invoice_pattern', e.target.value)} /></Field>
          <Field label="Next invoice no. this FY" hint="To continue your current series"><input inputMode="numeric" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
          <Field label="Proforma" hint={`Next: ${sample(f.proforma_pattern, d.next.proforma)}`}><input className="mono" value={f.proforma_pattern} onChange={(e) => set('proforma_pattern', e.target.value)} /></Field>
          <Field label="Credit note" hint={`Next: ${sample(f.credit_note_pattern, d.next.credit_note)}`}><input className="mono" value={f.credit_note_pattern} onChange={(e) => set('credit_note_pattern', e.target.value)} /></Field>
          <h3>Payment details printed on invoices</h3>
          <Field label="Bank"><input value={f.bank_account.bank} onChange={(e) => set('bank_account', { ...f.bank_account, bank: e.target.value })} /></Field>
          <Field label="Branch"><input value={f.bank_account.branch} onChange={(e) => set('bank_account', { ...f.bank_account, branch: e.target.value })} /></Field>
          <Field label="Account name"><input value={f.bank_account.name} onChange={(e) => set('bank_account', { ...f.bank_account, name: e.target.value })} /></Field>
          <Field label="Account no."><input className="mono" value={f.bank_account.number} onChange={(e) => set('bank_account', { ...f.bank_account, number: e.target.value })} /></Field>
          <Field label="IFSC"><input className="mono" value={f.bank_account.ifsc} onChange={(e) => set('bank_account', { ...f.bank_account, ifsc: e.target.value.toUpperCase() })} /></Field>
          <Field label="UPI ID for the QR" hint="Borrower invoices carry a QR for the balance"><input className="mono" value={f.upi_id} onChange={(e) => set('upi_id', e.target.value.trim())} placeholder="firm@okbank" /></Field>
          <Field label="Note under the totals" full><input value={f.invoice_note} onChange={(e) => set('invoice_note', e.target.value)} placeholder="e.g. Payment within 30 days. Subject to Thane jurisdiction." /></Field>
          <h3>Engineers and Tally</h3>
          <Field label="Default fee per site visit" hint="When the engineer has no fee of their own"><input inputMode="numeric" value={f.engineer_fee} onChange={(e) => set('engineer_fee', e.target.value as any)} /></Field>
          <div />
          {(Object.keys(f.tally_ledgers) as (keyof Setup['settings']['tally_ledgers'])[]).map((k) => (
            <Field key={k} label={`Tally ledger: ${({ sales: 'fees (sales)', cgst: 'output CGST', sgst: 'output SGST', igst: 'output IGST', round_off: 'round off', bank: 'bank (receipts)', tds: 'TDS receivable' } as Record<string, string>)[k]}`}>
              <input value={f.tally_ledgers[k]} onChange={(e) => set('tally_ledgers', { ...f.tally_ledgers, [k]: e.target.value })} />
            </Field>
          ))}
          <div className="full btns"><button className="btn pri" disabled={save.isPending}>Save</button></div>
        </form>
      </section>
      <Panel title="Who pays, and how often" right={<Link to="/settings/banks" className="btn sm">Edit in Banks & branches</Link>} pad={false}>
        <div className="tablewrap">
          <table className="list">
            <thead><tr><th>Branch</th><th>Payer</th><th>Billing</th><th className="n">Fee / report</th><th>GSTIN</th></tr></thead>
            <tbody>{(meta.data?.branches ?? []).map((b) => <tr key={b.id}><td>{b.bank_code} · {b.name}</td><td>{b.default_payer === 'borrower' ? 'Borrower' : 'Bank'}</td><td>{b.billing_cycle === 'batch' ? 'Monthly batch' : 'Per case'}</td><td className="n mono">{b.fee ? inr(b.fee) : '—'}</td><td className="mono sub">{b.gstin ?? 'not set'}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="sub px-4 pb-3">Any case can be billed differently from its branch's default on Ready to bill. A branch GSTIN in another state makes its invoices IGST.</p>
      </Panel>
    </div>
  );
}

// ---- page -----------------------------------------------------------------------------------------------------
const TABS = [
  { path: 'ready', label: 'Ready to bill', el: <ReadyTab /> },
  { path: 'invoices', label: 'Invoices', el: <InvoicesTab /> },
  { path: 'payments', label: 'Payments & ageing', el: <PaymentsTab /> },
  { path: 'gst', label: 'GST', el: <GstTab /> },
  { path: 'payouts', label: 'Engineer payouts', el: <PayoutsTab /> },
  { path: 'export', label: 'Accounting export', el: <ExportTab /> },
  { path: 'setup', label: 'Billing setup', el: <SetupTab /> },
];

function Kpis() {
  const q = useQuery({ queryKey: ['billing', 'summary'], queryFn: () => api.get<{ readyCount: number; readyAmount: number; outstanding: number; overdue: number; tds: number }>('/api/billing/summary') });
  const s = q.data;
  if (!s) return null;
  return (
    <div className="kpis">
      <div className="panel kpi"><div className="l">Ready to bill</div><div className="n">{s.readyCount}</div><div className="s">{rs(s.readyAmount)} before GST</div></div>
      <div className="panel kpi"><div className="l">Outstanding</div><div className="n">{lakhs(s.outstanding)}</div><div className="s">tax invoices, after TDS and credit notes</div></div>
      <div className="panel kpi"><div className="l">Overdue</div><div className="n" style={{ color: s.overdue ? 'var(--crit)' : undefined }}>{lakhs(s.overdue)}</div><div className="s">past the due days in setup</div></div>
      <div className="panel kpi"><div className="l">TDS deducted by banks</div><div className="n">{rs(s.tds)}</div><div className="s">to match with Form 26AS</div></div>
    </div>
  );
}

function Switch() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const onErr = useErrorToast();
  const setup = useSetup();
  const m = useMutation({
    mutationFn: (enabled: boolean) => api.put(`/api/firm/flags/billing`, { enabled }),
    onSuccess: (_r, on) => { toast(on ? 'Billing switched on' : 'Billing switched off'); qc.invalidateQueries({ queryKey: ['billing'] }); qc.invalidateQueries({ queryKey: ['meta'] }); },
    onError: onErr,
  });
  if (!setup.data) return null;
  return (
    <label className="flex items-center gap-2 text-[13px] font-semibold">
      <input type="checkbox" checked={setup.data.enabled} disabled={!can('set') || m.isPending} onChange={(e) => m.mutate(e.target.checked)} /> Billing module on
    </label>
  );
}

export default function Billing() {
  const { can } = useAuth();
  const setup = useSetup();
  if (!can('bill')) return <><PageHead eyebrow="Menu" title="Billing & payouts" /><Empty title="Billing needs the “Billing” permission">Ask the firm admin to grant it under Firm settings → Users & permissions.</Empty></>;
  if (setup.isLoading) return <Loading />;
  const on = setup.data?.enabled;
  return (
    <>
      <PageHead eyebrow="Menu" title="Billing & payouts" actions={<Switch />} />
      {!on ? (
        <Empty title="Billing is switched off for this firm">Reports are still issued and sent as usual. Switch it on above to raise GST invoices, track payments and TDS, export to accounting software and pay field engineers. When it is on, a sent case moves to Billed when invoiced and to Paid when settled.</Empty>
      ) : (
        <>
          <Kpis />
          <nav className="tabs" aria-label="Billing sections">
            {TABS.map((t) => <NavLink key={t.path} to={`/billing/${t.path}`} className={({ isActive }) => (isActive ? 'on' : '')}>{t.label}</NavLink>)}
          </nav>
          <Routes>
            <Route index element={<Navigate to="ready" replace />} />
            {TABS.map((t) => <Route key={t.path} path={t.path} element={t.el} />)}
            <Route path="invoices/:id" element={<InvoiceView />} />
            <Route path="*" element={<Navigate to="/billing/ready" replace />} />
          </Routes>
        </>
      )}
    </>
  );
}
