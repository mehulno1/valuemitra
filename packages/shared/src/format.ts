// Indian number formatting and amounts in words (lakh / crore system).

export function inr(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  const neg = n < 0;
  const s = String(Math.round(Math.abs(n)));
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3;
  return (neg ? '-' : '') + grouped;
}

export function rupees(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  return `Rs. ${inr(n)}/-`;
}

export function lakh(n: number): string {
  const l = n / 1e5;
  if (l >= 100) return `Rs. ${(l / 100).toFixed(2)} Cr`;
  return `Rs. ${l.toFixed(1)} lakh`;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  return (TENS[Math.floor(n / 10)] + ' ' + ONES[n % 10]).trim();
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? ONES[h] + ' Hundred' : '', r ? twoDigits(r) : ''].filter(Boolean).join(' ');
}

/** "Rupees Fifty Nine Lakh Fifty Two Thousand Only" */
export function amountInWords(n: number): string {
  n = Math.round(Math.abs(n));
  if (n === 0) return 'Rupees Zero Only';
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  const lakhs = Math.floor(n / 1e5);
  n %= 1e5;
  const thousand = Math.floor(n / 1e3);
  n %= 1e3;
  if (crore) parts.push((crore > 999 ? amountInWords(crore).replace(/^Rupees | Only$/g, '') : crore >= 100 ? threeDigits(crore) : twoDigits(crore)) + ' Crore');
  if (lakhs) parts.push(twoDigits(lakhs) + ' Lakh');
  if (thousand) parts.push(twoDigits(thousand) + ' Thousand');
  if (n) parts.push(threeDigits(n));
  return 'Rupees ' + parts.join(' ') + ' Only';
}

export const SQM_PER_SQFT = 0.09290304;
export const SQFT_PER_SQM = 10.7639104;

export function pad(n: number, width = 4): string {
  return String(n).padStart(width, '0');
}

/** Indian financial year (April–March) for a date. */
export function financialYear(d: Date = new Date()): { short: string; compact: string; start: number } {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  const a = String(y % 100).padStart(2, '0');
  const b = String((y + 1) % 100).padStart(2, '0');
  return { short: `${a}-${b}`, compact: `${a}${b}`, start: y };
}

export function ddmmyyyy(d: Date | string | null | undefined): string {
  if (!d) return '';
  const x = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(x.getTime())) return '';
  return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}/${x.getFullYear()}`;
}

/** Fill a numbering pattern such as "{FIRM}/{BANK}/{BRANCH}/{FY}/{N}". */
export function fillPattern(pattern: string, vars: Record<string, string>): string {
  return pattern.replace(/\{([A-Z_]+)\}/g, (_, k: string) => vars[k] ?? '');
}
