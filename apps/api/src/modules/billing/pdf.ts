// GST invoice / proforma as an A4 PDF: seller (letterhead or firm block), bill-to with GSTIN or B2C,
// place of supply, SAC, lines, CGST/SGST or IGST, amount in words, bank details, UPI QR for the
// balance on borrower invoices, signature and seal.
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';
import { amountInWords, ddmmyyyy, gstStateName, inr } from '@vm/shared';
import { readFile } from '../../platform/storage.js';
import type { InvoiceDetail } from './service.js';

const W = 595.28;
const H = 841.89;
const M = 40;
const INK = rgb(0.11, 0.11, 0.18);
const MUTED = rgb(0.37, 0.36, 0.45);
const LINE = rgb(0.82, 0.82, 0.88);
const SHADE = rgb(0.95, 0.95, 0.97);

// Standard fonts encode WinAnsi only; anything else (e.g. Devanagari) is replaced.
const safe = (s: unknown) => String(s ?? '').replace(/₹/g, 'Rs.').replace(/[^\x20-\x7E\xA0-\xFF€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ\n]/g, '?');
const money = (n: number) => `${n < 0 ? '-' : ''}${inr(Math.abs(Math.trunc(n)))}.${String(Math.round(Math.abs(n) * 100) % 100).padStart(2, '0')}`;

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of safe(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const t = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(t, size) <= width) line = t;
      else { if (line) out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

async function image(doc: PDFDocument, fileId: number | null | undefined, firmId: number): Promise<PDFImage | null> {
  if (!fileId) return null;
  try {
    const { buffer } = await readFile(fileId, firmId);
    return buffer[0] === 0x89 ? await doc.embedPng(buffer) : await doc.embedJpg(buffer);
  } catch { return null; }
}

export async function invoicePdf(inv: InvoiceDetail, firmId: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${inv.kind === 'tax' ? 'Tax invoice' : 'Proforma invoice'} ${inv.invoice_no}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const s = inv.seller;
  const [letterhead, signature, seal] = await Promise.all([image(doc, s.letterhead_file_id, firmId), image(doc, s.signature_file_id, firmId), image(doc, s.seal_file_id, firmId)]);
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;

  const text = (t: string, x: number, yy: number, o: { size?: number; f?: PDFFont; color?: typeof INK; right?: boolean; center?: boolean } = {}) => {
    const size = o.size ?? 9;
    const f = o.f ?? font;
    const str = safe(t);
    const w = f.widthOfTextAtSize(str, size);
    page.drawText(str, { x: o.right ? x - w : o.center ? x - w / 2 : x, y: yy, size, font: f, color: o.color ?? INK });
  };
  const rule = (yy: number, x1 = M, x2 = W - M) => page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: 0.6, color: LINE });

  // ---- seller
  if (letterhead) {
    const w = W - 2 * M;
    const h = Math.min(110, (letterhead.height / letterhead.width) * w);
    const iw = (letterhead.width / letterhead.height) * h;
    page.drawImage(letterhead, { x: M + (w - iw) / 2, y: y - h, width: iw, height: h });
    y -= h + 8;
  } else {
    text(s.name ?? '', M, y - 14, { size: 16, f: bold });
    y -= 22;
    for (const l of wrap([s.address, s.city].filter(Boolean).join(', '), font, 9, 330)) { text(l, M, y - 9, { color: MUTED }); y -= 12; }
    const contact = [s.phone && `Phone ${s.phone}`, s.email].filter(Boolean).join(' · ');
    if (contact) { text(contact, M, y - 9, { color: MUTED }); y -= 12; }
  }
  const ids = [s.gstin && `GSTIN ${s.gstin}`, s.pan && `PAN ${s.pan}`, s.state_code && `State ${gstStateName(s.state_code)} (${s.state_code})`].filter(Boolean).join('   ');
  if (ids) { text(ids, M, y - 9, { color: MUTED }); y -= 14; }
  rule(y - 2);
  y -= 22;

  // ---- title
  text(inv.kind === 'tax' ? 'TAX INVOICE' : 'PROFORMA INVOICE', M, y, { size: 14, f: bold });
  if (inv.kind === 'proforma') text('Not a tax invoice · advance request', M, y - 13, { color: MUTED });
  text(inv.invoice_no, W - M, y, { size: 11, f: bold, right: true });
  text(`Date ${ddmmyyyy(inv.invoice_date)}`, W - M, y - 13, { right: true, color: MUTED });
  y -= 30;

  // ---- bill to | details
  const colW = (W - 2 * M - 12) / 2;
  const boxTop = y;
  const left: [string, boolean][] = [['Bill to', true], [inv.bill_to_name, false]];
  for (const l of wrap(inv.bill_to_address ?? '', font, 9, colW - 16)) if (l) left.push([l, false]);
  left.push([inv.bill_to_gstin ? `GSTIN ${inv.bill_to_gstin}` : 'Unregistered (B2C)', false]);
  left.push([`Place of supply: ${gstStateName(inv.pos_code)} (${inv.pos_code})`, false]);
  const right: [string, string][] = [
    ['Type', inv.kind === 'proforma' ? 'Proforma · advance request' : inv.bill_mode === 'batch' ? `Batch bill${inv.period_label ? ` · ${inv.period_label}` : ''}` : 'Single case bill'],
    ['SAC', `${inv.sac} (valuation services)`],
    ['Reverse charge', 'No'],
    ...(inv.linked.length ? inv.linked.map((l): [string, string] => [l.kind === 'proforma' ? 'Against proforma' : 'Tax invoice', l.invoice_no]) : []),
  ];
  const boxH = Math.max(left.length, right.length + 1) * 12 + 14;
  page.drawRectangle({ x: M, y: boxTop - boxH, width: colW, height: boxH, borderColor: LINE, borderWidth: 0.6 });
  page.drawRectangle({ x: M + colW + 12, y: boxTop - boxH, width: colW, height: boxH, borderColor: LINE, borderWidth: 0.6 });
  left.forEach(([t, b], i) => text(t, M + 8, boxTop - 14 - i * 12, { f: b || i === 1 ? bold : font, color: b ? MUTED : INK }));
  text('Details', M + colW + 20, boxTop - 14, { f: bold, color: MUTED });
  right.forEach(([k, v], i) => { text(k, M + colW + 20, boxTop - 26 - i * 12, { color: MUTED }); text(v, M + colW + 110, boxTop - 26 - i * 12); });
  y = boxTop - boxH - 18;

  // ---- lines
  const cols = [M, M + 24, M + 150, W - M];
  const header = () => {
    page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 18, color: SHADE });
    text('#', cols[0] + 4, y, { f: bold, size: 8.5 });
    text('Report / reference', cols[1] + 4, y, { f: bold, size: 8.5 });
    text('Description', cols[2] + 4, y, { f: bold, size: 8.5 });
    text('Amount (Rs.)', cols[3] - 4, y, { f: bold, size: 8.5, right: true });
    y -= 20;
  };
  header();
  inv.lines.forEach((l, i) => {
    const desc = wrap(l.description, font, 8.5, cols[3] - cols[2] - 90);
    const ref = wrap(l.ref_text, font, 8.5, cols[2] - cols[1] - 8);
    const h = Math.max(desc.length, ref.length) * 11 + 8;
    if (y - h < 230) { page = doc.addPage([W, H]); y = H - M; header(); }
    text(String(i + 1), cols[0] + 4, y, { size: 8.5 });
    ref.forEach((t, k) => text(t, cols[1] + 4, y - k * 11, { size: 8.5 }));
    desc.forEach((t, k) => text(t, cols[2] + 4, y - k * 11, { size: 8.5 }));
    text(money(Number(l.amount)), cols[3] - 4, y, { size: 8.5, right: true });
    y -= h;
    rule(y + 12);
  });
  y -= 6;

  // ---- totals
  const rate = Number(inv.gst_rate);
  const rows: [string, number, boolean?][] = [['Taxable value', Number(inv.taxable)]];
  if (Number(inv.igst) > 0) rows.push([`IGST ${rate}%`, Number(inv.igst)]);
  else rows.push([`CGST ${rate / 2}%`, Number(inv.cgst)], [`SGST ${rate / 2}%`, Number(inv.sgst)]);
  if (Number(inv.round_off)) rows.push(['Round off', Number(inv.round_off)]);
  rows.push(['Total', Number(inv.total), true]);
  if (inv.paid > 0) rows.push([inv.kind === 'proforma' ? 'Advance received' : `Received${inv.tds ? ' (incl. TDS)' : ''}`, -inv.paid]);
  if (inv.credited > 0) rows.push(['Credit notes', -inv.credited]);
  if (inv.writtenOff > 0) rows.push(['Written off', -inv.writtenOff]);
  if (inv.paid > 0 || inv.credited > 0 || inv.writtenOff > 0) rows.push(['Balance due', inv.balance, true]);
  for (const [k, v, b] of rows) {
    if (b) rule(y + 9, W - M - 220);
    text(k, W - M - 110, y, { right: true, f: b ? bold : font, color: b ? INK : MUTED });
    text(money(v), W - M - 4, y, { right: true, f: b ? bold : font });
    y -= 14;
  }
  y -= 4;
  for (const l of wrap(`${amountInWords(Number(inv.total))} (total)`, bold, 9, W - 2 * M)) { text(l, M, y, { f: bold }); y -= 12; }
  y -= 10;

  // ---- bank details | QR | signature
  const footTop = y;
  const b = s.bank_account ?? {};
  const bank = [
    b.number && ['Bank', [b.bank, b.branch].filter(Boolean).join(', ')],
    b.name && ['Account name', b.name],
    b.number && ['Account no.', b.number],
    b.ifsc && ['IFSC', b.ifsc],
    s.upi_id && ['UPI', s.upi_id],
  ].filter(Boolean) as [string, string][];
  if (bank.length) {
    text('Payment details', M, y, { f: bold, color: MUTED });
    bank.forEach(([k, v], i) => { text(k, M, y - 13 - i * 12, { color: MUTED }); text(v, M + 72, y - 13 - i * 12); });
  }
  let ny = y - 13 - bank.length * 12 - 6;
  const notes = [
    inv.payer === 'bank' && inv.kind === 'tax' ? 'TDS under section 194J, if deducted, may please be reflected in Form 26AS.' : '',
    s.note ?? '',
  ].filter(Boolean);
  for (const n of notes) for (const l of wrap(n, font, 8, 250)) { text(l, M, ny, { size: 8, color: MUTED }); ny -= 10; }

  if (inv.payer === 'borrower' && inv.balance > 0 && s.upi_id) {
    const url = `upi://pay?pa=${encodeURIComponent(s.upi_id)}&pn=${encodeURIComponent(s.name ?? '')}&am=${inv.balance.toFixed(2)}&cu=INR&tn=${encodeURIComponent(inv.invoice_no)}`;
    const qr = await doc.embedPng(await QRCode.toBuffer(url, { type: 'png', margin: 1, width: 300, errorCorrectionLevel: 'M' }));
    const q = 92;
    const qx = M + 245;
    page.drawImage(qr, { x: qx, y: footTop - q, width: q, height: q });
    text(`Scan to pay Rs. ${inr(inv.balance)}`, qx + q / 2, footTop - q - 11, { size: 8, center: true });
    text('with any UPI app', qx + q / 2, footTop - q - 21, { size: 8, center: true, color: MUTED });
  }

  const sx = W - M - 120;
  const sigTop = footTop;
  if (seal) page.drawImage(seal, { x: sx - 8, y: sigTop - 66, width: 62, height: (seal.height / seal.width) * 62 });
  if (signature) {
    const sw = 100;
    const sh = Math.min(48, (signature.height / signature.width) * sw);
    page.drawImage(signature, { x: sx + 20, y: sigTop - 56, width: (signature.width / signature.height) * sh, height: sh });
  }
  text(`For ${s.name ?? ''}`, W - M, sigTop - 76, { right: true, f: bold, size: 8.5 });
  text('Authorised signatory', W - M, sigTop - 87, { right: true, size: 8, color: MUTED });

  text('This is a computer-generated invoice.', W / 2, M - 10, { size: 7.5, center: true, color: MUTED });
  return Buffer.from(await doc.save());
}
