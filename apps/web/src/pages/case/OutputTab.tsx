// Output: final Word + PDF, email and WhatsApp drafts, the dispatch checklist and the FY report register.
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { financialYear, inr } from '@vm/shared';
import { Empty, Loading, Panel, fmtDate, useErrorToast, useToast } from '@/components/ui';
import { api, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { caseKey, type TabProps } from './context';

interface OutFile { id: number; original_name: string | null; mime: string; size_bytes: number | string }
interface Dispatch { email_sent: number | boolean; whatsapp_sent: number | boolean; printed: number | boolean; couriered: number | boolean; awb: string | null; courier_name: string | null; marked_sent_at: string | null }
interface Output {
  signed: boolean; reportNo?: string; sentAt?: string | null; render?: { status: string; error: string | null } | null; files?: OutFile[];
  email?: { to: string | null; subject: string; body: string }; whatsapp?: string; dispatch?: Dispatch | null;
}
interface RegRow { id: number; report_no: string; case_no: string; assignment_id: number; bank_code: string; branch_code: string; fmv: number | string | null; signed_at: string; superseded_at: string | null; signed_by: string | null }

const size = (b: number | string) => { const n = Number(b); return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`; };
const on = (v: unknown) => !!Number(v);

export default function OutputTab({ c, go, refresh }: TabProps) {
  const { can } = useAuth();
  const toast = useToast();
  const err = useErrorToast();
  const q = useQuery({
    queryKey: caseKey(c.id, 'output'),
    queryFn: () => api.get<Output>(`/api/assignments/${c.id}/output`),
    refetchInterval: (qq) => (['queued', 'rendering'].includes(qq.state.data?.render?.status ?? '') ? 3000 : false),
  });
  const reg = useQuery({ queryKey: caseKey(c.id, 'register'), queryFn: () => api.get<RegRow[]>('/api/register') });

  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [awb, setAwb] = useState('');
  const [seeded, setSeeded] = useState<string | null>(null);
  useEffect(() => {
    const d = q.data;
    if (!d?.signed || seeded === d.reportNo) return;
    setSeeded(d.reportNo ?? '');
    setTo(d.email?.to ?? '');
    setSubject(d.email?.subject ?? '');
    setBody(d.email?.body ?? '');
    setAwb(d.dispatch?.awb ?? '');
  }, [q.data, seeded]);

  const dispatch = useMutation({
    mutationFn: (b: Partial<Record<'email_sent' | 'whatsapp_sent' | 'printed' | 'couriered', boolean>> & { awb?: string | null }) => api.patch(`/api/assignments/${c.id}/output/dispatch`, b),
    onSuccess: () => refresh(),
    onError: err,
  });
  const email = useMutation({
    mutationFn: () => api.post(`/api/assignments/${c.id}/output/email`, { to: to.trim(), subject, body }),
    onSuccess: () => { toast(`Report emailed to ${to.trim()} with PDF and Word`); refresh(); },
    onError: err,
  });
  const sent = useMutation({
    mutationFn: () => api.post(`/api/assignments/${c.id}/output/sent`),
    onSuccess: () => { toast('Case marked as sent'); refresh(); },
    onError: err,
  });

  if (q.isLoading) return <Loading />;
  if (!q.data) return <Empty title="Output could not be loaded" />;
  const d = q.data;
  if (!d.signed) {
    return (
      <Empty title="Output opens after the valuer signs">
        <p className="mt-0">The final Word and PDF, the email to the branch and the dispatch checklist appear here once the report is signed.</p>
        <button className="btn" onClick={() => go('rep')}>Go to Report & sign-off</button>
      </Empty>
    );
  }

  const canEdit = can('edit');
  const ds = d.dispatch;
  const isSent = !!d.sentAt;
  const ready = d.render?.status === 'ready';
  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast('Copied'), () => toast('Could not copy', 'err'));
  const fy = financialYear();
  const checks: { key: 'email_sent' | 'whatsapp_sent' | 'printed' | 'couriered'; label: string; hint?: string }[] = [
    { key: 'email_sent', label: 'Email sent with PDF and Word' },
    { key: 'whatsapp_sent', label: 'WhatsApp message sent', hint: 'Optional' },
    { key: 'printed', label: 'Hard copy printed', hint: 'A4, letterhead, signature and seal already on the pages' },
    { key: 'couriered', label: 'Hard copy delivered or couriered' },
  ];
  const canMark = !!ds && on(ds.email_sent) && on(ds.printed) && on(ds.couriered) && !isSent;

  return (
    <div className="grid gap-4">
      <Panel title={<div><div className="eyebrow">Final report</div><h3 className="mono text-[15px] font-semibold">{d.reportNo}</h3></div>}
        right={isSent ? <span className="chip c-sent">Sent {fmtDate(d.sentAt, true)}</span> : <span className="chip c-signed">Signed · to dispatch</span>}>
        {!d.render ? <p className="sub m-0">The final report has not been queued. Reopen and sign again if this persists.</p>
          : d.render.status === 'failed' ? <p className="m-0 text-crit">The final report could not be generated: {d.render.error ?? 'unknown error'}</p>
          : !ready ? <p className="m-0"><span className="dots">Generating the final Word and PDF</span></p>
          : (
            <div className="grid gap-2">
              {(d.files ?? []).map((f) => {
                const pdf = f.mime === 'application/pdf';
                return (
                  <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-line px-3 py-2">
                    <div className="min-w-0">
                      <b className="mono block break-all text-[13px]">{f.original_name}</b>
                      <div className="sub">{pdf ? 'Final, signed · A4 · for email and printing' : 'Same report in Word, bank format layout'} · {size(f.size_bytes)}</div>
                    </div>
                    <button className="btn sm" onClick={() => downloadFile(f.id, f.original_name ?? (pdf ? 'report.pdf' : 'report.docx')).catch(err)}>Download</button>
                  </div>
                );
              })}
            </div>
          )}
      </Panel>

      <div className="split">
        <Panel title="Email to the branch">
          <div className="grid gap-3">
            <div className="field"><label>To</label><input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="branch@bank.co.in" /></div>
            <div className="field"><label>Subject</label><input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
            <div className="field"><label>Message</label><textarea rows={9} value={body} onChange={(e) => setBody(e.target.value)} /></div>
            <div className="sub">Attachments: {(d.files ?? []).map((f) => f.original_name).join(', ') || 'final PDF and Word, once generated'}</div>
            <div className="btns">
              {canEdit && <button className="btn pri" disabled={!ready || !/^\S+@\S+\.\S+$/.test(to.trim()) || email.isPending} onClick={() => email.mutate()}>{email.isPending ? <span className="dots">Sending</span> : 'Send email now'}</button>}
              <button className="btn" onClick={() => copy(`${subject}\n\n${body}`)}>Copy</button>
            </div>
          </div>
        </Panel>

        <div className="grid gap-4">
          <Panel title="WhatsApp to the bank contact">
            <div className="msgbox p-0">
              <pre>{d.whatsapp || 'No WhatsApp wording set for this bank.'}</pre>
              <div className="btns">
                <button className="btn sm" disabled={!d.whatsapp} onClick={() => copy(d.whatsapp ?? '')}>Copy</button>
                {d.whatsapp && <a className="btn sm ghost" href={`https://wa.me/?text=${encodeURIComponent(d.whatsapp)}`} target="_blank" rel="noreferrer">Open in WhatsApp</a>}
              </div>
            </div>
          </Panel>

          <Panel title="Dispatch">
            <div className="grid gap-3">
              {checks.map((k) => (
                <label key={k.key} className="flex items-start gap-3">
                  <input type="checkbox" className="mt-1" checked={on(ds?.[k.key])} disabled={!canEdit || isSent || dispatch.isPending} onChange={(e) => dispatch.mutate({ [k.key]: e.target.checked })} />
                  <span><b className="font-semibold">{k.label}</b>{k.hint && <span className="sub block">{k.hint}</span>}</span>
                </label>
              ))}
              <div className="field pl-7">
                <label>Courier / AWB no. or “By hand”</label>
                <input value={awb} disabled={!canEdit || isSent} onChange={(e) => setAwb(e.target.value)} onBlur={() => { if ((awb.trim() || null) !== (ds?.awb ?? null)) dispatch.mutate({ awb: awb.trim() || null }); }} placeholder="e.g. DTDC D12345678" />
              </div>
              <div className="btns">
                {canEdit && <button className="btn pri" disabled={!canMark || sent.isPending} onClick={() => sent.mutate()}>{isSent ? 'Marked as sent' : 'Mark case as sent'}</button>}
                {!isSent && !canMark && <span className="sub">Tick email, print and courier first.</span>}
              </div>
            </div>
          </Panel>
        </div>
      </div>

      <BillingPanel c={c} refresh={refresh} />

      <Panel title={`Report register · FY ${fy.short}`} right={<span className="sub">continuous, no gaps</span>} pad={false}>
        {reg.isLoading ? <Loading /> : !reg.data?.length ? <p className="sub p-4">No reports signed this year yet.</p> : (
          <div className="tablewrap">
            <table className="list">
              <thead><tr><th>Report no.</th><th>Case</th><th>Bank</th><th className="text-right">FMV</th><th>Signed</th><th>By</th></tr></thead>
              <tbody>
                {reg.data.map((x) => {
                  const sup = !!x.superseded_at;
                  const mine = x.assignment_id === c.id;
                  return (
                    <tr key={x.id} style={{ textDecoration: sup ? 'line-through' : undefined, color: sup ? 'var(--muted)' : undefined, background: mine && !sup ? 'var(--stamp-soft)' : undefined }}>
                      <td className="mono whitespace-nowrap">{x.report_no}</td>
                      <td className="mono whitespace-nowrap">{x.case_no}</td>
                      <td className="whitespace-nowrap">{x.bank_code}, {x.branch_code}</td>
                      <td className="n">{x.fmv !== null ? inr(Number(x.fmv)) : '—'}</td>
                      <td className="whitespace-nowrap">{fmtDate(x.signed_at)}{sup ? <div className="sub" style={{ textDecoration: 'none' }}>superseded {fmtDate(x.superseded_at)}</div> : null}</td>
                      <td>{x.signed_by ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

interface CaseBilling { enabled: boolean; sent: boolean; stage: string; invoices: { id: number; kind: 'tax' | 'proforma'; invoice_no: string; invoice_date: string; total: number; balance: number; paid: number; converted_invoice_id: number | null; cancelled_at: string | null; released_at: string | null; credit_note_no: string | null }[] }

/** Billing for this case: its invoices, or bill it now (when the firm has billing on). */
function BillingPanel({ c, refresh }: Pick<TabProps, 'c' | 'refresh'>) {
  const { can } = useAuth();
  const toast = useToast();
  const err = useErrorToast();
  const q = useQuery({ queryKey: caseKey(c.id, 'billing'), queryFn: () => api.get<CaseBilling>(`/api/assignments/${c.id}/billing`) });
  const bill = useMutation({
    mutationFn: () => api.post<{ id: number; invoiceNo: string }[]>('/api/billing/invoices', { assignmentIds: [c.id], mode: 'case', kind: 'tax' }),
    onSuccess: (r) => { toast(`Invoice ${r.map((x) => x.invoiceNo).join(', ')} raised`); q.refetch(); refresh(); },
    onError: err,
  });
  const d = q.data;
  if (!d?.enabled) return null;
  const live = d.invoices.filter((i) => !i.cancelled_at && !i.released_at && !(i.kind === 'proforma' && i.converted_invoice_id));
  const tax = live.find((i) => i.kind === 'tax');
  const pro = live.find((i) => i.kind === 'proforma');
  const voided = d.invoices.filter((i) => i.kind === 'tax' && i.released_at);
  const link = (i: CaseBilling['invoices'][number]) => (can('bill') ? <Link className="mono" to={`/billing/invoices/${i.id}`}>{i.invoice_no}</Link> : <span className="mono">{i.invoice_no}</span>);
  return (
    <Panel title="Billing" right={tax ? <span className={`chip c-${tax.balance <= 0 ? 'paid' : 'billed'}`}>{tax.balance <= 0 ? 'Paid' : 'Billed'}</span> : null}>
      {tax ? (
        <p className="m-0">Tax invoice {link(tax)} dated {fmtDate(tax.invoice_date)} for Rs. {inr(tax.total)}. {tax.balance > 0 ? `Balance Rs. ${inr(tax.balance)}.` : 'Fully settled.'}</p>
      ) : (
        <div className="grid gap-2">
          {pro && <p className="m-0">Proforma {link(pro)} for Rs. {inr(pro.total)}{pro.paid > 0 ? `, advance Rs. ${inr(pro.paid)} received` : ', no advance yet'}. Billing the case converts it with the advance adjusted.</p>}
          <p className="sub m-0">{d.sent ? 'This report is under Ready to bill. Batch-billed branches are usually billed monthly; you can also bill it on its own now.' : 'The case appears under Ready to bill once it is marked as sent.'}</p>
          {can('bill') && d.sent && <div className="btns"><button className="btn" disabled={bill.isPending} onClick={() => bill.mutate()}>Bill this case now</button></div>}
        </div>
      )}
      {voided.map((i) => <p key={i.id} className="sub mb-0 mt-2">Earlier tax invoice {link(i)} for Rs. {inr(i.total)} was cancelled by credit note {i.credit_note_no ?? ''}.</p>)}
    </Panel>
  );
}
